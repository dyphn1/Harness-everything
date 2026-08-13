# OWASP Top 10 Hardening Reference

Concrete code patterns for mitigating OWASP Top 10 vulnerabilities.

## 1. Injection Prevention (SQL / NoSQL / Command)
Always parameterize database queries. Never concatenate untrusted strings into SQL/Shell commands.

```typescript
// SAFE Parameterized Query
const user = await db.query('SELECT * FROM users WHERE id = $1', [userId]);

// SAFE ORM Mapping
const user = await prisma.user.findUnique({ where: { id: userId } });
```

## 2. Broken Authentication & Session Management
Store tokens in `httpOnly`, `Secure`, `SameSite=Strict` cookies instead of `localStorage`.

```typescript
// SAFE httpOnly Cookie Setting
res.setHeader('Set-Cookie', `token=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3600`);
```

## 3. Sensitive Data & Secrets Hygiene
Never hardcode API keys or secrets in version control.

```typescript
// SAFE Secret Extraction
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error('OPENAI_API_KEY is required');
```
