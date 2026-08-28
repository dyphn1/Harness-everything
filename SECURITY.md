# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Harness, please report it responsibly.

**Do not open a public issue for security vulnerabilities.**

Instead, email: dyphn1@hotmail.com

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact

## Response Timeline

- Acknowledgment within 48 hours
- Fix or mitigation plan within 7 days for confirmed vulnerabilities

## Scope

This policy covers the Harness-everything repository and its published npm package.

## Hooks and Runtime Behavior

Harness installs execution hooks (circuit breaker, scope guard, stop gate) into Claude Code sessions. These hooks:

- Enforce file-scope boundaries
- Track verification state
- Block unsafe operations

If you find a bypass or unintended behavior in these mechanisms, please report it.
