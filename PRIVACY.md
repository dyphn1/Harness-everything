# Privacy Notice

Harness Everything is distributed as an open-source, skill-only plugin for coding agents.

## Data handled by the plugin

Harness Everything does not operate a hosted backend, require an account with the project, or include a bundled third-party app/MCP connection. The packaged skills and hooks run in the host environment and may guide the coding agent to read files, write files, run development commands, and produce verification evidence in the workspace.

The project does not intentionally collect or transmit workspace content, prompts, source code, credentials, or usage telemetry to the Harness Everything maintainers.

## Host and third-party services

ChatGPT, Codex, GitHub, package registries, command-line tools, and any other services used by the host or explicitly invoked during a workflow have their own privacy practices. Installing Harness Everything does not change those services' permissions or privacy policies.

Users should review commands, tool permissions, connected apps, and repository content before allowing an agent to perform actions that may transmit data outside the local environment.

## Local state

Some Harness workflows may write local runtime state or project artifacts needed for routing, verification, or recovery. These files stay in locations controlled by the user and the host environment unless another tool or service is explicitly used to share them.

## Changes

If a future release adds a hosted service, telemetry, external app, or MCP integration that changes data handling, this notice must be updated before that capability is published.

For questions or reports, use the repository issue tracker: https://github.com/dyphn1/Harness-everything/issues
