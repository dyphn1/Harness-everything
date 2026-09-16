# Claude Code plugin certification

This document separates **repository/mechanism validation** from **live Claude Code evidence** for the Harness Everything plugin.

## Current design boundary

Harness uses Claude Code's conventional plugin hook location:

```text
hooks/hooks.json
```

Do not add `"hooks": "./hooks/hooks.json"` to `.claude-plugin/plugin.json` or to the marketplace entry. Current Claude Code documentation explicitly supports convention-based discovery from `hooks/hooks.json`, and Harness already had a duplicate-registration load failure when the conventional file was also registered explicitly.

Harness command hooks intentionally invoke Node directly through `${CLAUDE_PLUGIN_ROOT}` rather than routing through `.sh`, PowerShell, or another shell wrapper. This reduces Windows-specific hook-dispatch/path problems reported upstream.

## What repository validation proves

Run:

```bash
npm run test:plugin:claude
```

The repository gate verifies:

- the marketplace has current strict-validation metadata;
- marketplace and plugin versions agree;
- the plugin does not duplicate-register the conventional hook file;
- every declared skill path exists and contains `SKILL.md`;
- every declared agent file exists;
- every command hook uses a direct Node + `${CLAUDE_PLUGIN_ROOT}` form;
- every plugin-root file referenced by a command hook exists;
- a negative control proves a missing hook target fails the repository gate.

This last check is intentional because Claude Code issue `anthropics/claude-code#77912` reports that `claude plugin validate` can accept a hook command whose target file does not exist.

## Strict host validation

When Claude Code is installed, run:

```bash
npm run plugin:claude:validate
```

The helper runs the repository gate, then performs two separate strict host validations:

1. the repository marketplace;
2. a temporary **plugin-only** staged tree with `.claude-plugin/marketplace.json` removed.

The second validation prevents a marketplace-level success from being mistaken for validation of the plugin manifest itself. This is also a regression boundary for the historical `anthropics/claude-code#60725` validator behavior.

`--json` validation output requires Claude Code 2.1.259 or later. `claude plugin list --json` diagnostics are richer on 2.1.268 or later.

To inspect the staged plugin manually:

```bash
npm run plugin:claude:stage
```

By default this writes a temporary staged tree under the operating-system temp directory and excludes only the marketplace manifest.

## Known upstream constraints that affect live testing

### Directory-source marketplace hooks

`anthropics/claude-code#86809` reports a reproducible case where a plugin installed from a **directory-source marketplace** is enabled and cached but its bundled hooks never run, while the same plugin installed from a GitHub-source marketplace works.

Therefore:

- use `--plugin-dir <plugin-only-stage>` only as a direct development/load probe;
- use a **GitHub-source marketplace install** as the distribution/live-hook certification path;
- do not treat a directory-source marketplace failure as a Harness runtime defect without reproducing it through the GitHub-source path.

### Validator does not prove hook targets execute

A green `claude plugin validate` result is schema/mechanism evidence only. It is not proof that hooks were registered or fired. Preserve observable runtime evidence from a fresh session.

### Windows shell-wrapper issues

Several upstream reports describe `.sh`, Bash/PowerShell wrapper, path-format, or shell-spawn problems for plugin hooks on Windows. Harness command hooks use direct Node invocations, so certification should retain that shape unless a future change has explicit Windows evidence.

## Narrow live-certification checklist

Do this after the implementation PR is merged and released.

### A. Record environment

```bash
claude --version
node --version
npm --version
git rev-parse HEAD
```

Record Windows version as well.

### B. Mechanism/schema checks

```bash
npm run test:plugin:claude
npm run plugin:claude:validate
```

Both must pass. These checks still do **not** make the platform `Live verified`.

### C. Direct plugin-only development probe

Create the stage:

```bash
npm run plugin:claude:stage
```

Start a fresh Claude Code session using the printed directory:

```bash
claude --plugin-dir <staged-plugin-directory>
```

In another terminal, this form can inspect a session-only plugin:

```bash
claude --plugin-dir <staged-plugin-directory> plugin list --json
```

Verify the plugin has no `errors` and no unexpected `notes`, and confirm the component inventory includes representative skills, agents, and hooks.

### D. GitHub-source marketplace certification

Use the repository's normal GitHub marketplace install/update path, not a directory-source marketplace.

After installation or update:

```bash
claude plugin list --json
```

Then start a **fresh session**. Preserve evidence for:

1. the installed plugin version/source;
2. a representative bundled skill being discoverable without a separate standalone skill install;
3. `SessionStart` / `UserPromptSubmit` Harness behavior being observable;
4. a harmless tool call such as `git status` running normally;
5. a safe destructive **no-op** probe producing the expected Harness audit/gate behavior without changing real data;
6. restart/update/reload retaining plugin discovery.

Use `claude --debug` if component or hook registration is unclear; current official documentation says debug output includes plugin loading and skill/agent/hook registration.

## Permission-mode scope

Harness's Claude action gate now defers matched actions to Claude Code's native permission flow by default rather than forcing its own `ask` decision. Claude Code itself owns the semantics of `default`, `acceptEdits`, `plan`, `auto`, `dontAsk`, and `bypassPermissions`.

Because of that boundary, Claude certification does **not** need to re-prove every host permission mode before Harness can establish that its hook loaded and deferred correctly. The live minimum is:

- one normal/manual-style session;
- one `auto` session where available;
- observable Harness audit evidence showing the hook ran without silently authorizing the command.

Additional permission-mode testing is useful as a host-regression matrix, but it is not a prerequisite for validating Harness plugin discovery.

## Evidence levels

- **Repository verified**: Harness static/mechanism checks pass.
- **Host schema verified**: current `claude plugin validate --strict --json` passes for marketplace and plugin-only stage.
- **Live verified**: a fresh real Claude Code session proves bundled components loaded and the relevant hooks actually fired.

Never promote repository or schema evidence to `Live verified` without the live-session artifacts above.

## References

- Claude Code plugins reference: https://code.claude.com/docs/en/plugins-reference
- Claude Code plugin marketplaces: https://code.claude.com/docs/en/plugin-marketplaces
- Claude Code permissions: https://code.claude.com/docs/en/permissions
- Directory-source marketplace hook issue: https://github.com/anthropics/claude-code/issues/86809
- Missing hook target validator issue: https://github.com/anthropics/claude-code/issues/77912
- Historical per-plugin validation gap: https://github.com/anthropics/claude-code/issues/60725
- Windows hook wrapper issue: https://github.com/anthropics/claude-code/issues/54772
