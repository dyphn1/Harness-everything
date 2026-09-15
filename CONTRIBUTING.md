# Contributing to Harness

Thanks for your interest in contributing.

## Development Setup

```bash
git clone https://github.com/dyphn1/Harness-everything.git
cd Harness-everything
npm test
```

## Quality Gates

All contributions must pass:

```bash
npm test                    # self-regression
npm run test:mechanism      # hook mechanism checks
npm run test:consistency    # manifest, version, link checks
npm run test:release        # release catalog + version automation contract
npm run test:collision      # description collision detection
```

## Skill Contributions

Each skill lives in its own top-level directory with a `SKILL.md`. See [AGENTS.md](AGENTS.md) for full rules, but the non-negotiables:

- SKILL.md <= 500 tokens
- Must have `## USE FOR:` and `## DO NOT USE FOR:` sections
- Frontmatter `name:` must match directory name
- Description must be unique (no collision with other skills)
- Skill version must not exceed package.json version

## Conventional Commits and Releases

Harness uses Conventional Commit history on `main` as the release input. Normal pull requests do **not** manually bump package or plugin versions.

- `BREAKING CHANGE:` or a breaking `!` => major release
- `feat:` => minor release
- `fix:`, `perf:`, `refactor:`, `build:`, `revert:` => patch release
- `docs:`, `test:`, `ci:`, `style:`, `chore:` => no release by themselves

If the repository uses squash merging, make the PR title a valid Conventional Commit because it becomes the commit semantic-release analyzes. See [RELEASING.md](RELEASING.md) for the complete automated release flow.

## Pull Requests

1. Fork and create a feature branch.
2. Make changes and ensure all gates pass.
3. Update `CHANGELOG.md` under `[Unreleased]` for user-visible changes.
4. Do not manually bump release versions; release automation owns them.
5. Open a PR with a Conventional Commit title that accurately represents its release impact.

## Reporting Issues

Open an issue at https://github.com/dyphn1/Harness-everything/issues

## License

By contributing, you agree that your contributions will be licensed under Apache-2.0.
