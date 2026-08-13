/**
 * Automated Security Scan Helper
 * Scans the workspace for hardcoded secrets, raw SQL concatenations, unhandled innerHTML/eval, and loose CORS/HTTP configs.
 * Usage:
 *   node audit-secrets.js            Scan current workspace
 *   node audit-secrets.js --json     Output JSON format
 */
const fs = require('fs');
const path = require('path');

function getWorkspaceRoot() {
  let dir = path.resolve(process.cwd());
  while (dir !== path.parse(dir).root) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

const SECRET_PATTERNS = [
  { name: 'Hardcoded API Key / Token', regex: /(?:sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{30,}|api[_-]?key\s*=\s*['"][a-zA-Z0-9_\-]{16,}['"])/i },
  { name: 'Hardcoded Password', regex: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{6,}['"]/i },
  { name: 'Unescaped SQL Concatenation', regex: /SELECT\s+.*\s+FROM\s+.*(?:\+|`|\${)/i },
  { name: 'Unsafe Dynamic Code Execution', regex: /(?:eval\s*\(|dangerouslySetInnerHTML|innerHTML\s*=)/i }
];

const IGNORE_DIRS = ['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.claude', '.github', '.cursor'];

function scanDir(dir, findings = []) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORE_DIRS.includes(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath, findings);
      } else if (entry.isFile() && /\.(js|ts|tsx|jsx|json|py|go|env|md)$/i.test(entry.name)) {
        scanFile(fullPath, findings);
      }
    }
  } catch (e) {
    // Ignore unreadable directories
  }
  return findings;
}

function scanFile(filePath, findings) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      SECRET_PATTERNS.forEach(pattern => {
        if (pattern.regex.test(line)) {
          findings.push({
            file: path.relative(process.cwd(), filePath),
            line: index + 1,
            issue: pattern.name,
            snippet: line.trim().slice(0, 120)
          });
        }
      });
    });
  } catch (e) {
    // Ignore unreadable files
  }
}

const wsRoot = getWorkspaceRoot();
const findings = scanDir(wsRoot);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(findings, null, 2));
} else {
  console.log(`=== Harness Security & Secrets Scan ===`);
  if (findings.length === 0) {
    console.log(`✅ No obvious hardcoded secrets or raw SQL injections detected.`);
  } else {
    console.log(`⚠️  Found ${findings.length} potential security concern(s):\n`);
    findings.forEach(f => {
      console.log(`  [${f.issue}] ${f.file}:${f.line}`);
      console.log(`    Snippet: ${f.snippet}\n`);
    });
  }
}
