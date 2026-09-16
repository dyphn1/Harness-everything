# Contributing to Harness

Thanks for your interest in contributing.

## Development Setup

Harness supports **Node.js 22 or newer**. Node.js **24** is the primary development, CI, Docker, and release runtime; `.nvmrc` is the checked-in default. The generated current-state contract is [docs/repository-contract.md](docs/repository-contract.md).

```bash
git clone https://github.com/dyphn1/Harness-everything.git
cd Harness-everything
nvm use                  # uses Node 24 from .nvmrc when nvm is available
npm ci
npm test
```

## Quality Gates

The reusable CI workflow runs the repository's deterministic gates across the supported operating-system matrix, with a separate Node 22 minimum-runtime lane. Before opening a PR, run the relevant local gates:

```bash
npm test                         # self-regression
npm run test:mutations           # focused mutation checks
npm run test:mechanism           # hook/plugin mechanism checks
npm run test:consistency         # manifests, docs, eval coverage + repository contract
npm run test:repo-contract       # Node/workflow/action/schedule drift gate
npm run test:references          # executable/deep-dive references
npm run test:release             # release catalog + version automation contract
npm run test:collision           # description collision detection
npm run test:plugin:openai       # local OpenAI/Codex plugin package
npm run test:plugin:submission   # public Skills-only package reproducibility
npm run test:platform:compatibility
```

If `waza` is installed, CI also validates canonical skill readiness, routing evals, and token growth. See [AGENTS.md](AGENTS.md) for the repository operating rules.

When runtime or workflow configuration changes, run `npm run docs:sync` and commit the regenerated [docs/repository-contract.md](docs/repository-contract.md). CI rejects stale generated contract data.

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
2. Make changes and ensure all relevant gates pass.
3. Run `npm run docs:sync` after runtime/workflow changes and commit generated current-state documentation.
4. Update `CHANGELOG.md` under `[Unreleased]` for user-visible changes.
5. Do not manually bump release versions; release automation owns them.
6. Open a PR with a Conventional Commit title that accurately represents its release impact.

## Reporting Issues

Open an issue at https://github.com/dyphn1/Harness-everything/issues

## License

By contributing, you agree that your contributions will be licensed under Apache-2.0.
