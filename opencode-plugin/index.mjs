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
import { join, dirname, resolve, basename } from "node:path"
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, realpathSync } from "node:fs"
import { execSync } from "node:child_process"
import { createHash } from "node:crypto"

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

function getStateDir(directory) {
  return join(getStateHome(), "workspaces", getWorkspaceKey(directory))
}

// One-time move of the pre-fix flat `~/.harness-state/*.json` files into
// this workspace's new keyed directory. That old location was never keyed
// by workspace, so on a machine with multiple opencode projects there's no
// way to know which project each legacy file belonged to - best-effort: the
// first workspace to run after upgrading claims them once, everyone else
// just starts a fresh stream at the new location.
function migrateLegacyFlatState(stateDir) {
  const legacyDir = join(homedir(), ".harness-state")
  if (!existsSync(legacyDir) || existsSync(stateDir)) return
  try {
    mkdirSync(stateDir, { recursive: true })
    for (const name of ["edit-state.json", "circuit-breaker.json", "compliance.json"]) {
      const src = join(legacyDir, name)
      if (existsSync(src)) writeFileSync(join(stateDir, name), readFileSync(src))
    }
    rmSync(legacyDir, { recursive: true, force: true })
  } catch {
    // Best-effort - worst case the legacy dir lingers and this workspace
    // just starts a fresh state stream at the new location.
  }
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
function tripBreaker(breakerFile, signature) {
  const breaker = loadJSON(breakerFile, defaultBreakerState())

  if (!breaker.failures[signature]) {
    breaker.failures[signature] = { count: 0, firstSeen: Date.now() }
  }
  const entry = breaker.failures[signature]
  entry.count++
  entry.lastSeen = Date.now()

  if (entry.count >= 3) {
    if (breaker.lastReflection && breaker.lastReflection > entry.firstSeen) {
      breaker.hardLock = true
      saveJSON(breakerFile, breaker)
      return { action: "hard_lock", count: entry.count }
    }
    saveJSON(breakerFile, breaker)
    return { action: "force_reflection", count: entry.count }
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
  // Resolved once per session/workspace and closed over below - never a
  // shared module-level binding, so concurrent sessions for different
  // opencode projects in the same process can never cross-talk (issue #42
  // item #4: the pre-fix flat ~/.harness-state had exactly that problem).
  const stateDir = getStateDir(directory)
  migrateLegacyFlatState(stateDir)
  const editStateFile = join(stateDir, "edit-state.json")
  const breakerFile = join(stateDir, "circuit-breaker.json")
  const complianceFile = join(stateDir, "compliance.json")

  return {
    "tool.execute.before": async (input) => {
      if (!EDIT_TOOLS.has(input.tool)) return
      const breaker = loadJSON(breakerFile, defaultBreakerState())
      if (breaker.hardLock) {
        throw new Error(
          `Harness circuit breaker hard-locked after a repeat failure post-reflection. ` +
            `Delete "${breakerFile}" or start a new session to reset.`,
        )
      }
    },

    "tool.execute.after": async (input) => {
      if (!EDIT_TOOLS.has(input.tool)) return
      const state = loadJSON(editStateFile, defaultEditState())
      state.lastEditTime = Date.now()
      state.verificationPending = true
      state.editsSinceVerification++
      saveJSON(editStateFile, state)
      recordCompliance(complianceFile, (c) => c.totalEdits++)
    },

    event: async ({ event }) => {
      if (event.type !== "session.idle") return
      const state = loadJSON(editStateFile, defaultEditState())
      if (!state.verificationPending || state.editsSinceVerification === 0) return

      const { allPassed, skipped, results } = runVerification(directory)

      if (skipped || allPassed) {
        state.verificationPending = false
        state.editsSinceVerification = 0
        saveJSON(editStateFile, state)
        recordCompliance(complianceFile, (c) => c.verifiedEdits++)
        return
      }

      const failing = results.find((r) => !r.success)
      const signature = extractFailureSignature(`${failing.command}: ${failing.error || ""}`)
      const trip = tripBreaker(breakerFile, signature)

      const sessionID = event.properties.sessionID
      let text
      if (trip.action === "hard_lock") {
        text =
          `Harness: same verification failure ("${failing.command}") returned after a reflection was ` +
          `already recorded. The circuit breaker is now hard-locked - edits are blocked until it is reset.`
        recordCompliance(complianceFile, (c) => c.circuitBreakerTrips++)
      } else if (trip.action === "force_reflection") {
        text =
          `Harness: "${failing.command}" has now failed 3 times with the same error. Stop and reflect ` +
          `before retrying - write down the goal, what was tried, verified facts, a diagnosis, and a decision, ` +
          `then resume with a different approach. Failure: ${failing.error || "(no output captured)"}`
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
        await client.session.prompt({ path: { id: sessionID }, body: { parts: [{ type: "text", text }] } })
      } catch {
        // Best-effort: if the client can't reach the server, the state file
        // still reflects the trip and the next tool.execute.before will
        // enforce a hard lock once one exists.
      }
    },
  }
}
