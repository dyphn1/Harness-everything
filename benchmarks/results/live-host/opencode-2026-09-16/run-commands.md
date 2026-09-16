# Run commands — live-host enforcement verification (opencode 1.18.31)

Reconstructed command list for the 2026-09-16 session, in order, intended to
be reproducible. It is **not** an audited verbatim transcript of every
command actually issued; some commands were reconstructed afterward. The
sandbox is a throwaway git repository with an intentionally failing test.

## Sandbox preparation

```bash
REPO="$PWD"
SANDBOX=$(mktemp -d)/harness-live-test
mkdir -p "$SANDBOX/.opencode/plugins"
cd "$SANDBOX"
git init -q
echo "node_modules/" > .gitignore
cat > package.json <<'EOF'
{
  "name": "harness-live-sandbox",
  "version": "1.0.0",
  "private": true,
  "scripts": { "test": "node test.js" }
}
EOF
printf 'process.exit(1)\n' > test.js   # intentional failing fixture
```

The parent of `$SANDBOX` must exist before `mkdir -p "$SANDBOX/.opencode/plugins"`
(`mktemp -d` creates it); the plugin copy must land after the plugins directory
is created. Installation order: create parent → create plugins dir → copy
plugin → init git/fixture files.

## Negative control (baseline, no plugin loaded)

```bash
# .mjs install path — plugin silently not loaded, no state written
cp "$REPO/opencode-plugin/index.mjs" \
   "$SANDBOX/.opencode/plugins/harness-enforcement.mjs"
opencode run "Create hello.txt with content 'live plugin test v1'. Do not run any tests."
# -> file created, but ~/.agents/harness-everything/workspaces/ stayed empty
rm "$SANDBOX/.opencode/plugins/harness-enforcement.mjs"
```

The `.mjs` copy must be removed after the negative control: the baseline must
not leave a `.js`-behaving artifact installed, and leaving the `.mjs` file in
place would contaminate later runs in this directory.

## Probe control

See `probe-control.md` (`.mjs` not loaded; identical `.js` probe fires
factory and session events; no tool hooks were exercised — PONG6 involved no
tool calls).

## Enforcement chain (plugin installed as `.js`)

```bash
cp "$REPO/opencode-plugin/index.mjs" "$SANDBOX/.opencode/plugins/harness-enforcement.js"

# 1. edit tracking + idle verification + breaker failure #1 + SDK nudge
opencode run "Create hello.txt with content 'live plugin test v2'. Do not run any tests."

# 2. more edits, same failing signature (count -> 3 => force_reflection)
printf 'process.exit(1)\n' > test.js   # restore failing fixture (agent fixed it once)
opencode run --continue "Append 'v4' to hello.txt. Do not run tests and do not modify test.js."
opencode run --continue "Append 'v5' to hello.txt. Do not run tests and do not modify test.js."

# 3. Operator seeded the reflection artifact; the agent subsequently rewrote
#    it with a RESUME decision. This reconstruction omits that manual step;
#    it is not an unattended deterministic reproduction of reflection.

# 4. same signature fails again after reflection -> hardLock: true
opencode run --continue "Append 'v6' to hello.txt. Do not run tests and do not modify test.js."

# 5. Agent reported resetting the breaker and appending; no retained
#    blocked-tool or deletion trace independently confirms those steps.
opencode run --continue "Append 'v7' to hello.txt. Do not run tests and do not modify test.js."
```

## State observation commands

```bash
KEY=<workspace-slug-and-hash, e.g. harness-live-test-a8d00c4b7672>
S=~/.agents/harness-everything/workspaces/$KEY/state/sessions/<session-id>
cat "$S/edit-state.json" "$S/circuit-breaker.json" "$S/compliance.json"
```

Final counters (`compliance.json`):
`totalEdits: 7, verifiedEdits: 1, circuitBreakerTrips: 2, reflectionsForced: 1`.

## Environment notes

- Model: `opencode/union-alpha` (the only configured provider/model on the
  test host; `--model anthropic/claude-sonnet-4-5` fails with a server error
  on this host and is unrelated to the plugin).
- Plugin state root: `~/.agents/harness-everything/` (no
  `HARNESS_STATE_HOME` override).
- One deviation from the strict test script: in run 2 the live agent also
  "fixed" `test.js` (turning the failing fixture into a passing one), which
  the plugin correctly credited as a verification pass
  (`verifiedEdits: 1`). The fixture was restored before run 3.
