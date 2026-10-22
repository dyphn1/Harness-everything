# Shared Writing Craft (D6.7)

Shared by the doc-producing skills (`to-spec`, `to-tickets`, `repo-docs`, `grill-with-docs`) and by the editorial doc check. Read this before drafting a governed or shared Markdown document.

Attribution: ideas adapted from mattpocock-skills and ECC (both MIT-licensed). The wording here is original; no code is imported.

## Principles

| Content | Form |
|---|---|
| Flow or relations | Mermaid, ideally ≤ ~15 nodes per diagram |
| Comparisons or fields | Tables, one fact per cell |
| Ordered steps or rules | Bullets |
| Rationale | Prose, normally ≤ 3 sentences per paragraph, one idea per sentence |
| Long elaboration | Outside tables, in prose or a linked section |

These are not a claim that brevity proves quality.

## Prose-share SHOULD reminder

- Threshold: a non-blank, non-code prose-line share above 50% triggers a reminder.
- Strength: **SHOULD**. It is advisory, never a quality gate, a lock, or a cognitive lock (#190).
- It does not change exit codes, lint, links, or coverage. Dismiss a reminder by reading it; no waiver or exemption exists.

## Line classification

Counted on the body only, after removing leading frontmatter and splitting CRLF and LF.

| Physical line | Denominator | Prose numerator |
|---|---|---|
| Blank or whitespace only | Exclude | Exclude |
| Fenced code, including the fence markers | Exclude | Exclude |
| Four-space or tab-indented line outside fences | Exclude | Exclude |
| ATX heading; `-`, `+` or `*` bullet; ordered marker (digits, then `.` or `)`); pipe-leading table row | Include | Exclude |
| Thematic separator (three or more identical `-`, `*` or `_`) | Include | Exclude |
| Everything else (blockquotes, `**Label:** text`, CJK, inline-code sentences, HTML or comments, unmarked continuations) | Include | Include |

- Fence rules: an opening fence is 0–3 spaces, then three or more backticks or tildes. The closing fence is the same character, at least the opening length, with trailing whitespace only. An unclosed fence runs to end of file. Mermaid counts as code.
- Trigger: zero eligible lines gives `share = 0`, no reminder. Otherwise `share = proseLines / eligibleLines`, and the reminder fires when `2 × proseLines > eligibleLines` (strictly greater, so exactly 50% does not fire).

## Limitations (documented false positives and negatives)

- Counts quoted prose, generated text and continuation lines as prose.
- Treats deeply indented list content as code.
- Recognises only pipe-leading tables and ATX headings.
- A UTF-8 BOM before the opening `---` stops frontmatter detection (the parser needs the exact first line `---`), so frontmatter lines are then counted. No code change; the case is documented here.
- No reflow normalisation, NLP, label exemption or quality score. Do not grow a Markdown parser to tune one result.

## Example fixtures

These are the expected counts for the classifier above. They are design expectations, pinned by tests in a later packet.

| Body | Prose / eligible | Reminder |
|---|---|---|
| Heading, then one prose line | 1 / 2 | No (exactly 50%) |
| Heading, prose line, `**Problem:** More` | 2 / 3 | Yes (label line counts) |
| Heading, blank line, fenced code | 0 / 1 | No |
| Blockquote CJK line, CJK prose line, pipe-table row | 2 / 3 | Yes |
| Code fence only | 0 / 0 | No |
