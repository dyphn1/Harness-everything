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
 *   circuit-breaker.js -> tool.execute.before (throws to pause edit tools for the zoom-out boundary
 *                       once locked) + failure tracking inside session.idle
 *   compliance.js    -> folded into the same state writes, no separate stage
 *
 * The circuit breaker trips on repeated *verification* failures of the same
 * underlying check (same command + normalized failure evidence: the first
 * test-level failing marker with its suite header as context, or a digest of
 * the complete streamed stdout+stderr when no test-level marker exists), not on
 * arbitrary tool failures: tool.execute.after
 * gives back `{title, output, metadata}` for every tool with no normalized
 * success/failure field, so there is no reliable cross-tool failure signal to
 * key a signature on. Verification failures are self-produced and already
 * normalized, so that is the honest signal to use. Uncompleted verifications
 * (timeout, execution error such as ENOBUFS/ENOENT) are reported as failures
 * but never counted toward the same-check threshold, because no failing check
 * was actually confirmed.
 */

import { homedir } from "node:os"
import { join, dirname, resolve, basename, relative, isAbsolute } from "node:path"
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, rmSync, realpathSync, readdirSync, statSync } from "node:fs"
import { spawn } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const EDIT_TOOLS = new Set(["edit", "write", "apply_patch"])
const OPENCODE_CAPTURE_FILE = "opencode-captures.jsonl"
const OPENCODE_CAPTURE_LIMIT_BYTES = 4 * 1024 * 1024
const OPENCODE_CAPTURE_RECORD_LIMIT_BYTES = 16 * 1024
const requireFromPlugin = createRequire(import.meta.url)
const STOP_GATE_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "hooks", "scripts", "workflow-stop-gate.js")

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
    editRevision: 0,
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
    console.warn(`Harness: ignoring corrupt circuit-breaker state at "${file}" and starting fresh.`)
    return defaultBreakerState()
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

// Test-level evidence of an actual failing check, in line order: TAP, Node
// test-runner symbols, Jest test blocks, indented Mocha numbering, and
// assertion/error lines (which may also be indented). `✖ failing tests:`
// (the node:test summary header) is skipped in favor of the specific test
// line that follows it, and Jest's `● Console` section is not failure
// evidence: neither the heading nor its indented payload (logged output,
// including deeper-indented lines beginning with "●") becomes a marker.
const FAILURE_MARKER_PATTERNS = [/^not ok\b.*$/m, /^\s*[✖✕]\s*(?!\s*failing\b).+$/m, /^\s*●\s+(?!Console\b|Test suite failed to run\b|Validation Error\b).+$/m, /^[ \t]*\d+\)[ \t]+.+$/m, /^[ \t]*[A-Za-z]*Error\b.*$/m];

// Suite/file-level context, never an identity on its own: Jest prints
// `FAIL <file>` (or `● Test suite failed to run`) above the failing test
// blocks, so different tests in one file would otherwise share a signature.
// A context line is carried into the signature only when a test-level marker
// follows it; without one, the full-evidence digest decides.
const CONTEXT_MARKER_PATTERNS = [/^FAIL\b.*$/m, /^\s*●\s+(?:Test suite failed to run|Validation Error)\b.*$/m];

function normalizeFailureLine(line) {
  let text = String(line || "").replace(/\s+/g, " ").trim();
  text = text.replace(/\s*\(\d+(?:\.\d+)?\s*m?s\)\s*$/, ""); // runner timing suffixes
  text = text.replace(/^not ok \d+\b/, "not ok"); // TAP plan numbering
  return text.slice(0, 160);
}

function firstFailureMarker(text) {
  const lines = String(text || "").replace(/\u001b\[[0-9;]*m/g, "").split(/\r?\n/);
  let context = null;
  let consoleIndent = null;
  for (const line of lines) {
    const bullet = /^([ \t]*)●[ \t]+/.exec(line);
    if (consoleIndent !== null) {
      // Jest's Console block contains indented log payloads, which may
      // themselves begin with "●". Only a peer/parent section bullet or a
      // non-indented line may end the block; deeper bullets remain data.
      if (bullet) {
        if (bullet[1].length > consoleIndent) continue;
        consoleIndent = null;
      } else if (line.trim() === "" || /^[ \t]/.test(line)) {
        continue;
      } else {
        consoleIndent = null;
      }
    }
    if (bullet && /^Console\b/.test(line.slice(bullet[0].length))) {
      consoleIndent = bullet[1].length;
      continue;
    }
    if (FAILURE_MARKER_PATTERNS.some((pattern) => pattern.test(line))) {
      const normalized = normalizeFailureLine(line);
      if (normalized) return context ? `${context}: ${normalized}` : normalized;
    }
    if (CONTEXT_MARKER_PATTERNS.some((pattern) => pattern.test(line))) {
      const normalized = normalizeFailureLine(line);
      if (normalized) context = normalized;
    }
  }
  return null;
}

// A stable, normalized signature: command + outcome + exit condition + the
// first test-level failing marker (with a suite/file context line when the
// runner printed one). Without a test-level marker the signature falls back
// to a digest of the complete streams (stdout and stderr both), so
// suite-header-only or banner-only prefixes from *different* failures can
// never collide (identical byte-for-byte evidence still matches, which is
// the honest reading: the same observation repeated). The user-visible
// `error` is a bounded diagnostic and is only the legacy fallback when no incremental
// identity was supplied.
function buildFailureSignature(result) {
  const evidence = String((result && (result.evidence || result.error)) || "");
  const marker = result && Object.hasOwn(result, "failureMarker") ? result.failureMarker : firstFailureMarker(evidence);
  const exit =
    result && Number.isInteger(result.exitCode) ? `exit=${result.exitCode}`
      : result && result.signal ? `signal=${result.signal}`
        : "exit=unknown";
  const base = `${(result && result.command) || "verification"} [${(result && result.outcome) || "unknown"}] ${exit}`;
  if (marker) return `${base}: ${marker}`;
  const digest = result && result.evidenceDigest || createHash("sha256").update(evidence.replace(/\s+/g, " ").trim()).digest("hex").slice(0, 16);
  return `${base}: unrecognized-output ${digest}`;
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
// killed healthy runs and reported them as failures (same truncated stdout as
// the failure signature, three times in a row -> forced reflection).
// One wall-clock budget covers the sequence. Output is consumed as it arrives;
// only bounded excerpts/line prefixes remain in memory, while all bytes feed
// incremental failure evidence. The manual verification CLI remains separate.
const VERIFY_TIMEOUT_ENV = "HARNESS_VERIFY_TIMEOUT_MS"
const DEFAULT_VERIFY_TIMEOUT_MS = 600000
const VERIFY_OUTPUT_LIMIT = 2000
const VERIFY_LINE_LIMIT = 4096
const VERIFY_KILL_GRACE_MS = 150

function verifyTimeoutMs() {
  const raw = Number(process.env[VERIFY_TIMEOUT_ENV])
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_VERIFY_TIMEOUT_MS
}

// Consume every chunk without retaining an unbounded transcript. Marker
// state is per stream, so asynchronous stdout/stderr interleaving does not
// change identity. An overlong line keeps its prefix for marker recognition;
// its complete contents still contribute to the digest.
function createVerificationCapture() {
  const hash = createHash("sha256")
  let head = "", tail = "", length = 0, bytes = 0, line = "", context = null, consoleIndent = null
  let marker = null, markerContext = null, pendingSpace = false, hashedText = false, lineTruncated = false, unsafeIdentity = false
  function consumeLine(value, truncated) {
    if (marker) return
    const clean = value.replace(/\u001b\[[0-9;]*m/g, "")
    const bullet = /^([ \t]*)●[ \t]+/.exec(clean)
    if (consoleIndent !== null) {
      if (bullet) {
        if (bullet[1].length > consoleIndent) return
        consoleIndent = null
      } else if (clean.trim() === "" || /^[ \t]/.test(clean)) return
      else consoleIndent = null
    }
    if (bullet && /^Console\b/.test(clean.slice(bullet[0].length))) {
      consoleIndent = bullet[1].length
      return
    }
    // A clipped marker or suite name cannot identify a check safely. A long
    // ordinary progress/banner line need not discard a later complete marker.
    if (truncated && (clean.trim() === "" || /^\u001b\[[0-9;]*$/.test(clean)
      || [...FAILURE_MARKER_PATTERNS, ...CONTEXT_MARKER_PATTERNS].some(pattern => pattern.test(clean)))) {
      unsafeIdentity = true
      return
    }
    if (FAILURE_MARKER_PATTERNS.some(pattern => pattern.test(clean))) {
      marker = normalizeFailureLine(clean)
      markerContext = context
    } else if (CONTEXT_MARKER_PATTERNS.some(pattern => pattern.test(clean))) context = normalizeFailureLine(clean)
  }
  return {
    write(chunk) {
      const text = String(chunk)
      bytes += Buffer.byteLength(text)
      length += text.length
      if (head.length < VERIFY_OUTPUT_LIMIT) head += text.slice(0, VERIFY_OUTPUT_LIMIT-head.length)
      tail = (tail + text).slice(-VERIFY_OUTPUT_LIMIT)
      for (const part of text.split(/(\s+)/)) {
        if (!part) continue
        if (/^\s+$/.test(part)) pendingSpace = hashedText
        else {
          if (pendingSpace) hash.update(" ")
          hash.update(part)
          pendingSpace = false
          hashedText = true
        }
      }
      for (const [index, part] of text.split("\n").entries()) {
        if (index > 0) { consumeLine(line, lineTruncated); line = ""; lineTruncated = false }
        if (line.length + part.length > VERIFY_LINE_LIMIT) lineTruncated = true
        if (line.length < VERIFY_LINE_LIMIT) line += part.slice(0, VERIFY_LINE_LIMIT-line.length)
      }
    },
    excerpt(limit) {
      if (length <= limit) return head.slice(0, length)
      const half = Math.floor(limit/2)
      return `${head.slice(0, half)}\n... [${length-half*2} chars omitted] ...\n${tail.slice(-half)}`
    },
    get bytes() { return bytes },
    finish() {
      consumeLine(line, lineTruncated)
      return { digest: hash.digest("hex"), marker, markerContext, context, unsafeIdentity }
    },
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
      const out = stdout.finish(), err = stderr.finish()
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
      if (outcome === "test_failure") {
        result.failureMarker = out.unsafeIdentity || err.unsafeIdentity ? null : out.marker
          ? (out.markerContext ? `${out.markerContext}: ${out.marker}` : out.marker)
          : err.marker ? `${err.markerContext || out.context ? `${err.markerContext || out.context}: ` : ""}${err.marker}` : null
        result.evidenceDigest = createHash("sha256").update(`stdout:${out.digest}\nstderr:${err.digest}`).digest("hex").slice(0, 16)
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
      breakerFile: join(stateDir, "circuit-breaker.json"),
      complianceFile: join(stateDir, "compliance.json"),
      reflectionFile: reflectionReportPath(stateDir),
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
    activeVerifications.get(activeKey)?.abort()
    activeVerifications.delete(activeKey)
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
      recordHostCapture(input, output)
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
        if (signal?.aborted || activeVerifications.has(activeSession)) return
      }
      const controller = new AbortController()
      let finishVerification
      controller.finished = new Promise(resolveFinished => { finishVerification = resolveFinished })
      activeVerifications.set(activeSession, controller)
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
          // Timeout or execution error: no check produced a verdict, so this
          // must not advance the same-check Rule-of-3 counter. Report it as an
          // uncompleted verification and stay honest about what is unknown.
          const detail =
            primary.outcome === "timeout"
              ? `timed out (budget ${Math.round(verifyTimeoutMs() / 1000)}s; set ${VERIFY_TIMEOUT_ENV} to raise it)`
              : "could not run to completion (execution error, not a confirmed test failure)"
          text =
            `Harness: verification did not complete - "${primary.command}" ${detail}. ` +
            `No failing check was confirmed, so this does NOT count toward the repeated-failure reflection. ` +
            `Diagnostics: ${primary.error || "(no output captured)"}. ` +
            `Fix the cause (or raise the budget) and verify again; a new edit re-runs verification.`
        } else {
          const signature = buildFailureSignature(confirmed)
          const trip = tripBreaker(breakerFile, signature)
          if (trip.action === "force_reflection") {
            const { stateDir } = pathsFor(activeSession)
            text =
              `Harness: "${confirmed.command}" has now failed 3 times with the same error. Stop and reflect ` +
              `before retrying. Write a report to "${reflectionReportPath(stateDir)}" with sections ` +
              `## Goal, ## Failed Attempts, ## Verified Facts, ## Diagnosis, and ## Decision. ` +
              `The Decision must begin with RESUME: or ESCALATE:. Include reflection token: ${trip.reflectionToken}. ` +
              `After the report is recorded, resume with a different approach. Failure: ${confirmed.error || "(no output captured)"}`
            recordCompliance(complianceFile, (c) => {
              c.circuitBreakerTrips++
              c.reflectionsForced++
            })
          } else {
            text =
              `Harness: verification failed (${trip.remaining} retries before a forced reflection). ` +
              `"${confirmed.command}" - ${confirmed.error || "(no output captured)"}. Fix it and this will re-run automatically.`
          }
        }

        try {
          await client.session.prompt({ path: { id: activeSession }, body: { parts: [{ type: "text", text }] } })
        } catch (error) {
          if (controller.signal.aborted) return
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
    const hooks = await HarnessEnforcement({
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
      directory: (ctx.location && ctx.location.directory) || ctx.directory,
    })

    await ctx.tool.hook("execute.before", (event) =>
      hooks["tool.execute.before"](toolEventInput(event), { args: event.input }))
    await ctx.tool.hook("execute.after", (event) =>
      hooks["tool.execute.after"](toolEventInput(event), {
        args: event.input,
        status: event.status,
        result: event.result,
        error: event.error,
        messageID: event.messageID,
      }))

    const pendingIdles = new Set()
    void (async () => {
      try {
        for await (const raw of ctx.event.subscribe({ signal: events.signal })) {
          if (events.signal.aborted) break
          const delivery = hooks.event({
            event: {
              type: raw.type,
              // V1 event handlers read {type, properties}; V2 events are flat
              // objects, so pass both shapes.
              properties: raw.properties ?? raw,
            },
          })
          if (raw.type === "session.idle") {
            // Awaiting verification here would prevent the same event stream
            // from delivering the reset/delete which must cancel it.
            const pending = delivery.catch(() => {}).finally(() => pendingIdles.delete(pending))
            pendingIdles.add(pending)
          } else {
            try { await delivery } catch { /* fail open */ }
          }
        }
      } catch { /* aborting the host subscription is normal shutdown */ }
      finally { events.abort() }
    })()
    return async () => {
      events.abort()
      await Promise.allSettled([...pendingIdles])
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
