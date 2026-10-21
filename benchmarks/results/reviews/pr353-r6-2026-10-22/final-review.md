# Final integration review — PR #353 (selected tree)

Scope: **read-only**, tightly scoped to the selected tree `/Users/daniel.chang/Desktop/Skills/Harness-everything/.worktrees/fix-353`
compared against frozen A `/Users/daniel.chang/Desktop/Skills/Harness-everything/.worktrees/353-r6-a`.
No file was edited, no test suite or gate was executed, no background command was launched, no scope was widened.

## Verdict

**ACCEPT — no blocker found.** The only functional delta is the BOM-corrected frontmatter classifier, it
agrees with the fatal `TextDecoder` leading-BOM semantics, and the new producer regressions pin it.
The two known non-blocking items (malformed-record diagnostic drift, mirrored-rules maintenance risk)
are unchanged and remain documented. **No PR-readiness claim is made here; the owner decides.**

## What was compared (read-only)

`diff -u` of every file in the two worktrees plus `git status --porcelain -uall` and `shasum -a 256`:

| File | Delta vs frozen A |
| --- | --- |
| `hooks/scripts/lib/doc-reconciliation-core.js` | `opensFrontmatter` only, plus the rule comment: `subarray(0,8).toString('latin1')` → `subarray(0,11).toString('utf8').replace(/^\uFEFF/,'')`; comment gains "Match TextDecoder's BOM handling" |
| `hooks/scripts/lib/doc-reconciliation-core.js` (rule comment) | wording tightened + `// shortcut: mirrors derive path rules, update them together until a shared classifier is exposed.` |
| `hooks/scripts/lib/doc-reconciliation-producer.js` | **identical** to frozen A |
| `hooks/scripts/lib/doc-reconciliation-events.js` | **identical** to frozen A |
| `plugins/harness-everything/hooks/scripts/lib/doc-reconciliation-{core,producer}.js` | regenerated copies of the same deltas; SHA-256 identical to the canonical sources (`b4345651…`, `f8f5683f…`); events copy identical (`5fd2808a…`) |
| `ci/mechanism-325-3b-s2a-producer.test.js` | +2 assertions: `R3-P2:undecodable-frontmatter-plain-fails-closed`, `R3-P2:undecodable-frontmatter-bom-fails-closed` (loop over prefix `''` / `'\uFEFF'`, writing `assets/role.dat` = prefix + `---\nrole: prd\n---\n` + binary bytes) |
| `ci/mechanism-325-3b-s2a-core.test.js`, `ci/fixtures/.../harness.js`, `CHANGELOG.md` | **identical** to frozen A |
| `docs/doc-workflow-reconciliation.md` | wording only: adds "(including one after a leading UTF-8 BOM)"; replaces "a binary asset never changes document applicability" with "irrelevant binary assets remain usable" |

No public derive/checker API, identity/digest schema, S1 runtime, workflow wiring, version or dependency
changed. Scope is exactly the stated delta — **source-traced**.

## Findings

1. **The BOM classifier agrees with the fatal `TextDecoder` leading-BOM semantics** — *source-traced*.
   The derive contract reads a file through `TextDecoder('utf-8', {fatal:true})`, whose WHATWG UTF-8 decoder
   removes a leading `EF BB BF` from the byte stream, so the decoded text starts at the byte after the BOM.
   The classifier reproduces exactly that: `Buffer.toString('utf8')` keeps U+FEFF as a character (it does
   **not** strip the BOM), so the explicit `replace(/^\uFEFF/, '')` restores the decoder's behaviour; a
   leading `EF BB BF` is by definition the BOM, so the classifier never strips something the decoder would
   keep. The 11-byte window covers the longest relevant first line — BOM(3) + `---`(3) + CRLF(2) = 8 bytes
   — and a longer first line cannot be `---`. A truncated BOM (`EF`, `EF BB`) decodes to U+FFFD in both
   decoders (neither skips bytes), so the classifier's `false` matches the decoder's "no frontmatter".
   The trailing-`\r` strip mirrors `parseFrontmatter`'s own rule exactly.

2. **The new tests pin the fix, and the RED arithmetic confirms the RED was the BOM case** — *source-traced
   + coordinator-executed*. `assets/role.dat` is at a path no config glob classifies, so only the frontmatter
   rule can catch it; the frozen latin1 classifier saw `'\u00EF\u00BB\u00BF---'` and returned `false`, i.e.
   it dropped a document-semantic record — exactly the defect the coordinator's independent BOM transition
   probe reported for both candidates. The frozen tree's plain variant passed and only the BOM variant
   failed, which is what the reported **78 PASS / 2 FAIL** (one failing assertion-leg per leg) and
   **80 / 0** GREEN over 80 legs imply; the final classifier returns `true` for both variants
   (`'---'` and `'\uFEFF---\n…'` → stripped → `'---'`). The tests fail loudly if the BOM handling regresses
   (the producer would become `ready` and the assertion `undecodable frontmatter must not disappear from
   semantic inputs` would fire).

3. **The change is confined to the classifier; no behaviour elsewhere moved** — *source-traced*.
   `semanticRelevance`, `deriveFiles`, `originBound`, `configBytesBound`, the identity framing and the
   producer/event modules are untouched, so the previously accepted P1 binding, the binary byte identity
   (`candidateDigest`/`baselineDigest` framing), producer/core parity and the fail-closed reason codes are
   unchanged. Packaged copies are byte-identical to the canonical files.

4. **The docs delta is wording-only and removes an over-claim** — *source-traced*. The frozen sentence
   "a binary asset never changes document applicability" was inaccurate (a *relevant* binary asset does
   change applicability — it fails closed); the replacement "irrelevant binary assets remain usable while
   the identity still covers their bytes" is the accurate statement, and the BOM case is now named in the
   contract text. No normative claim was weakened.

5. **The shortcut comment follows the repository convention** — *source-traced*. It states the limit
   (the mirrored derive-contract path rules) and the upgrade condition ("until a shared classifier is
   exposed"), matching the `shortcut: <limit>, <when to upgrade>` form. It also names the real risk my
   earlier cross-review raised, so the drift exposure is now visible in the code itself.

6. **The two known non-blocking items are unchanged and remain non-blocking** — *source-traced*.
   (a) *Malformed-record diagnostic drift*: the core catch still maps the plain `Error('inventory-unsupported')`
   thrown by the shared `bytes()` helper to `inventory-unsupported` where the base reported `invalid-input`;
   credit is withheld either way because any diagnostic makes `reconcileDocResults` return before the
   eligibility branch. (b) *Mirrored-rules maintenance risk*: `CODE_EXTENSION`/`TEST_PATH`/glob semantics are
   still mirrored inside the reconciliation module; the drift guard remains a follow-up, now documented
   in-code. Neither is a blocker for this change, which does not touch that surface.

## Not assessed in this review

The coordinator's executed evidence was taken as given (32 independent probes pass; `verify:all`
13 PASS / 0 FAIL / 3 UNCHECKED; consistency rerun PASS; producer RED 78/2 → GREEN 80/0; core 195/0).
This review executed no tests, gates or suites, made no file edits, and did not examine live-host
provenance, the S1 runtime, workflow wiring or E1 readiness — all outside S2a. PR readiness is not
certified here.

STATUS: DONE
