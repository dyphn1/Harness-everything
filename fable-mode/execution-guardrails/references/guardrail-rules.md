# Guardrail Rules — Full Detail

Three rules extracted from fable-mode's operational section so active carriers can reuse
them outside the staged loop. A frontier model doesn't need a stage map for a simple task,
but any carrier that relies on these rules must load, copy, or inject them explicitly.

## 1. Verify before flag

Before flagging any problem — verify it actually exists. Grep, diff, run it, or check
the source directly. Never report a problem that hasn't been confirmed present.

An unverified flag — a warning raised because evidence wasn't *found*, rather than
because a fault was *found* — is itself an error. It manufactures doubt where none is
warranted and sends the user chasing ghosts. Absence of evidence is not the finding.
Confirm, then flag.

The known failure this rule exists to stop: run a web search on something from the
user's firsthand world, find thin or no results, and convert that silence into a warning
against the user's own sourcing. Web silence is never grounds for a warning. For facts
about the user's own world, conversation history outranks the web (see the
source-of-truth skill).

A capability flag follows the same standard. "This may be beyond me" must name what was
attempted and where it failed — not a vague appeal to difficulty.

## 2. Warning threshold

Across any run, minor concerns accumulate that are not worth interrupting execution
for individually. Keep a running count. At the threshold — **default three, tunable if
the user sets a different number** — batch them for the next natural report or handoff.
The threshold changes presentation only: it MUST NOT stop, pause, return, or otherwise
end a worker/stage by count alone.

Rationale: three small things pointing the same direction are easier to evaluate as one
batch. Below threshold, keep working; a drip of trivial caveats is noise. At threshold,
keep working and preserve the batch for the report instead of creating a second circuit
breaker.

A concern that independently meets the verify-before-flag bar and is material on its own
may stop the current stage and be surfaced immediately. Repeated matching execution
failures are governed separately by Rule-of-3 -> zoom-out -> RESUME/ESCALATE. The
warning threshold governs minor-concern reporting only.

## 3. Find-and-replace safety

When editing files via substring or regex replacement:
- **Prefer IDE/Harness Native Tools**: Use specialized file edit tools (e.g., `replace_string_in_file`) or language-native scripts (Node.js/Python) rather than shell `sed`. Raw `sed` invocations behave inconsistently across platforms (macOS BSD sed vs Linux GNU sed vs Windows lack of native sed) and risk subtle file corruption.
- **Context Anchoring**: Always anchor replacement strings with unique surrounding code/context or word boundaries (`\bword\b`) to avoid corrupting compound words — a bare `edge` replace will mangle `Ledger` into garbage.
- **Post-Edit Integrity Check**: After any find-and-replace pass, verify the file structure or syntax (e.g. via linter/compiler or targeted search) before presenting the result.

Preferred order of tools: IDE native structured replace tool (`replace_string_in_file`) with 3+ lines of context > word-boundary anchored script > raw regexreplace (use with caution). If the string to replace isn't unique in the file, widen the surrounding context until it is — NEVER replace-all blindly.

## Relationship to fable-mode

fable-mode's staged loop is optional and gated on task size. These rules are intended as
baseline execution guidance wherever an active carrier loads them, but this nested
reference is not itself automatically discovered or always-on. In v3 the per-model
flow routes to frontmatter-defined agents (`agents/*.md`) whose system prompts carry
the required rules inline, because spawned agents cannot see this reference file.
