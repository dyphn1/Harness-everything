---
name: security-review
description: Conducts STRIDE threat modeling, scans secrets via audit scripts, and hardens code against OWASP Top 10 risks with three-tier boundary controls. Use when implementing auth, handling input/uploads, managing secrets, or auditing code before deployment.
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.3.4
---

# Security Review & Code Hardening

Hardens code against OWASP Top 10.

## USE FOR:
- AuthN or authZ implementation
- User input, uploads, new API endpoints
- Secrets, credentials, payment features
- Security audit before production deploy

## DO NOT USE FOR:
- Code review without security scope — instead use a standard pass
- Performance profiling
- Accessibility or UI styling fixes

## Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Auth, endpoints, uploads, user input, secrets, audit requests. |
| **Expected Output** | Threat model, scan via `audit-secrets.js`, hardened code, audit report. |
| **State Mutations** | Codebase hardened against injection/XSS/IDOR; report to docs or platform dir. |
| **Enforcement Gate** | Secret scan via the script or grep before concluding review. |

## Review Flow

1. Threat-model (`STRIDE`) per security-review/guides/STRIDE-THREAT-MODEL.md; misuse-case every endpoint/input.
2. Scan secrets and injection risks:
   ```bash
   node "<this-skill-dir>/scripts/audit-secrets.js"
   ```
   Fallback: grep scan.
3. Fix findings per the boundary system; report to `<workspace>/docs/security-audit.md`, or `<workspace>/.github/harness-everything/security-audit.md` when docs/ is protected or absent.

## Three-Tier Boundary System

- **Always Do**: parameterize SQL, Zod-validate inputs, httpOnly cookies, secrets to `process.env`.
- **Ask First**: CORS changes, auth/login flows, file uploads, rate limits.
- **Never Do**: commit hardcoded secrets (`sk-`), log passwords/tokens, use eval() or unescaped innerHTML.

Deep dive: references/security-checklist.md + security-review/guides/OWASP-PATTERNS.md
