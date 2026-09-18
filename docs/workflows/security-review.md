# Workflow: Security Review

> Runs STRIDE threat modeling, scans secrets with the audit script, and hardens code against OWASP Top 10 risks using three-tier boundary controls — for auth, inputs, uploads, secrets, and pre-deploy audits.

Source of truth: `security-review/SKILL.md`.

---

## 1. Skill Behavior Workflow

```mermaid
graph TD
  ThreatModel["Threat-model with STRIDE per guides/STRIDE-THREAT-MODEL.md; misuse-case every endpoint and input"] --> SecretScan["Scan secrets and injection risks with audit script"]
  SecretScan --> FixHarden["Fix findings per boundary system"]
  FixHarden --> AuditReport["Write audit report to docs or platform dir"]
  AuditReport --> DoneSecure["Codebase hardened; report recorded"]
```

```mermaid
graph TD
  ScanCmd["Run node security-review/scripts/audit-secrets.js"] --> ScanGate["Gate: secret scan via script or grep before concluding"]
  ScanGate --> AlwaysDo["Always Do: parameterize SQL, Zod-validate inputs, httpOnly cookies, secrets to process.env"]
  AlwaysDo --> NeverDo["Never Do: no hardcoded secrets, no password logging, no eval or unescaped innerHTML"]
  NeverDo --> ReportPath["Report to docs/security-audit.md or .github/harness-everything/security-audit.md"]
```

## 2. Triggering and Routing Path

```mermaid
graph LR
  AuthReq["AuthN or authZ implementation"] --> SecSkill["security-review / SKILL.md"]
  InputReq["User input, uploads, new API endpoints"] --> SecSkill
  SecretReq["Secrets, credentials, payment features"] --> SecSkill
  AuditReq["Security audit before production deploy"] --> SecSkill
```

```mermaid
graph LR
  SecSkill2["security-review / SKILL.md"] -->|Produces| ThreatOut["Threat model + scan + hardened code + audit report"]
  PerfReq["Performance profiling"] -->|Out of scope| NotSec["Not security-review"]
  A11yReq["Accessibility or UI styling fixes"] -->|Out of scope| NotSec
  PlainReview["Code review without security scope"] -->|Out of scope| NotSec
```

## 3. Real-World Use Case

A new profile endpoint accepts a username and avatar upload before a production deploy. The skill threat-models it with STRIDE, misuse-cases the input and upload path, runs `node "security-review/scripts/audit-secrets.js"`, finds an unvalidated input and a hardcoded secret, fixes them per the boundary system (Zod validation, secret moved to `process.env`, parameterized query), and writes the report to `<workspace>/docs/security-audit.md`, falling back to `<workspace>/.github/harness-everything/security-audit.md` when `docs/` is protected or absent.

## 4. Verification Check

- [ ] STRIDE threat model completed per `security-review/guides/STRIDE-THREAT-MODEL.md`, with misuse-case for every endpoint and input
- [ ] Secret and injection scan run via `security-review/scripts/audit-secrets.js`, or grep, before concluding
- [ ] OWASP patterns checked per `security-review/guides/OWASP-PATTERNS.md` and `security-review/references/security-checklist.md`
- [ ] Always Do applied: parameterized SQL, Zod-validated inputs, httpOnly cookies, secrets in `process.env`
- [ ] Ask First respected: CORS changes, auth and login flows, file uploads, rate limits
- [ ] Never Do respected: no committed hardcoded secrets, no logged passwords or tokens, no `eval()` or unescaped `innerHTML`
- [ ] Audit report written to `<workspace>/docs/security-audit.md`, or `<workspace>/.github/harness-everything/security-audit.md` when docs is protected or absent
- [ ] Scope kept to auth, inputs, uploads, endpoints, secrets, and audits — not general review, performance, or UI styling
