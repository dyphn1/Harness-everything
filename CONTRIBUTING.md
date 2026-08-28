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
npm run test:collision      # description collision detection
```

## Skill Contributions

Each skill lives in its own top-level directory with a `SKILL.md`. See [AGENTS.md](AGENTS.md) for full rules, but the non-negotiables:

- SKILL.md <= 500 tokens
- Must have `## USE FOR:` and `## DO NOT USE FOR:` sections
- Frontmatter `name:` must match directory name
- Description must be unique (no collision with other skills)
- Skill version must not exceed package.json version

## Pull Requests

1. Fork and create a feature branch
2. Make changes and ensure all gates pass
3. Update CHANGELOG.md under the `[Unreleased]` section
4. Open a PR with a clear description of the change

## Reporting Issues

Open an issue at https://github.com/dyphn1/Harness-everything/issues

## License

By contributing, you agree that your contributions will be licensed under Apache-2.0.