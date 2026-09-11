# STRIDE Threat Modeling Guide

Apply STRIDE threat modeling at system boundaries before writing code.

## 1. STRIDE Lenses & Mitigations

| Threat | Definition | Typical Mitigation Pattern |
| :--- | :--- | :--- |
| **S - Spoofing** | Impersonating an authentic user, service, or device. | Strong authentication, JWT httpOnly cookies, HMAC signatures. |
| **T - Tampering** | Malicious alteration of data in transit or at rest. | Parameterized SQL queries, TLS/HTTPS, Zod schema validation. |
| **R - Repudiation** | Denying having performed an action due to lack of audit trail. | Immutable audit logs for sensitive operations (payments, auth shifts). |
| **I - Information Disclosure** | Unauthorized data leakage to external parties. | Field allowlists, generic error messages, secret management in env vars. |
| **D - Denial of Service** | Overwhelming system resources to prevent legitimate access. | Rate limiting, request payload size limits, query pagination. |
| **E - Elevation of Privilege** | Gaining unauthorized permissions or higher role access. | Role-Based Access Control (RBAC), Row-Level Security (RLS). |

## 2. Abuse Case Design

For every positive Use Case, write a corresponding **Abuse Case**:
- **Use Case**: "User uploads profile picture."
- **Abuse Case**: "Attacker uploads 2GB executable file `.php` with fake image magic bytes."
- **Mitigation**: Validate file extension, MIME type, max file size (5MB), and store outside web root.
