/**
 * Harness Enforcement Plugin for opencode
 *
 * An ESM entry module, because that is what opencode actually loads: a JS/TS
 * file dropped in `.opencode/plugins/` (or referenced from `opencode.json`)
 * that exports a function returning a hooks object. The optional workflow
 * reconciliation path resolves the packaged sibling Stop consumer. There is
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
 *   compliance.js    -> folded into the same state writes, no separate stage
 *
 * The verification runner classifies test failures, timeouts, and execution
 * errors so its follow-up can describe the actual outcome. It does not track
 * failures across edits or gate later tools.
 */

import { homedir } from "node:os"
import { join, dirname, resolve, basename, relative, isAbsolute } from "node:path"
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, rmSync, realpathSync, readdirSync, statSync } from "node:fs"
import { spawn } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const EDIT_TOOLS = new Set(["edit", "write", "apply_patch"])
// shortcut: the 5s race cannot cancel a pending host lookup, upgrade when OpenCode exposes session.get cancellation.
const SESSION_LOOKUP_TIMEOUT_MS = 5000
const OPENCODE_CAPTURE_FILE = "opencode-captures.jsonl"
const OPENCODE_CAPTURE_LIMIT_BYTES = 4 * 1024 * 1024
const OPENCODE_CAPTURE_RECORD_LIMIT_BYTES = 16 * 1024
const requireFromPlugin = createRequire(import.meta.url)
const PLUGIN_DIRECTORY = dirname(fileURLToPath(import.meta.url))

function findHarnessRoot(start = PLUGIN_DIRECTORY) {
  let directory = resolve(start)
  for (let depth = 0; depth < 8; depth++) {
    if (existsSync(join(directory, "harness-everything", "scripts", "kernel-router.js"))
      && existsSync(join(directory, "hooks", "scripts", "lib", "observations.js"))) return directory
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return null
}

const HARNESS_ROOT = findHarnessRoot()
const STOP_GATE_FILE = join(HARNESS_ROOT || resolve(PLUGIN_DIRECTORY, ".."), "hooks", "scripts", "workflow-stop-gate.js")
const OBSERVATIONS_FILE = HARNESS_ROOT && join(HARNESS_ROOT, "hooks", "scripts", "lib", "observations.js")
const ROUTER_FILE = HARNESS_ROOT && join(HARNESS_ROOT, "harness-everything", "scripts", "kernel-router.js")
const LEDGER_MATCHER_FILE = HARNESS_ROOT && join(HARNESS_ROOT, "hooks", "scripts", "lib", "ledger-match.js")
const HARNESS_STATE_FILE = HARNESS_ROOT && join(HARNESS_ROOT, "hooks", "scripts", "lib", "harness-state.js")
let observationsApi
let ledgerMatcherApi
let harnessStateApi

function systemOneObservations() {
  if (!OBSERVATIONS_FILE) return null
  if (!observationsApi) {
    try { observationsApi = requireFromPlugin(OBSERVATIONS_FILE) } catch { return null }
  }
  return observationsApi
}

function ledgerMatcher() {
  if (!LEDGER_MATCHER_FILE || !HARNESS_STATE_FILE) return null
  try {
    ledgerMatcherApi ||= requireFromPlugin(LEDGER_MATCHER_FILE)
    harnessStateApi ||= requireFromPlugin(HARNESS_STATE_FILE)
    if (typeof ledgerMatcherApi.matchLedgerLessons !== "function"
      || typeof ledgerMatcherApi.releaseLedgerMatch !== "function"
      || typeof harnessStateApi.resolveWorkspaceIdentity !== "function"
      || typeof harnessStateApi.getSessionDir !== "function") return null
    return { matcher: ledgerMatcherApi, state: harnessStateApi }
  } catch { return null }
}

function queueLedgerLesson(pending, workspace, sessionID, event) {
  try {
    if (typeof workspace !== "string" || !workspace || typeof sessionID !== "string" || !sessionID) return
    const api = ledgerMatcher()
    if (!api) return
    const context = { workspace_root: workspace, session_id: sessionID, host_id: "opencode" }
    const identity = api.state.resolveWorkspaceIdentity(context)
    if (!identity?.workspaceRoot || !identity.workspaceKey || identity.sessionId !== sessionID) return
    if (identity.workspaceKey !== getWorkspaceKey(workspace)) return
    const result = api.matcher.matchLedgerLessons({
      workspaceRoot: identity.workspaceRoot,
      workspaceIdentity: identity.workspaceKey,
      sessionIdentity: sessionID,
      stateDir: api.state.getSessionDir(identity.workspaceRoot, sessionID, context),
      event,
    })
    if (!result) return
    const lessons = pending.get(sessionID) || []
    lessons.push({ workspace: identity.workspaceRoot, phase: event.phase, result })
    pending.set(sessionID, lessons)
  } catch { /* ledger context is fail-open */ }
}

function releaseLedgerLessons(lessons) {
  const api = ledgerMatcher()
  if (!api) return lessons
  return lessons.filter(lesson => !api.matcher.releaseLedgerMatch(lesson.result))
}

// OpenCode's host process is a compiled Bun binary, so process.execPath is the
// opencode executable. That binary cannot run a Node .js script - it treats the
// script path as a project directory (ENOTDIR) - so a non-Node host must run
// Harness scripts with `node` from PATH. Under Node the checked-in runtime is
// used as before; a Node that cannot be found stays fail-open, because the
// spawn error yields no injection and blocks no turn.
function harnessRuntime() {
  return process.versions.bun ? "node" : process.execPath
}

function runKernelRouter(payload, signal, unavailable) {
  if (signal?.aborted) return Promise.resolve(null)
  if (!ROUTER_FILE) {
    unavailable("runtime-missing")
    return Promise.resolve(null)
  }
  return new Promise(resolveOutput => {
    let stdout = ""
    let child, timeout, termination, failureReason, timedOut = false, settled = false
    const terminate = () => {
      if (!termination && child) termination = terminateVerificationChild(child)
    }
    const finish = async code => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal?.removeEventListener("abort", terminate)
      if (termination) await termination
      if (signal?.aborted || timedOut) {
        resolveOutput(null)
        return
      }
      if (failureReason || code !== 0) {
        unavailable(failureReason || "runtime-failed")
        resolveOutput(null)
        return
      }
      resolveOutput(stdout.trim())
    }
    try {
      child = spawn(harnessRuntime(), [ROUTER_FILE], {
        cwd: payload.cwd || HARNESS_ROOT,
        env: process.env,
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "ignore"],
        windowsHide: true,
      })
    } catch {
      unavailable("spawn-failed")
      resolveOutput(null)
      return
    }
    child.stdout.on("data", chunk => { stdout += chunk })
    child.stdin.on("error", () => { failureReason ||= "runtime-failed"; terminate() })
    child.once("error", () => {
      failureReason = child.pid ? "runtime-failed" : "spawn-failed"
      if (!child.pid) void finish(null)
      else terminate()
    })
    child.once("close", code => { void finish(code) })
    signal?.addEventListener("abort", terminate, { once: true })
    if (signal?.aborted) terminate()
    timeout = setTimeout(() => { timedOut = true; terminate() }, 5000)
    try { child.stdin.end(JSON.stringify(payload)) } catch { failureReason ||= "runtime-failed"; terminate() }
  })
}

function assistantTextForCurrentTurn(messages, userMessageID) {
  const items = Array.isArray(messages) ? messages : Array.isArray(messages?.data) ? messages.data : []
  const role = message => message?.info?.role || message?.info?.type || message?.role || message?.type
  const messageID = message => message?.info?.id ?? message?.id
  let lastUser = userMessageID
    ? items.findIndex(message => messageID(message) === userMessageID && role(message) === "user")
    : -1
  if (!userMessageID) {
    for (let i = items.length - 1; i >= 0; i--) {
      if (role(items[i]) === "user") { lastUser = i; break }
    }
  }
  if (lastUser < 0) return null
  for (let i = items.length - 1; i > lastUser; i--) {
    const message = items[i]
    if (role(message) !== "assistant") continue
    const parts = Array.isArray(message.parts) ? message.parts : Array.isArray(message.content) ? message.content : []
    const text = parts
      .filter(part => part?.type === "text" && typeof part.text === "string")
      .map(part => part.text).join("")
    if (text) return text
  }
  return null
}

function observeOpenCodeTool(event, workspace) {
  try {
    const observations = systemOneObservations()
    if (!observations || !observations.enabled() || !event?.sessionID) return
    const args = isRecord(event.input) ? event.input : {}
    const names = { edit: "Edit", write: "Write", apply_patch: "apply_patch", bash: "shell", skill: "Skill", read: "Read", task: "Task" }
    const toolInput = {
      ...args,
      file_path: args.filePath || args.file_path || args.path,
      command: args.command || args.cmd,
      skill: args.skill || args.name,
    }
    const failed = event.status === "error" || Boolean(event.error)
    observations.handle({
      hook_event_name: failed ? "PostToolUseFailure" : "PostToolUse",
      host: "opencode",
      session_id: event.sessionID,
      cwd: workspace,
      tool_name: names[String(event.tool || "").toLowerCase()] || event.tool,
      tool_input: toolInput,
      tool_response: event.result,
      error: failed,
    })
  } catch { /* turn observation is always fail-open */ }
}

async function observeOpenCodeCompletion(sessionID, ctx, promptRoutes, signal) {
  const prompt = promptRoutes.get(sessionID)
  promptRoutes.delete(sessionID)
  if (!prompt?.workspace || signal?.aborted) return
  try {
    const observations = systemOneObservations()
    if (!observations || !observations.enabled()) return
    let lastMessage = null
    const context = await awaitAbortableHostRead(() => ctx.session.context({ sessionID }), signal)
    if (context.status === "aborted" || signal?.aborted) return
    if (context.status === "resolved") lastMessage = assistantTextForCurrentTurn(context.value, prompt?.messageID)
    const payload = {
      hook_event_name: "Stop",
      host: "opencode",
      session_id: sessionID,
      ...(prompt?.messageID ? { turn_id: prompt.messageID } : {}),
      cwd: prompt.workspace,
      ...(lastMessage === null ? {} : { last_assistant_message: lastMessage }),
    }
    if (signal?.aborted) return
    observations.handle(payload)
  } catch { /* turn observation is always fail-open */ }
}

function awaitAbortableHostRead(read, signal) {
  return new Promise(resolveRead => {
    let settled = false
    const finish = result => {
      if (settled) return
      settled = true
      signal.removeEventListener("abort", onAbort)
      resolveRead(result)
    }
    const onAbort = () => finish({ status: "aborted" })
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener("abort", onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
      return
    }
    let raw
    try { raw = read() } catch (error) {
      finish({ status: "rejected", error })
      return
    }
    Promise.resolve(raw).then(
      value => finish({ status: "resolved", value }),
      error => finish({ status: "rejected", error }),
    )
  })
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson)
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalJson(value[key])]))
  return value
}

function captureDigest(value) {
  return createHash("sha256").update(JSON.stringify(canonicalJson(value))).digest("hex")
}

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
// machine. The pre-fix `~/.harness-state` had no such key at all, so plugin
// state from one OpenCode project could affect another (issue #42 item #4).
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
    editRevision: 0,
    followUpPending: false,
    followUpDeliveryPending: false,
    followUpMessage: null,
    lastFollowUpError: null,
    sessionStart: Date.now(),
  }
}

function normalizeEditState(state) {
  return { ...defaultEditState(), ...(state || {}) }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function defaultCompliance() {
  return {
    sessionStart: Date.now(),
    totalEdits: 0,
    verifiedEdits: 0,
  }
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

// Verification budget for the npm scripts run on session.idle. The Harness
// self-regression suite needs ~2 minutes on a laptop, so the original 60s cap
// killed healthy runs and reported them as failures. One wall-clock budget
// covers the sequence. Output is consumed as it arrives and only bounded
// excerpts remain in memory. The manual verification CLI remains separate.
const VERIFY_TIMEOUT_ENV = "HARNESS_VERIFY_TIMEOUT_MS"
const DEFAULT_VERIFY_TIMEOUT_MS = 600000
const VERIFY_OUTPUT_LIMIT = 2000
const VERIFY_KILL_GRACE_MS = 150

function verifyTimeoutMs() {
  const raw = Number(process.env[VERIFY_TIMEOUT_ENV])
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_VERIFY_TIMEOUT_MS
}

// Keep bounded diagnostic excerpts while consuming the complete streams.
function createVerificationCapture() {
  let head = "", tail = "", length = 0, bytes = 0
  return {
    write(chunk) {
      const text = String(chunk)
      bytes += Buffer.byteLength(text)
      length += text.length
      if (head.length < VERIFY_OUTPUT_LIMIT) head += text.slice(0, VERIFY_OUTPUT_LIMIT - head.length)
      tail = (tail + text).slice(-VERIFY_OUTPUT_LIMIT)
    },
    excerpt(limit) {
      if (length <= limit) return head.slice(0, length)
      const half = Math.floor(limit / 2)
      return `${head.slice(0, half)}\n... [${length - half * 2} chars omitted] ...\n${tail.slice(-half)}`
    },
    get bytes() { return bytes },
  }
}

// Kill the whole shell/npm/script group, including children which inherited
// the output pipes. On POSIX the grace timer still kills the group after the
// shell exits; otherwise a SIGTERM-ignoring grandchild could survive it.
async function terminateVerificationChild(child) {
  if (!child || !child.pid) return
  if (process.platform === "win32") {
    await new Promise(resolveKill => {
      try {
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" })
        killer.once("error", () => { try { child.kill("SIGKILL") } catch {} resolveKill() })
        killer.once("close", resolveKill)
      } catch { try { child.kill("SIGKILL") } catch {} resolveKill() }
    })
    return
  }
  try { process.kill(-child.pid, "SIGTERM") } catch { /* group already exited */ }
  await new Promise(resolveKill => setTimeout(resolveKill, VERIFY_KILL_GRACE_MS))
  try { process.kill(-child.pid, "SIGKILL") } catch { /* group already exited */ }
}

function runVerificationCommand(cwd, command, remainingMs, signal, onProgress) {
  return new Promise(resolveCommand => {
    const stdout = createVerificationCapture(), stderr = createVerificationCapture()
    let child, spawnError = null, termination = null, timedOut = false, cancelled = false
    let timer, progressTimer
    const terminate = reason => {
      if (termination) return
      timedOut = reason === "timeout"
      cancelled = reason === "cancelled"
      termination = terminateVerificationChild(child)
    }
    const abort = () => terminate("cancelled")
    const finish = async (exitCode, childSignal) => {
      clearTimeout(timer)
      clearInterval(progressTimer)
      signal?.removeEventListener("abort", abort)
      if (termination) await termination
      const both = stdout.bytes > 0 && stderr.bytes > 0
      const errorOutput = both
        ? `stdout:\n${stdout.excerpt(VERIFY_OUTPUT_LIMIT/2)}\nstderr:\n${stderr.excerpt(VERIFY_OUTPUT_LIMIT/2)}`
        : (stdout.bytes ? stdout : stderr).excerpt(VERIFY_OUTPUT_LIMIT)
      const outcome = timedOut ? "timeout"
        : cancelled || spawnError || childSignal || !Number.isInteger(exitCode) ? "execution_error"
          : exitCode === 0 ? "pass" : "test_failure"
      const result = { command, success: outcome === "pass", outcome, exitCode: spawnError ? null : exitCode, signal: childSignal || null, timedOut }
      if (outcome !== "pass") {
        if (timedOut) result.error = `timed out after the total verification budget (set ${VERIFY_TIMEOUT_ENV} to raise it); last output: ${errorOutput}`
        else if (outcome === "execution_error") result.error = `could not run to completion (execution error: ${cancelled ? "cancelled" : spawnError?.code || (childSignal ? `signal ${childSignal}` : "no exit status")}); output: ${errorOutput || spawnError?.message || "(none)"}`
        else result.error = errorOutput || `command exited ${exitCode}`
      }
      resolveCommand(result)
    }
    if (signal?.aborted) {
      cancelled = true
      void finish(null, null)
      return
    }
    try {
      child = spawn(command, { cwd, shell: true, detached: process.platform !== "win32", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
    } catch (error) {
      spawnError = error
      void finish(null, null)
      return
    }
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", chunk => stdout.write(chunk))
    child.stderr.on("data", chunk => stderr.write(chunk))
    for (const stream of [child.stdout, child.stderr]) stream.once("error", error => {
      spawnError = error
      terminate("stream-error")
    })
    child.once("error", error => { spawnError = error })
    child.once("exit", (_code, signalName) => {
      if (signalName && !termination) terminate("external")
    })
    child.once("close", (code, signalName) => { void finish(code, signalName) })
    signal?.addEventListener("abort", abort, { once: true })
    timer = setTimeout(() => terminate("timeout"), Math.max(1, remainingMs))
    if (onProgress) progressTimer = setInterval(() => {
      try { onProgress({ command, outputBytes: stdout.bytes + stderr.bytes }) } catch { /* logging cannot alter a verdict */ }
    }, 15000)
  })
}

async function runVerification(cwd, { signal, onProgress } = {}) {
  const scripts = getAvailableScripts(cwd)
  const commands = ["test", "lint", "build"].filter(script => scripts[script])
    .map(script => script === "test" ? "npm test" : `npm run ${script}`)
  if (commands.length === 0) return { allPassed: true, skipped: true, results: [] }
  const deadline = Date.now() + verifyTimeoutMs()
  const results = []
  for (const command of commands) {
    if (signal?.aborted) break
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) {
      results.push({ command, success: false, outcome: "timeout", exitCode: null, signal: null, timedOut: true,
        error: `timed out after the total verification budget (set ${VERIFY_TIMEOUT_ENV} to raise it); command not started` })
      break
    }
    const result = await runVerificationCommand(cwd, command, remainingMs, signal, onProgress)
    results.push(result)
    if (result.outcome === "timeout") break
  }
  return { allPassed: !signal?.aborted && results.every(result => result.success), skipped: false, results }
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

export const HarnessEnforcement = async ({ client, directory, signal }) => {
  // State is resolved per real workspace and per opencode session. The CJS
  // hooks use the same workspaces/<key>/state/sessions/<id> contract, while
  // the old flat plugin state is intentionally left untouched because it is
  // impossible to attribute safely to one workspace or session.
  const workspace = resolve(directory || process.cwd())
  migrateLegacyFlatState(getStateDir(workspace))
  const activeVerifications = new Map()
  signal?.addEventListener("abort", () => {
    for (const controller of activeVerifications.values()) controller.abort()
  }, { once: true })
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
      complianceFile: join(stateDir, "compliance.json"),
    }
  }

  function recordHostCapture(input, output) {
    try {
      if (!isRecord(output) || output.status === undefined || typeof input?.sessionID !== "string" || !input.sessionID
        || typeof input.callID !== "string" || !input.callID || typeof input.tool !== "string" || !input.tool) return
      const stateDir = pathsFor(input.sessionID).stateDir
      const file = join(stateDir, OPENCODE_CAPTURE_FILE)
      const args = isRecord(input.args) ? input.args : {}
      const record = {
        schema: "opencode-capture-record/1",
        hostId: "opencode",
        session_id: input.sessionID,
        call_id: input.callID,
        ...(typeof output.messageID === "string" ? { message_id: output.messageID } : {}),
        tool: input.tool,
        status: output.status,
        ...(typeof args.command === "string" ? { command: args.command } : {}),
        ...(typeof args.cwd === "string" ? { cwd: args.cwd } : {}),
        ...(isRecord(output.result?.metadata) && typeof output.result.metadata.exit === "number" && Number.isFinite(output.result.metadata.exit)
          ? { exit: output.result.metadata.exit } : {}),
        ...(output.result !== undefined
          ? { result_digest: captureDigest(output.result), result_bytes: Buffer.byteLength(JSON.stringify(canonicalJson(output.result))) } : {}),
        ...(output.error !== undefined && output.error !== null
          ? { error: isRecord(output.error)
            ? Object.fromEntries(["name", "message", "code"].filter(key => typeof output.error[key] === "string").map(key => [key, output.error[key].slice(0, 300)]))
            : typeof output.error === "string" ? { message: output.error.slice(0, 300) } : {} } : {}),
        ts: new Date().toISOString(),
      }
      try {
        const workflow = JSON.parse(readFileSync(join(stateDir, "workflow-run.json"), "utf8"))
        if (typeof workflow.workflowId === "string" && Number.isInteger(workflow.revision)) {
          const pin = isRecord(workflow.docReconciliationBaseline) ? workflow.docReconciliationBaseline : {}
          record.observedIdentity = { workflowId: workflow.workflowId, workflowRevision: workflow.revision,
            baselinePin: typeof pin.commit === "string" && typeof pin.root === "string" ? { commit: pin.commit, root: pin.root } : null }
        }
      } catch { /* pre-workflow events cannot be bound to a later workflow */ }
      const line = `${JSON.stringify(record)}\n`
      if (Buffer.byteLength(line) > OPENCODE_CAPTURE_RECORD_LIMIT_BYTES) return
      mkdirSync(stateDir, { recursive: true })
      const size = existsSync(file) ? statSync(file).size : 0
      if (size + Buffer.byteLength(line) > OPENCODE_CAPTURE_LIMIT_BYTES) return
      appendFileSync(file, line, "utf8")
    } catch { /* capture is diagnostic only; an unavailable journal never grants credit */ }
  }

  function resetSession(sessionID) {
    const activeKey = sessionID || "default"
    const controller = activeVerifications.get(activeKey)
    if (controller) {
      controller.reset = true
      controller.abort()
    }
    activeVerifications.delete(activeKey)
    const { stateDir } = pathsFor(sessionID)
    const sessionsRoot = resolve(join(getStateRoot(workspace), "sessions"))
    if (!isWithin(sessionsRoot, stateDir) || resolve(stateDir) === sessionsRoot) return
    try { rmSync(stateDir, { recursive: true, force: true }) } catch { /* fail open */ }
  }

  return {
    "tool.execute.before": async input => {
      telemetryBefore(input)
    },

    "tool.execute.after": async (input, output) => {
      telemetryAfter(input)
      recordHostCapture(input, output)
      if (!EDIT_TOOLS.has(input.tool)) return
      const { editStateFile, complianceFile } = pathsFor(input.sessionID)

      const state = normalizeEditState(loadJSON(editStateFile, defaultEditState()))
      activeVerifications.get(input.sessionID || "default")?.abort()
      state.lastEditTime = Date.now()
      state.verificationPending = true
      state.followUpPending = false
      state.followUpDeliveryPending = false
      state.followUpMessage = null
      state.lastFollowUpError = null
      state.editsSinceVerification++
      state.editRevision = (Number.isSafeInteger(state.editRevision) ? state.editRevision : 0) + 1
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
      if (signal?.aborted) return
      telemetryCloseSession(sessionID, "unknown", "opencode-session-idle")
      const activeSession = sessionID || "default"
      const previous = activeVerifications.get(activeSession)
      if (previous) {
        if (!previous.signal.aborted) return
        // An edit has cancelled the old run, but its process group may still
        // be closing. Keep this idle and verify the new revision once reaped.
        await previous.finished
        if (signal?.aborted || previous.reset || activeVerifications.has(activeSession)) return
      }
      const controller = new AbortController()
      let finishVerification
      controller.finished = new Promise(resolveFinished => { finishVerification = resolveFinished })
      activeVerifications.set(activeSession, controller)
      try {
        const { editStateFile, complianceFile } = pathsFor(activeSession)

        const state = normalizeEditState(loadJSON(editStateFile, defaultEditState()))
        if (state.followUpPending) return

        if (state.followUpDeliveryPending && state.followUpMessage) {
          try {
            await client.session.prompt({
              path: { id: activeSession },
              body: { parts: [{ type: "text", text: state.followUpMessage }] },
            })
            if (controller.signal.aborted) return
            state.followUpPending = true
            state.followUpDeliveryPending = false
            state.followUpMessage = null
            state.lastFollowUpError = null
            saveJSON(editStateFile, state)
          } catch (error) {
            if (controller.signal.aborted) return
            state.lastFollowUpError = String(error && (error.message || error)).slice(0, 300)
            saveJSON(editStateFile, state)
          }
          return
        }

        if (!state.verificationPending || state.editsSinceVerification === 0) return

        const revision = state.editRevision
        const { allPassed, skipped, results } = await runVerification(workspace, {
          signal: controller.signal,
          onProgress: ({ command, outputBytes }) => console.info(`Harness: ${command} still running (${outputBytes} output bytes; shared verification budget).`),
        })
        // An edit or reset during await invalidates this snapshot. It must not
        // clear newer edits, issue a stale follow-up, or resurrect deleted state.
        if (controller.signal.aborted || activeVerifications.get(activeSession) !== controller) return
        const latest = normalizeEditState(loadJSON(editStateFile, defaultEditState()))
        if (latest.editRevision !== revision) return

        if (skipped || allPassed) {
          state.verificationPending = false
          state.followUpPending = false
          state.editsSinceVerification = 0
          saveJSON(editStateFile, state)
          recordCompliance(complianceFile, (c) => c.verifiedEdits++)
          return
        }

        const failing = results.filter((r) => !r.success)
        const confirmed = failing.find((r) => r.outcome === "test_failure")
        const primary = confirmed || failing[0]
        state.followUpPending = true
        saveJSON(editStateFile, state)

        let text
        if (!confirmed) {
          // Timeout or execution error: no check produced a verdict.
          const detail =
            primary.outcome === "timeout"
              ? `timed out (budget ${Math.round(verifyTimeoutMs() / 1000)}s; set ${VERIFY_TIMEOUT_ENV} to raise it)`
              : "could not run to completion (execution error, not a confirmed test failure)"
          text =
            `Harness: verification did not complete - "${primary.command}" ${detail}. ` +
            `Diagnostics: ${primary.error || "(no output captured)"}. ` +
            `Fix the cause (or raise the budget) and verify again; a new edit re-runs verification.`
        } else {
          text =
            `Harness: verification failed - "${confirmed.command}" - ${confirmed.error || "(no output captured)"}. ` +
            `Review the result, address the cause, and verify again.`
        }

        try {
          await client.session.prompt({ path: { id: activeSession }, body: { parts: [{ type: "text", text }] } })
        } catch (error) {
          if (controller.signal.aborted) return
          // A failed delivery is retryable on the next idle event, but the
          // saved message means retrying does not run verification again.
          const failedState = normalizeEditState(loadJSON(editStateFile, defaultEditState()))
          failedState.followUpPending = false
          failedState.followUpDeliveryPending = true
          failedState.followUpMessage = text
          failedState.lastFollowUpError = String(error && (error.message || error)).slice(0, 300)
          saveJSON(editStateFile, failedState)
        }
      } finally {
        try {
          if (!controller.signal.aborted) requireFromPlugin(STOP_GATE_FILE).decide({ session_id: activeSession, cwd: workspace, host_id: "opencode" })
        } catch { /* the optional reconciliation consumer must never block OpenCode idle */ }
        if (activeVerifications.get(activeSession) === controller) activeVerifications.delete(activeSession)
        finishVerification()
      }
    },
  }
}

// ---------------------------------------------------------------------------
// OpenCode 2.x entrypoint.
//
// OpenCode 2 changed the plugin contract: a plugin default-exports
// { id, setup(ctx) } and registers hooks through domains (ctx.tool.hook,
// ctx.event.subscribe, ctx.session.*) instead of returning a hooks object from
// a named factory. A named-export-only module fails to load with
// "Plugin must export a default definition with an id and an effect or setup
// function" (SchemaError at ["default"]) - this is what tripped the global
// install on this machine's OpenCode 2.1.3.
//
// The named `HarnessEnforcement` factory above keeps the hooks-object shape
// used by the repository mechanism tests (and by OpenCode 1.x hosts); this
// default export adapts it to the V2 hooks. Tool hook events are verified
// OpenCode 2.1.3 shapes: execute.before is {tool, sessionID, agent, messageID,
// id, input} with `input` carrying the tool args; execute.after adds
// {status, result | error}.
export default {
  id: "harness.enforcement",
  async setup(ctx) {
    const events = new AbortController()
    const promptRoutes = new Map()
    const sessionBindings = new Map()
    const sessionOwners = new Map()
    const pendingLedgerLessons = new Map()
    const ledgerReleaseRetry = new Set()
    const invalidatedSessions = new Set()
    const enforcementByWorkspace = new Map()
    const pendingEvents = new Set()
    const trackPending = work => {
      const pending = Promise.resolve().then(work)
      pendingEvents.add(pending)
      pending.then(() => pendingEvents.delete(pending), () => pendingEvents.delete(pending))
      return pending
    }
    const retryLedgerReleases = () => {
      for (const lesson of ledgerReleaseRetry) {
        if (releaseLedgerLessons([lesson]).length === 0) ledgerReleaseRetry.delete(lesson)
      }
    }
    const releaseSessionLedger = sessionID => {
      const lessons = pendingLedgerLessons.get(sessionID) || []
      pendingLedgerLessons.delete(sessionID)
      for (const lesson of releaseLedgerLessons(lessons)) ledgerReleaseRetry.add(lesson)
      retryLedgerReleases()
    }
    const releaseAllLedger = () => {
      for (const sessionID of pendingLedgerLessons.keys()) releaseSessionLedger(sessionID)
      retryLedgerReleases()
    }
    events.signal.addEventListener("abort", releaseAllLedger, { once: true })
    let unresolvedIdentityCount = 0
    const routerUnavailableCounts = new Map()

    const routerUnavailable = reason => {
      const count = (routerUnavailableCounts.get(reason) || 0) + 1
      routerUnavailableCounts.set(reason, count)
      try { console.warn(`[Harness] OpenCode router-unavailable (${reason}; count=${count})`) } catch {}
    }
    const unresolvedIdentity = reason => {
      unresolvedIdentityCount++
      try { console.warn(`[Harness] OpenCode session workspace unresolved (${reason}; count=${unresolvedIdentityCount}); workspace-dependent handling skipped.`) } catch {}
    }
    const resolveSessionWorkspace = sessionID => new Promise(resolveIdentity => {
      if (events.signal.aborted) {
        resolveIdentity({ reason: "plugin-disposed" })
        return
      }
      let settled = false
      let timer
      const onAbort = () => finish({ reason: "plugin-disposed" })
      const finish = result => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        events.signal.removeEventListener("abort", onAbort)
        resolveIdentity(result)
      }
      timer = setTimeout(() => finish({ reason: "session-lookup-timeout" }), SESSION_LOOKUP_TIMEOUT_MS)
      events.signal.addEventListener("abort", onAbort, { once: true })
      if (events.signal.aborted) {
        onAbort()
        return
      }
      if (typeof ctx.session?.get !== "function") {
        finish({ reason: "session-lookup-unavailable" })
        return
      }
      let lookup
      try { lookup = ctx.session.get({ sessionID }) } catch {
        finish({ reason: "session-lookup-failed" })
        return
      }
      Promise.resolve(lookup).then(session => {
        const directory = session?.location?.directory
        if (typeof directory !== "string" || !directory.trim()) {
          finish({ reason: "session-directory-unavailable" })
        } else if (!isAbsolute(directory)) {
          finish({ reason: "session-directory-invalid" })
        } else {
          finish({ workspace: resolve(directory) })
        }
      }, () => finish({ reason: "session-lookup-failed" }))
    })
    const enforcementFor = workspace => {
      if (events.signal.aborted) return Promise.resolve(null)
      if (!enforcementByWorkspace.has(workspace)) {
        enforcementByWorkspace.set(workspace, HarnessEnforcement({
          signal: events.signal,
          client: {
            session: {
              // V1 shutdown path calls client.session.prompt({path, body}) twice;
              // map it onto the V2 session API instead of duplicating the code.
              prompt: ({ path, body }) =>
                ctx.session.prompt({
                  sessionID: path && path.id,
                  text: (body && body.parts || []).map((part) => part && part.text || "").join(""),
                }),
            },
          },
          directory: workspace,
        }))
      }
      return enforcementByWorkspace.get(workspace)
    }
    const bindSessionWorkspace = (sessionID, workspace, hooks) => {
      const owners = sessionOwners.get(sessionID) || new Set()
      let binding = [...owners].find(owner => owner.workspace === workspace)
      if (!binding) {
        binding = { workspace, hooks }
        owners.add(binding)
        sessionOwners.set(sessionID, owners)
      }
      sessionBindings.set(sessionID, binding)
      return binding
    }
    const bindingForSession = async sessionID => {
      if (events.signal.aborted || typeof sessionID !== "string" || !sessionID) return null
      if (invalidatedSessions.has(sessionID)) return null
      const prompt = promptRoutes.get(sessionID)
      if (prompt && prompt.status !== "resolved") return null
      const existing = sessionBindings.get(sessionID)
      if (existing) return existing
      const identity = await resolveSessionWorkspace(sessionID)
      if (events.signal.aborted || !identity.workspace) {
        if (!events.signal.aborted) unresolvedIdentity(identity.reason)
        return null
      }
      if (invalidatedSessions.has(sessionID) || promptRoutes.get(sessionID) !== prompt) return null
      let hooks = null
      try { hooks = await enforcementFor(identity.workspace) } catch {}
      if (events.signal.aborted || invalidatedSessions.has(sessionID) || promptRoutes.get(sessionID) !== prompt) return null
      return bindSessionWorkspace(sessionID, identity.workspace, hooks)
    }
    const deliverLedgerLessons = event => {
      const sessionID = event?.sessionID
      if (typeof sessionID !== "string" || !sessionID || (event.kind && event.kind !== "primary")) return
      const lessons = pendingLedgerLessons.get(sessionID)
      if (!lessons?.length) return
      const workspace = sessionBindings.get(sessionID)?.workspace
      if (!Array.isArray(event.system) || invalidatedSessions.has(sessionID) || !workspace
        || lessons.some(lesson => getWorkspaceKey(lesson.workspace) !== getWorkspaceKey(workspace))) {
        releaseSessionLedger(sessionID)
        return
      }
      try {
        event.system.push(...lessons.map(lesson => ({ type: "text", text: lesson.result.text })))
        pendingLedgerLessons.delete(sessionID)
      } catch {
        releaseSessionLedger(sessionID)
      }
    }

    await ctx.session.hook("prompt", event => {
      if (events.signal.aborted) return
      return trackPending(async () => {
        try {
          if (events.signal.aborted || typeof event?.sessionID !== "string" || typeof event.prompt?.text !== "string") return
          const messageID = event.messageID || event.messageId || null
          const previous = promptRoutes.get(event.sessionID)
          if (messageID && previous?.messageID === messageID) {
            await previous.routerPromise
            return
          }
          invalidatedSessions.delete(event.sessionID)
          const prompt = { messageID, text: event.prompt.text, routerOutput: null, routerPromise: null,
            workspace: null, hooks: null, status: "pending" }
          promptRoutes.set(event.sessionID, prompt)
          prompt.routerPromise = (previous?.routerPromise || Promise.resolve())
            .catch(() => null)
            .then(async () => {
              if (events.signal.aborted || promptRoutes.get(event.sessionID) !== prompt) return
              const identity = await resolveSessionWorkspace(event.sessionID)
              if (events.signal.aborted || promptRoutes.get(event.sessionID) !== prompt) return
              if (!identity.workspace) {
                prompt.status = "failed"
                unresolvedIdentity(identity.reason)
                return
              }
              prompt.workspace = identity.workspace
              try { prompt.hooks = await enforcementFor(prompt.workspace) } catch {}
              if (events.signal.aborted || promptRoutes.get(event.sessionID) !== prompt) return
              bindSessionWorkspace(event.sessionID, prompt.workspace, prompt.hooks)
              prompt.status = "resolved"
              try {
                if (events.signal.aborted) return
                const observations = systemOneObservations()
                if (observations && observations.enabled()) {
                  observations.handle({ hook_event_name: "UserPromptSubmit", host: "opencode", session_id: event.sessionID,
                    ...(prompt.messageID ? { turn_id: prompt.messageID } : {}), cwd: prompt.workspace, prompt: event.prompt.text })
                }
              } catch { /* turn observation is always fail-open */ }
              if (events.signal.aborted) return
              const routerPayload = { host: "opencode", session_id: event.sessionID,
                ...(prompt.messageID ? { turn_id: prompt.messageID } : {}), cwd: prompt.workspace, prompt: event.prompt.text }
              const routerOutput = await runKernelRouter(routerPayload, events.signal, routerUnavailable)
              if (!events.signal.aborted && promptRoutes.get(event.sessionID) === prompt) prompt.routerOutput = routerOutput
            })
          await prompt.routerPromise
        } catch { /* routing context is fail-open; do not reject prompt admission */ }
      })
    })
    await ctx.session.hook("context", event => {
      if (events.signal.aborted) return
      const output = promptRoutes.get(event?.sessionID)?.routerOutput
      if (output && (!event.kind || event.kind === "primary") && Array.isArray(event.system)
        && !event.system.some(part => part && part.text === output)) event.system.push({ type: "text", text: output })
      deliverLedgerLessons(event)
    })

    await ctx.tool.hook("execute.before", event => {
      if (events.signal.aborted) return
      return trackPending(async () => {
        if (events.signal.aborted) return
        const binding = await bindingForSession(event?.sessionID)
        if (events.signal.aborted || !binding?.workspace) return
        retryLedgerReleases()
        if (event.tool === "bash" && typeof event.input?.command === "string") {
          queueLedgerLesson(pendingLedgerLessons, binding.workspace, event.sessionID, {
            phase: "action", tool: "shell", command: event.input.command, outcome: { failed: "unknown" },
          })
        }
        if (!binding.hooks) return
        return binding.hooks["tool.execute.before"](toolEventInput(event), { args: event.input })
      })
    })
    await ctx.tool.hook("execute.after", event => {
      if (events.signal.aborted) return
      return trackPending(async () => {
        if (events.signal.aborted) return
        const prompt = promptRoutes.get(event?.sessionID)
        const binding = await bindingForSession(event?.sessionID)
        if (events.signal.aborted || !binding?.workspace) return
        retryLedgerReleases()
        const errorOutput = event.status === "error"
          ? typeof event.error === "string" ? event.error
            : typeof event.error?.message === "string" ? event.error.message : undefined
          : undefined
        const resultExit = event.status === "completed" && Number.isFinite(event.result?.metadata?.exit)
          ? event.result.metadata.exit : null
        const resultFailed = resultExit !== null && resultExit !== 0
        const resultOutput = typeof event.result?.output === "string" ? event.result.output : undefined
        const failureOutput = errorOutput ?? resultOutput
        if (event.tool === "bash" && failureOutput !== undefined && typeof event.input?.command === "string") {
          queueLedgerLesson(pendingLedgerLessons, binding.workspace, event.sessionID, {
            phase: "failure", tool: "shell", command: event.input.command,
            outcome: { failed: event.status === "error" || resultFailed ? true : resultExit === null ? "unknown" : false,
              output: failureOutput },
          })
        }
        if (prompt?.status === "resolved" && prompt.workspace) observeOpenCodeTool(event, prompt.workspace)
        if (!binding.hooks) return
        return binding.hooks["tool.execute.after"](toolEventInput(event), {
          args: event.input,
          status: event.status,
          result: event.result,
          error: event.error,
          messageID: event.messageID,
        })
      })
    })

    trackPending(async () => {
      try {
        for await (const raw of ctx.event.subscribe({ signal: events.signal })) {
          if (events.signal.aborted) break
          // OpenCode 2.x events are flat with the session id at data.sessionID;
          // V1 hosts keep it top-level. V2 hosts send no session.idle, so a
          // completed turn ends with session.execution.succeeded.
          const sessionID = raw.sessionID || (raw.data && raw.data.sessionID)
            || (raw.properties && (raw.properties.sessionID || raw.properties.info?.id))
          const turnEnded = raw.type === "session.idle" || raw.type === "session.execution.succeeded"
          const lifecycleEvent = ["session.idle", "session.created", "session.deleted"].includes(raw.type)
          if ((!turnEnded && !lifecycleEvent) || typeof sessionID !== "string" || !sessionID) continue
          retryLedgerReleases()
          if (raw.type === "session.deleted") invalidatedSessions.add(sessionID)
          else if (raw.type === "session.created") invalidatedSessions.delete(sessionID)
          if (raw.type === "session.created" || raw.type === "session.deleted") {
            releaseSessionLedger(sessionID)
            promptRoutes.delete(sessionID)
          }
          const prompt = promptRoutes.get(sessionID)
          if (turnEnded && prompt?.status === "resolved") {
            trackPending(() => observeOpenCodeCompletion(sessionID, ctx, promptRoutes, events.signal))
          }
          let bindings
          if (raw.type === "session.created" || raw.type === "session.deleted") {
            bindings = [...(sessionOwners.get(sessionID) || [])]
            if (!bindings.length && !invalidatedSessions.has(sessionID)) {
              const binding = await bindingForSession(sessionID)
              if (binding) bindings = [binding]
            }
          } else {
            const binding = await bindingForSession(sessionID)
            bindings = binding ? [binding] : []
          }
          const event = {
            type: turnEnded ? "session.idle" : raw.type,
            properties: { ...raw, ...(isRecord(raw.properties) ? raw.properties : {}), sessionID },
          }
          const cleanupDelivery = raw.type === "session.created" || raw.type === "session.deleted"
          const delivery = trackPending(() => Promise.allSettled(bindings.filter(binding => binding?.hooks?.event)
            .map(binding => Promise.resolve().then(() => {
              if (events.signal.aborted && !cleanupDelivery) return
              return binding.hooks.event({ event })
            }))))
          if (!turnEnded) await delivery
          if (raw.type === "session.created" || raw.type === "session.deleted") {
            promptRoutes.delete(sessionID)
            sessionBindings.delete(sessionID)
            sessionOwners.delete(sessionID)
          }
        }
      } catch { /* aborting the host subscription is normal shutdown */ }
      finally { events.abort() }
    })
    return async () => {
      events.abort()
      while (pendingEvents.size) await Promise.allSettled([...pendingEvents])
    }
  },
}

// Build the V1-shaped (input, output) pair the legacy hooks expect from the
// V2 tool-hook event: legacy telemetry reads callID/agentID/sessionID and
// `.args`, and edit detection reads output.args, which is the same input args
// object in the V2 API.
function toolEventInput(event) {
  const input = event.input && typeof event.input === "object" ? event.input : {}
  return {
    ...input,
    args: input,
    tool: event.tool,
    sessionID: event.sessionID,
    agentID: event.agent,
    callID: event.id,
    callId: event.id,
  }
}
