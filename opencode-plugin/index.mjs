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
 *   circuit-breaker.js -> tool.execute.before (throws to hard-block edit tools
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
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, realpathSync } from "node:fs"
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
// breaker trip in one opencode project hard-locked every other one too
// (issue #42 item #4).
function getWorkspaceKey(directory) {
  let real = resolve(directory)
  try { real = realpathSync(real) } catch { /* directory may not exist yet */ }
  const slug = basename(real).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "workspace"
  const hash = createHash("sha1").update(real).digest("hex").slice(0, 12)
  return `${slug}-${hash}`
}

function getStateRoot(directory) {
  return join(getStateHome(), "workspaces", getWorkspaceKey(directory), "state")
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
    hardLock: false,
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
  return { ...defaultBreakerState(), ...(state || {}), failures: (state && state.failures) || {} }
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
      (state.hardLock !== undefined && typeof state.hardLock !== "boolean") ||
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
  const breaker = normalizeBreakerState(loadJSON(breakerFile, defaultBreakerState()))
  if (!isValidReflection(reportFile, breaker)) return false
  const completedAt = Math.max(Date.now(), (breaker.reflectionRequestedAt || 0) + 1)
  breaker.lastReflection = completedAt
  breaker.lastReflectionSignature = breaker.reflectionSignature
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
 * action to take: allow (with retries remaining), force_reflection (3rd
 * failure on this signature), or hard_lock (same signature repeats after a
 * reflection was recorded).
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
    if (
      breaker.lastReflection &&
      breaker.lastReflection > entry.firstSeen &&
      breaker.lastReflectionSignature === signature
    ) {
      breaker.hardLock = true
      saveJSON(breakerFile, breaker)
      return { action: "hard_lock", count: entry.count }
    }
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

export const HarnessEnforcement = async ({ client, directory }) => {
  // State is resolved per real workspace and per opencode session. The CJS
  // hooks use the same workspaces/<key>/state/sessions/<id> contract, while
  // the old flat plugin state is intentionally left untouched because it is
  // impossible to attribute safely to one workspace or session.
  const workspace = resolve(directory || process.cwd())
  const activeVerifications = new Set()

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
    const target = toolTarget(input, output)
    if (target && resolve(workspace, target) === resolve(reportFile)) return true
    if (input.tool !== "apply_patch") return false
    return patchTargets(input, output).some((patchTarget) => resolve(workspace, patchTarget) === resolve(reportFile))
  }

  return {
    "tool.execute.before": async (input, output) => {
      if (!EDIT_TOOLS.has(input.tool)) return
      const { breakerFile, reflectionFile } = pathsFor(input.sessionID)
      const breaker = loadBreakerState(breakerFile)
      if (breaker.hardLock) {
        throw new Error(
          `Harness circuit breaker hard-locked after a repeat failure post-reflection. ` +
          `Delete "${breakerFile}" or start a new session to reset.`,
        )
      }
      if (breaker.reflectionPending && !isReflectionWrite(input, output, reflectionFile)) {
        throw new Error(
          `Harness reflection is required before another code edit. ` +
            `Write a valid reflection report to "${reflectionFile}" first.`,
        )
      }
    },

    "tool.execute.after": async (input, output) => {
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
        resetSession(sessionID)
        return
      }
      if (event.type === "session.deleted") {
        resetSession(sessionID)
        return
      }
      if (event.type !== "session.idle") return
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
        if (trip.action === "hard_lock") {
          text =
            `Harness: same verification failure ("${failing.command}") returned after a reflection was ` +
            `already recorded. The circuit breaker is now hard-locked - edits are blocked until it is reset.`
          recordCompliance(complianceFile, (c) => c.circuitBreakerTrips++)
        } else if (trip.action === "force_reflection") {
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
