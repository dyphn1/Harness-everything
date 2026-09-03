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
import { join, dirname } from "node:path"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { execSync } from "node:child_process"

const EDIT_TOOLS = new Set(["edit", "write", "apply_patch"])

const STATE_DIR = join(homedir(), ".harness-state")
const EDIT_STATE_FILE = join(STATE_DIR, "edit-state.json")
const BREAKER_FILE = join(STATE_DIR, "circuit-breaker.json")
const COMPLIANCE_FILE = join(STATE_DIR, "compliance.json")

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
  return { lastEditTime: null, verificationPending: false, editsSinceVerification: 0, sessionStart: Date.now() }
}

function defaultBreakerState() {
  return { failures: {}, hardLock: false, lastReflection: null }
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
function tripBreaker(signature) {
  const breaker = loadJSON(BREAKER_FILE, defaultBreakerState())

  if (!breaker.failures[signature]) {
    breaker.failures[signature] = { count: 0, firstSeen: Date.now() }
  }
  const entry = breaker.failures[signature]
  entry.count++
  entry.lastSeen = Date.now()

  if (entry.count >= 3) {
    if (breaker.lastReflection && breaker.lastReflection > entry.firstSeen) {
      breaker.hardLock = true
      saveJSON(BREAKER_FILE, breaker)
      return { action: "hard_lock", count: entry.count }
    }
    saveJSON(BREAKER_FILE, breaker)
    return { action: "force_reflection", count: entry.count }
  }

  saveJSON(BREAKER_FILE, breaker)
  return { action: "allow", count: entry.count, remaining: 3 - entry.count }
}

function recordCompliance(mutate) {
  const compliance = loadJSON(COMPLIANCE_FILE, defaultCompliance())
  mutate(compliance)
  saveJSON(COMPLIANCE_FILE, compliance)
}

export const HarnessEnforcement = async ({ client, directory }) => {
  return {
    "tool.execute.before": async (input) => {
      if (!EDIT_TOOLS.has(input.tool)) return
      const breaker = loadJSON(BREAKER_FILE, defaultBreakerState())
      if (breaker.hardLock) {
        throw new Error(
          "Harness circuit breaker hard-locked after a repeat failure post-reflection. " +
            "Delete ~/.harness-state/circuit-breaker.json or start a new session to reset.",
        )
      }
    },

    "tool.execute.after": async (input) => {
      if (!EDIT_TOOLS.has(input.tool)) return
      const state = loadJSON(EDIT_STATE_FILE, defaultEditState())
      state.lastEditTime = Date.now()
      state.verificationPending = true
      state.editsSinceVerification++
      saveJSON(EDIT_STATE_FILE, state)
      recordCompliance((c) => c.totalEdits++)
    },

    event: async ({ event }) => {
      if (event.type !== "session.idle") return
      const state = loadJSON(EDIT_STATE_FILE, defaultEditState())
      if (!state.verificationPending || state.editsSinceVerification === 0) return

      const { allPassed, skipped, results } = runVerification(directory)

      if (skipped || allPassed) {
        state.verificationPending = false
        state.editsSinceVerification = 0
        saveJSON(EDIT_STATE_FILE, state)
        recordCompliance((c) => c.verifiedEdits++)
        return
      }

      const failing = results.find((r) => !r.success)
      const signature = extractFailureSignature(`${failing.command}: ${failing.error || ""}`)
      const trip = tripBreaker(signature)

      const sessionID = event.properties.sessionID
      let text
      if (trip.action === "hard_lock") {
        text =
          `Harness: same verification failure ("${failing.command}") returned after a reflection was ` +
          `already recorded. The circuit breaker is now hard-locked - edits are blocked until it is reset.`
        recordCompliance((c) => c.circuitBreakerTrips++)
      } else if (trip.action === "force_reflection") {
        text =
          `Harness: "${failing.command}" has now failed 3 times with the same error. Stop and reflect ` +
          `before retrying - write down the goal, what was tried, verified facts, a diagnosis, and a decision, ` +
          `then resume with a different approach. Failure: ${failing.error || "(no output captured)"}`
        recordCompliance((c) => {
          c.circuitBreakerTrips++
          c.reflectionsForced++
        })
      } else {
        text =
          `Harness: verification failed (${trip.remaining} retries before a forced reflection). ` +
          `"${failing.command}" - ${failing.error || "(no output captured)"}. Fix it and this will re-run automatically.`
      }

      try {
        await client.session.prompt({ path: { id: sessionID }, body: { parts: [{ type: "text", text }] } })
      } catch {
        // Best-effort: if the client can't reach the server, the state file
        // still reflects the trip and the next tool.execute.before will
        // enforce a hard lock once one exists.
      }
    },
  }
}
