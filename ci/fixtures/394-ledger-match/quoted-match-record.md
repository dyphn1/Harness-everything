---
id: "E-0999"
signature: "quoted-match-record"
class: "test"
scope: "in"
status: "lesson"
match:
  actions:
    - tool: "shell"
      executable: "git"
      subcommand: "commit"
  failures:
    - tool: "shell"
      executable: "git"
      subcommand: "commit"
      diagnostics:
        - "subject-case"
---
## Cue

A generated quoted rule is still an ordinary Git commit.

## Lesson

Review the commit message before retrying.
