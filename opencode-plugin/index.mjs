/**
 * Harness Enforcement Plugin for opencode
 *
 * A single self-contained ESM module, because that is what opencode actually
 * loads: a JS/TS file dropped in `.opencode/plugins/` (or referenced from
 * `opencode.json`) that exports a function returning a hooks object. There is
 * no JSON-manifest-to-script mechanism - the old plugin.json + hooks/*.js
 * split assumed one and was never invoked by opencode. See issue #37.
 *
 * Hook mapping (old CLI script -> real opencode hook):
 *   post-edit.js     -> tool.execute.after   (fires once per edit/write/apply_patch)
 *   pre-complete.js  -> event (session.idle) (opencode has no "before complete"
 *                       hook; session.idle is the closest analog - the agent's
 *                       turn just ended. There is no way to *block* that event,
 *                       so pending verification is enforced by running it right
 *                       there and, on failure, pushing a synthetic follow-up
 *                       message via client.session.prompt() to force the agent
 *                       to keep going instead of truly stopping.)
 *   verify.js        -> inlined into the session.idle handler
 *   circuit-breaker.js -> tool.execute.before (throws to pause edit tools for the zoom-out boundary
 *                       once locked) + failure tracking inside session.idle
 *   compliance.js    -> folded into the same state writes, no separate stage
 *
 * The circuit breaker trips on repeated *verification* failures (same failing
 * command + truncated error), not on arbitrary tool failures: tool.execute.after
 * gives back `{title, output, metadata}` for every tool with no normalized
 * success/failure field, so there is no reliable cross-tool failure signal to
 * key a signature on. Verification failures are self-produced and already
 * normalized, so that is the honest signal to use.
 */

import { homedir } from "node:os"
import { join, dirname, resolve, basename, relative, isAbsolute } from "node:path"
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, rmSync, realpathSync, readdirSync } from "node:fs"
import { execSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"

const EDIT_TOOLS = new Set(["edit", "write", "apply_patch"])

// Global state root, matching the Node-side resolver at
// scripts/lib/workspace.js#getStateHome (same env var precedence) - this
// plugin can't require that CJS module (opencode loads a single self-
// contained ESM file, see the header comment above), so the derivation is
// duplicated here, algorithm-for-algorithm, so the two stay physically
// compatible if a workspace is ever inspected from both sides.
function getStateHome() {
  return process.env.HARNESS_STATE_HOME || join(homedir(), ".agents", "harness-everything")
}

// Keys state per real workspace (`directory`, which opencode itself resolves
// - never a cwd walk) instead of one flat dir shared by every project on the
// machine. The pre-fix `~/.harness-state` had no such key at all: a circuit
// breaker trip in one opencode project affected every other one too
// (issue #42 item #4).
function getWorkspaceKey(directory) {
  let real = resolve(directory)
  try { real = realpathSync(real) } catch { /* directory may not exist yet */ }
  const slug = basename(real).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "workspace"
  const hashInput = process.platform === "win32" ? real.toLowerCase() : real
  const hash = createHash("sha1").update(hashInput).digest("hex").slice(0, 12)
  return `${slug}-${hash}`
}

// Move the pre-#42 flat plugin state into the first workspace that claims it.
// Keep conflicting or unsupported entries in place so a later run can retry.
function migrateLegacyFlatState(stateDir) {
  const legacyDir = join(homedir(), ".harness-state")
  if (!existsSync(legacyDir)) return
  try {
    mkdirSync(stateDir, { recursive: true })
    let conflict = false
    for (const entry of readdirSync(legacyDir, { withFileTypes: true })) {
      if (!entry.isFile()) {
        conflict = true
        continue
      }
      const source = join(legacyDir, entry.name)
      const destination = join(stateDir, entry.name)
      if (!existsSync(destination)) writeFileSync(destination, readFileSync(source))
      else if (!readFileSync(source).equals(readFileSync(destination))) conflict = true
    }
    if (!conflict) rmSync(legacyDir, { recursive: true, force: true })
  } catch {
    // Best effort: leave the legacy source available for recovery.
  }
}

function getStateDir(directory) {
  return join(getStateHome(), "workspaces", getWorkspaceKey(directory))
}

function getStateRoot(directory) {
  return join(getStateDir(directory), "state")
}

function getSessionKey(sessionID) {
  const id = String(sessionID || "default")
  const windowsReserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i
  if (
    /^[A-Za-z0-9._-]+$/.test(id) &&
    id !== "." &&
    id !== ".." &&
    id === id.trim() &&
    !/[. ]$/.test(id) &&
    !windowsReserved.test(id)
  ) return id
  return `session-${createHash("sha1").update(id).digest("hex").slice(0, 12)}`
}

function isWithin(parent, candidate) {
  const relativePath = relative(resolve(parent), resolve(candidate))
  return relativePath === "" || (
    relativePath !== ".." &&
    !relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
    !isAbsolute(relativePath)
  )
}

function samePath(left, right) {
  const a = resolve(left)
  const b = resolve(right)
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b
}

function getSessionDir(directory, sessionID) {
  const sessionsRoot = resolve(join(getStateRoot(directory), "sessions"))
  const candidate = resolve(sessionsRoot, getSessionKey(sessionID))
  if (!isWithin(sessionsRoot, candidate) || candidate === sessionsRoot) {
    const fallback = `session-${createHash("sha1").update(String(sessionID || "default")).digest("hex").slice(0, 12)}`
    return join(sessionsRoot, fallback)
  }
  return candidate
}

function loadJSON(file, fallback) {
  try {
    if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"))
  } catch {
    // fall through to default
  }
  return fallback
}

function saveJSON(file, data) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(data, null, 2))
}

function defaultEditState() {
  return {
    lastEditTime: null,
    verificationPending: false,
    editsSinceVerification: 0,
    followUpPending: false,
    followUpDeliveryPending: false,
    followUpMessage: null,
    lastFollowUpError: null,
    sessionStart: Date.now(),
  }
}

function defaultBreakerState() {
  return {
    failures: {},
    lastReflection: null,
    lastReflectionSignature: null,
    reflectionPending: false,
    reflectionRequestedAt: null,
    reflectionToken: null,
    reflectionSignature: null,
  }
}

function normalizeEditState(state) {
  return { ...defaultEditState(), ...(state || {}) }
}

function normalizeBreakerState(state) {
  const { hardLock: _retiredHardLock, ...rest } = state || {}
  return { ...defaultBreakerState(), ...rest, failures: (state && state.failures) || {} }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function loadBreakerState(file) {
  if (!existsSync(file)) return defaultBreakerState()
  try {
    const state = JSON.parse(readFileSync(file, "utf8"))
    const finiteOrNull = (value) => value === undefined || value === null || Number.isFinite(value)
    const stringOrNull = (value) => value === undefined || value === null || typeof value === "string"
    if (
      !isRecord(state) ||
      (state.failures !== undefined && !isRecord(state.failures)) ||
      (state.reflectionPending !== undefined && typeof state.reflectionPending !== "boolean") ||
      !finiteOrNull(state.lastReflection) ||
      !finiteOrNull(state.reflectionRequestedAt) ||
      !stringOrNull(state.lastReflectionSignature) ||
      !stringOrNull(state.reflectionToken) ||
      !stringOrNull(state.reflectionSignature) ||
      Object.values(state.failures || {}).some((entry) =>
        !isRecord(entry) ||
        (entry.count !== undefined && (!Number.isInteger(entry.count) || entry.count < 0)) ||
        !finiteOrNull(entry.firstSeen) ||
        !finiteOrNull(entry.lastSeen)
      )
    ) throw new Error("invalid breaker state shape")
    return normalizeBreakerState(state)
  } catch {
    throw new Error(`Harness circuit breaker state is corrupt: "${file}" cannot be read safely.`)
  }
}

const REFLECTION_FILE = "zoom-out-report.md"
const REFLECTION_SECTIONS = ["## Goal", "## Failed Attempts", "## Verified Facts", "## Diagnosis", "## Decision"]

function reflectionReportPath(stateDir) {
  return join(stateDir, REFLECTION_FILE)
}

function isValidReflection(reportFile, breaker) {
  if (!breaker.reflectionPending || !breaker.reflectionToken || !existsSync(reportFile)) return false
  try {
    const report = readFileSync(reportFile, "utf8")
    const lines = report.split(/\r?\n/)
    const sectionIndexes = new Map(
      lines.map((line, index) => [line.trim(), index]).filter(([line]) => REFLECTION_SECTIONS.includes(line)),
    )
    if (!REFLECTION_SECTIONS.every((section) => sectionIndexes.has(section))) return false
    const decisionStart = sectionIndexes.get("## Decision") + 1
    const nextHeading = lines.findIndex((line, index) => index >= decisionStart && /^##\s+/.test(line.trim()))
    const decisionLines = lines.slice(decisionStart, nextHeading === -1 ? lines.length : nextHeading)
    const firstDecisionLine = decisionLines.find((line) => line.trim().length > 0)
    return !!firstDecisionLine && /^(?:RESUME|ESCALATE)\s*:/i.test(firstDecisionLine.trim()) &&
      report.includes(`Reflection token: ${breaker.reflectionToken}`)
  } catch {
    return false
  }
}

function completeReflection(breakerFile, reportFile) {
  const breaker = loadBreakerState(breakerFile)
  if (!isValidReflection(reportFile, breaker)) return false
  const completedAt = Math.max(Date.now(), (breaker.reflectionRequestedAt || 0) + 1)
  breaker.lastReflection = completedAt
  breaker.lastReflectionSignature = breaker.reflectionSignature
  if (breaker.reflectionSignature && breaker.failures[breaker.reflectionSignature]) {
    breaker.failures[breaker.reflectionSignature].count = 0
    breaker.failures[breaker.reflectionSignature].firstSeen = completedAt
    breaker.failures[breaker.reflectionSignature].lastSeen = completedAt
  }
  breaker.reflectionPending = false
  breaker.reflectionRequestedAt = null
  breaker.reflectionToken = null
  breaker.reflectionSignature = null
  saveJSON(breakerFile, breaker)
  return true
}

function defaultCompliance() {
  return {
    sessionStart: Date.now(),
    totalEdits: 0,
    verifiedEdits: 0,
    circuitBreakerTrips: 0,
    reflectionsForced: 0,
  }
}

function extractFailureSignature(text) {
  return text.slice(0, 100).replace(/\s+/g, " ").trim()
}

function getAvailableScripts(cwd) {
  const pkgPath = join(cwd, "package.json")
  if (!existsSync(pkgPath)) return {}
  try {
    return JSON.parse(readFileSync(pkgPath, "utf8")).scripts || {}
  } catch {
    return {}
  }
}

function runVerification(cwd) {
  const scripts = getAvailableScripts(cwd)
  const commands = [
    { cmd: "npm test", script: "test" },
    { cmd: "npm run lint", script: "lint" },
    { cmd: "npm run build", script: "build" },
  ].filter((c) => scripts[c.script])

  if (commands.length === 0) {
    return { allPassed: true, skipped: true, results: [] }
  }

  const results = []
  for (const { cmd } of commands) {
    try {
      execSync(cmd, { cwd, stdio: "pipe", timeout: 60000 })
      results.push({ command: cmd, success: true })
    } catch (e) {
      results.push({ command: cmd, success: false, error: (e.stdout || e.message || "").toString().slice(0, 200) })
    }
  }
  return { allPassed: results.every((r) => r.success), skipped: false, results }
}

/**
 * Records a verification failure against the circuit breaker and returns the
 * action to take: allow (with retries remaining) or force_reflection on the
 * third matching failure. Completing reflection resets that signature's count.
 */
function tripBreaker(breakerFile, signature) {
  const breaker = loadBreakerState(breakerFile)

  if (!breaker.failures[signature]) {
    breaker.failures[signature] = { count: 0, firstSeen: Date.now() }
  }
  const entry = breaker.failures[signature]
  entry.count++
  entry.lastSeen = Date.now()

  if (entry.count >= 3) {
    if (!breaker.reflectionPending) {
      breaker.reflectionPending = true
      breaker.reflectionRequestedAt = Date.now()
      breaker.reflectionToken = randomUUID().replace(/-/g, "")
      breaker.reflectionSignature = signature
    }
    saveJSON(breakerFile, breaker)
    return { action: "force_reflection", count: entry.count, reflectionToken: breaker.reflectionToken }
  }

  saveJSON(breakerFile, breaker)
  return { action: "allow", count: entry.count, remaining: 3 - entry.count }
}

function recordCompliance(complianceFile, mutate) {
  const compliance = loadJSON(complianceFile, defaultCompliance())
  mutate(compliance)
  saveJSON(complianceFile, compliance)
}

const TELEMETRY_SCHEMA_VERSION = 1
const TELEMETRY_EVENT_TYPES = new Set(["skill.invoke", "skill.loaded", "skill.complete", "tool.observed"])

function telemetryEnabled() {
  const value = String(process.env.HARNESS_TELEMETRY || "local").toLowerCase()
  return !["0", "false", "off", "disabled", "none"].includes(value)
}

function telemetryLocalId(prefix, value) {
  const text = String(value || "").trim()
  if (!text) return null
  return `${prefix}-${createHash("sha256").update(text).digest("hex").slice(0, 16)}`
}

function telemetrySkillName(value) {
  const text = String(value || "").trim()
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(text) ? text.toLowerCase() : null
}

function telemetryToolName(value) {
  const text = String(value || "").trim()
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(text) ? text : null
}

function telemetrySkillVersion(workspace, skillName) {
  if (!skillName) return null
  const candidates = [
    join(workspace, ".claude", "skills", skillName, "SKILL.md"),
    join(workspace, ".agents", "skills", skillName, "SKILL.md"),
  ]
  for (const file of candidates) {
    try {
      const source = readFileSync(file, "utf8")
      const metadata = source.match(/metadata:\s*[\s\S]{0,300}?version:\s*["']?([^\s"'\n]+)["']?/i)
      if (metadata) return metadata[1].slice(0, 40)
    } catch {}
  }
  return null
}

function appendTelemetry(workspace, input) {
  try {
    if (!telemetryEnabled()) return false
    if (!TELEMETRY_EVENT_TYPES.has(input.event)) return false
    const file = join(getStateRoot(workspace), "telemetry", "events.jsonl")
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, JSON.stringify({
      schemaVersion: TELEMETRY_SCHEMA_VERSION,
      eventId: randomUUID(),
      event: input.event,
      host: "opencode",
      observedAt: new Date().toISOString(),
      sessionId: telemetryLocalId("session", input.sessionID || "default"),
      turnId: telemetryLocalId("turn", input.turnID),
      agentId: telemetryLocalId("agent", input.agentID),
      invocationId: input.invocationId || null,
      skillName: input.skillName || null,
      skillVersion: input.skillVersion || null,
      toolName: input.toolName || null,
      status: ["unknown", "success", "failure", "aborted"].includes(input.status) ? input.status : "unknown",
      retryCount: Number.isInteger(input.retryCount) && input.retryCount >= 0 ? input.retryCount : 0,
      timing: {
        skillLoadDurationMs: Number.isFinite(input.skillLoadDurationMs) ? input.skillLoadDurationMs : null,
        activeWindowMs: Number.isFinite(input.activeWindowMs) ? input.activeWindowMs : null,
        attributedToolDurationMs: Number.isFinite(input.attributedToolDurationMs) ? input.attributedToolDurationMs : null,
      },
      reasonCodes: [...new Set((input.reasonCodes || []).map(value => String(value).slice(0, 80)).filter(Boolean))].slice(0, 16),
    }) + "\n", "utf8")
    return true
  } catch {
    return false
  }
}

export const HarnessEnforcement = async ({ client, directory }) => {
  // State is resolved per real workspace and per opencode session. The CJS
  // hooks use the same workspaces/<key>/state/sessions/<id> contract, while
  // the old flat plugin state is intentionally left untouched because it is
  // impossible to attribute safely to one workspace or session.
  const workspace = resolve(directory || process.cwd())
  migrateLegacyFlatState(getStateDir(workspace))
  const activeVerifications = new Set()
  const telemetryToolStarts = new Map()
  const telemetryPendingSkills = new Map()
  const telemetryActiveSkills = new Map()

  function telemetryCallId(input) {
    const direct = input && (input.callID || input.callId || input.toolCallID || input.toolCallId)
    if (direct) return telemetryLocalId("call", direct)
    return `fifo:${String(input && input.sessionID || "default")}:${String(input && input.tool || "unknown")}`
  }

  function telemetryBefore(input) {
    try {
      if (!telemetryEnabled()) return
      const key = telemetryCallId(input)
      const queue = telemetryToolStarts.get(key) || []
      queue.push(Date.now())
      telemetryToolStarts.set(key, queue)

      if (input.tool !== "skill") return
      const skillName = telemetrySkillName(input.args && (input.args.skill || input.args.name || input.args.skillName))
      if (!skillName) return
      const invocationId = randomUUID()
      const pending = telemetryPendingSkills.get(key) || []
      pending.push({
        invocationId,
        skillName,
        skillVersion: telemetrySkillVersion(workspace, skillName),
        startedAt: Date.now(),
        sessionID: input.sessionID,
      })
      telemetryPendingSkills.set(key, pending)
      appendTelemetry(workspace, {
        event: "skill.invoke",
        sessionID: input.sessionID,
        agentID: input.agentID,
        invocationId,
        skillName,
        skillVersion: pending[pending.length - 1].skillVersion,
        status: "unknown",
        reasonCodes: ["opencode-skill-tool-before"],
      })
    } catch {}
  }

  function telemetryAfter(input) {
    try {
      if (!telemetryEnabled()) return
      const key = telemetryCallId(input)
      const starts = telemetryToolStarts.get(key) || []
      const startedAt = starts.shift()
      if (starts.length) telemetryToolStarts.set(key, starts)
      else telemetryToolStarts.delete(key)
      const duration = Number.isFinite(startedAt) ? Math.max(0, Date.now() - startedAt) : null

      if (input.tool === "skill") {
        const pending = telemetryPendingSkills.get(key) || []
        const load = pending.shift()
        if (pending.length) telemetryPendingSkills.set(key, pending)
        else telemetryPendingSkills.delete(key)
        if (load) {
          const activeKey = String(load.sessionID || "default")
          const active = telemetryActiveSkills.get(activeKey) || new Map()
          active.set(load.invocationId, {
            ...load,
            loadedAt: Date.now(),
            skillLoadDurationMs: duration,
            attributedToolDurationMs: 0,
            attributedToolCount: 0,
          })
          telemetryActiveSkills.set(activeKey, active)
          appendTelemetry(workspace, {
            event: "skill.loaded",
            sessionID: load.sessionID,
            invocationId: load.invocationId,
            skillName: load.skillName,
            skillVersion: load.skillVersion,
            status: "unknown",
            skillLoadDurationMs: duration,
            reasonCodes: ["opencode-after-no-normalized-status"],
          })
        }
        return
      }

      const active = telemetryActiveSkills.get(String(input.sessionID || "default"))
      if (!active || active.size === 0) return
      for (const entry of active.values()) {
        if (Number.isFinite(duration)) {
          entry.attributedToolDurationMs += duration
          entry.attributedToolCount++
        }
        appendTelemetry(workspace, {
          event: "tool.observed",
          sessionID: input.sessionID,
          agentID: input.agentID,
          invocationId: entry.invocationId,
          skillName: entry.skillName,
          skillVersion: entry.skillVersion,
          toolName: telemetryToolName(input.tool),
          status: "unknown",
          attributedToolDurationMs: duration,
          reasonCodes: [
            Number.isFinite(duration) ? "opencode-adapter-duration" : "tool-duration-unavailable",
            "skill-active-window-overlap",
          ],
        })
      }
    } catch {}
  }

  function telemetryCloseSession(sessionID, status = "unknown", reasonCode = "opencode-session-idle") {
    try {
      const key = String(sessionID || "default")
      const active = telemetryActiveSkills.get(key)
      if (!active) return
      const stoppedAt = Date.now()
      for (const entry of active.values()) {
        appendTelemetry(workspace, {
          event: "skill.complete",
          sessionID,
          invocationId: entry.invocationId,
          skillName: entry.skillName,
          skillVersion: entry.skillVersion,
          status,
          skillLoadDurationMs: entry.skillLoadDurationMs,
          activeWindowMs: Math.max(0, stoppedAt - entry.loadedAt),
          attributedToolDurationMs: entry.attributedToolCount ? entry.attributedToolDurationMs : null,
          reasonCodes: [reasonCode],
        })
      }
      telemetryActiveSkills.delete(key)
    } catch {}
  }

  function pathsFor(sessionID) {
    const stateDir = getSessionDir(workspace, sessionID)
    return {
      stateDir,
      editStateFile: join(stateDir, "edit-state.json"),
      breakerFile: join(stateDir, "circuit-breaker.json"),
      complianceFile: join(stateDir, "compliance.json"),
      reflectionFile: reflectionReportPath(stateDir),
    }
  }

  function resetSession(sessionID) {
    const { stateDir } = pathsFor(sessionID)
    const sessionsRoot = resolve(join(getStateRoot(workspace), "sessions"))
    if (!isWithin(sessionsRoot, stateDir) || resolve(stateDir) === sessionsRoot) return
    try { rmSync(stateDir, { recursive: true, force: true }) } catch { /* fail open */ }
  }

  function toolTarget(input, output) {
    const args = { ...((output && output.args) || {}), ...((input && input.args) || {}) }
    return args.filePath || args.file_path || args.path || args.filename || args.file || null
  }

  function patchTargets(input, output) {
    const args = { ...((output && output.args) || {}), ...((input && input.args) || {}) }
    if (typeof args.patchText !== "string") return []
    return [...args.patchText.matchAll(/^\*\*\*\s+(?:(?:Add|Update|Delete) File|Move to):[ \t]*([^\r\n]+)$/gm)]
      .map((match) => match[1].trim())
  }

  function isReflectionWrite(input, output, reportFile) {
    if (!EDIT_TOOLS.has(input.tool)) return false
    if (input.tool === "apply_patch") {
      const targets = patchTargets(input, output)
      return targets.length > 0 && targets.every((patchTarget) => samePath(resolve(workspace, patchTarget), reportFile))
    }
    const target = toolTarget(input, output)
    return Boolean(target && samePath(resolve(workspace, target), reportFile))
  }

  return {
    "tool.execute.before": async (input, output) => {
      telemetryBefore(input)
      if (!EDIT_TOOLS.has(input.tool)) return
      const { breakerFile, reflectionFile } = pathsFor(input.sessionID)
      const breaker = loadBreakerState(breakerFile)
      if (breaker.reflectionPending && !isReflectionWrite(input, output, reflectionFile)) {
        throw new Error(
          `Harness reflection is required before another code edit. ` +
            `Write a valid reflection report to "${reflectionFile}" first.`,
        )
      }
    },

    "tool.execute.after": async (input, output) => {
      telemetryAfter(input)
      if (!EDIT_TOOLS.has(input.tool)) return
      const { editStateFile, breakerFile, complianceFile, reflectionFile } = pathsFor(input.sessionID)

      // The reflection artifact is a protocol write, not a code edit. It is
      // accepted only when it contains the current token and all required
      // sections; this is the only path that records lastReflection.
      if (isReflectionWrite(input, output, reflectionFile)) {
        completeReflection(breakerFile, reflectionFile)
        return
      }

      const state = normalizeEditState(loadJSON(editStateFile, defaultEditState()))
      state.lastEditTime = Date.now()
      state.verificationPending = true
      state.followUpPending = false
      state.followUpDeliveryPending = false
      state.followUpMessage = null
      state.lastFollowUpError = null
      state.editsSinceVerification++
      saveJSON(editStateFile, state)
      recordCompliance(complianceFile, (c) => c.totalEdits++)
    },

    event: async ({ event }) => {
      const properties = event && event.properties
      const sessionID = properties && (properties.sessionID || (properties.info && properties.info.id))
      if (event.type === "session.created") {
        telemetryCloseSession(sessionID, "aborted", "opencode-session-recreated")
        resetSession(sessionID)
        return
      }
      if (event.type === "session.deleted") {
        telemetryCloseSession(sessionID, "aborted", "opencode-session-deleted")
        resetSession(sessionID)
        return
      }
      if (event.type !== "session.idle") return
      telemetryCloseSession(sessionID, "unknown", "opencode-session-idle")
      if (activeVerifications.has(sessionID || "default")) return

      const activeSession = sessionID || "default"
      activeVerifications.add(activeSession)
      try {
        const { editStateFile, breakerFile, complianceFile, reflectionFile } = pathsFor(activeSession)
        // This fallback makes the lifecycle complete even if the host omits
        // tool input args on the artifact's after hook.
        completeReflection(breakerFile, reflectionFile)

        const state = normalizeEditState(loadJSON(editStateFile, defaultEditState()))
        if (state.followUpPending) return

        if (state.followUpDeliveryPending && state.followUpMessage) {
          try {
            await client.session.prompt({
              path: { id: activeSession },
              body: { parts: [{ type: "text", text: state.followUpMessage }] },
            })
            state.followUpPending = true
            state.followUpDeliveryPending = false
            state.followUpMessage = null
            state.lastFollowUpError = null
            saveJSON(editStateFile, state)
          } catch (error) {
            state.lastFollowUpError = String(error && (error.message || error)).slice(0, 300)
            saveJSON(editStateFile, state)
          }
          return
        }

        if (!state.verificationPending || state.editsSinceVerification === 0) return

        const { allPassed, skipped, results } = runVerification(workspace)

        if (skipped || allPassed) {
          state.verificationPending = false
          state.followUpPending = false
          state.editsSinceVerification = 0
          saveJSON(editStateFile, state)
          recordCompliance(complianceFile, (c) => c.verifiedEdits++)
          return
        }

        const failing = results.find((r) => !r.success)
        const signature = extractFailureSignature(`${failing.command}: ${failing.error || ""}`)
        const trip = tripBreaker(breakerFile, signature)
        state.followUpPending = true
        saveJSON(editStateFile, state)

        let text
        if (trip.action === "force_reflection") {
          const { stateDir } = pathsFor(activeSession)
          text =
            `Harness: "${failing.command}" has now failed 3 times with the same error. Stop and reflect ` +
            `before retrying. Write a report to "${reflectionReportPath(stateDir)}" with sections ` +
            `## Goal, ## Failed Attempts, ## Verified Facts, ## Diagnosis, and ## Decision. ` +
            `The Decision must begin with RESUME: or ESCALATE:. Include reflection token: ${trip.reflectionToken}. ` +
            `After the report is recorded, resume with a different approach. Failure: ${failing.error || "(no output captured)"}`
          recordCompliance(complianceFile, (c) => {
            c.circuitBreakerTrips++
            c.reflectionsForced++
          })
        } else {
          text =
            `Harness: verification failed (${trip.remaining} retries before a forced reflection). ` +
            `"${failing.command}" - ${failing.error || "(no output captured)"}. Fix it and this will re-run automatically.`
        }

        try {
          await client.session.prompt({ path: { id: activeSession }, body: { parts: [{ type: "text", text }] } })
        } catch (error) {
          // A failed delivery is retryable on the next idle event, but the
          // saved message means retrying does not run verification again or
          // increment the circuit-breaker count.
          const failedState = normalizeEditState(loadJSON(editStateFile, defaultEditState()))
          failedState.followUpPending = false
          failedState.followUpDeliveryPending = true
          failedState.followUpMessage = text
          failedState.lastFollowUpError = String(error && (error.message || error)).slice(0, 300)
          saveJSON(editStateFile, failedState)
        }
      } finally {
        activeVerifications.delete(activeSession)
      }
    },
  }
}
