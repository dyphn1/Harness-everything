// Prompt-injection guidance for integration paths where Harness cannot prove
// lifecycle-hook enforcement. Single source of truth for advisory blocks.
const fs = require('fs');
const path = require('path');

const MARKER = "Harness OS Guidance (Advisory)";

const advisoryInstructions = [
  `\n# ${MARKER}`,
  `Harness is an observer/router/reminder layer on this surface; do not treat its workflow guidance as a hard scheduler.`,
  ``,
  `## 🚦 ENTRY TRIAGE & WORKFLOW GUIDANCE`,
  `For software/project work, load the \`harness-everything\` skill and establish routing context before broad mutation:`,
  `1. Run \`npx github:dyphn1/Harness-everything next "<Brief summary of user's prompt>"\` when terminal execution is available.`,
  `2. For EVERY suggested skill, read its complete \`SKILL.md\` entry and evaluate applicability from \`USE FOR\`, \`DO NOT USE FOR\`, and its basic flow.`,
  `3. Treat the selected workflow topology and numeric limits as planning guidance, not a lock. Choose, combine, reorder, or skip steps when evidence supports it.`,
  `4. Prefer objective verification before declaring done and worktree isolation for broad/Tier-3 mutation.`,
  `5. Surface a compact routing checkpoint with tier, strategy, suggested skills, and any relevant warnings.`,
  ``,
  `## 🤖 COGNITIVE COMPLIANCE`,
  `- **No universal skill pipeline**: do not force every task through TODO/TDD/Fable.`,
  `- **Rule of 3**: after 3 same-signature failures, stop micro-retrying and use a fresh diagnosis / zoom-out. This reflection boundary may block mutation until completed.`,
  `- **Permission boundaries are separate**: explicit host/user approval for destructive or external actions remains authoritative.`,
  `- **Verification is evidence, not a cage**: missing evidence should trigger a reminder, not a persistent workflow lock.`,
  `- **Environment discovery**: discover OS, shell, package manager/runtime, and host capability before relying on them.`,
  `- **Memory / self-evolve**: persist only verified reusable lessons.`,
  `- **Prefer editing**: prefer targeted edits and logically complete commits over broad rewrites.`,
  ``
].join('\n');

function hasHarnessMarker(content) {
  return typeof content === 'string' && content.includes(MARKER);
}

function assertHarnessOwnedOrAbsent(targetFile, label) {
  if (!fs.existsSync(targetFile)) return;
  const content = fs.readFileSync(targetFile, 'utf8');
  if (!hasHarnessMarker(content)) {
    throw new Error(`Refusing to overwrite pre-existing non-Harness ${label}: ${targetFile}`);
  }
}

function injectAdvisoryText(targetFile, header, label) {
  const dir = path.dirname(targetFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (fs.existsSync(targetFile)) {
    const content = fs.readFileSync(targetFile, 'utf8');
    if (!hasHarnessMarker(content)) {
      fs.appendFileSync(targetFile, advisoryInstructions, 'utf8');
      console.log(`  ✅ Augmented existing ${label} with Harness guidance (advisory-only)`);
    }
  } else {
    fs.writeFileSync(targetFile, `${header}\n${advisoryInstructions}`, 'utf8');
    console.log(`  ✅ Created ${label} with Harness guidance (advisory-only)`);
  }
}

function removeAdvisoryText(targetFile) {
  if (!fs.existsSync(targetFile)) return;
  try {
    const content = fs.readFileSync(targetFile, 'utf8');
    const markerIndex = content.indexOf(MARKER);
    if (markerIndex === -1) return;
    let cleanContent = content;
    const hashMarkerIndex = content.lastIndexOf('#', markerIndex);
    if (hashMarkerIndex !== -1) cleanContent = content.substring(0, hashMarkerIndex).trim() + '\n';
    else cleanContent = content.substring(0, markerIndex).trim() + '\n';

    const lines = cleanContent.trim().split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0 || (lines.length === 1 && ['# Cursor Project Rules', '# AGENTS.md', '# Copilot Instructions', '# .hermes.md'].includes(lines[0]))) {
      fs.unlinkSync(targetFile);
      console.log(`  ✅ Removed empty advisory file: ${targetFile}`);
    } else {
      fs.writeFileSync(targetFile, cleanContent.trim() + '\n', 'utf8');
      console.log(`  ✅ Removed Harness guidance from: ${targetFile}`);
    }
  } catch (e) {
    console.warn(`  ⚠️ Error removing advisory text from ${targetFile}: ${e.message}`);
  }
}

function installContinueRule(targetFile, label) {
  const dir = path.dirname(targetFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  assertHarnessOwnedOrAbsent(targetFile, label);
  if (fs.existsSync(targetFile) && hasHarnessMarker(fs.readFileSync(targetFile, 'utf8'))) return;
  const content = [
    `---`,
    `name: Harness OS Guidance`,
    `alwaysApply: true`,
    `description: "Harness OS routing and workflow guidance (instruction-governed on Continue unless a lifecycle mechanism is independently verified)"`,
    `---`,
    advisoryInstructions.replace(/^\n/, '')
  ].join('\n');
  fs.writeFileSync(targetFile, content, 'utf8');
  console.log(`  ✅ Installed Continue rule file with Harness guidance (advisory-only): ${label}`);
}

function removeContinueRule(targetFile) {
  if (!fs.existsSync(targetFile)) return;
  try {
    const content = fs.readFileSync(targetFile, 'utf8');
    if (hasHarnessMarker(content)) {
      fs.unlinkSync(targetFile);
      console.log(`  ✅ Removed Harness rule file: ${targetFile}`);
    }
  } catch (e) {
    console.warn(`  ⚠️ Error removing ${targetFile}: ${e.message}`);
  }
}

function buildCopilotGlobalContent() {
  return [
    `---`,
    `description: "Harness OS Guidance (Advisory)"`,
    `applyTo: "**"`,
    `---`,
    `# Copilot Instructions`,
    ``,
    advisoryInstructions.replace(/^\n/, '')
  ].join('\n');
}

function buildCodexGlobalContent() {
  return [
    `---`,
    `description: "Harness OS Guidance - Global custom agent for orchestrating software workflows"`,
    `name: "Harness"`,
    `user-invocable: true`,
    `---`,
    `# AGENTS.md`,
    ``,
    `# ${MARKER}`,
    `This instruction surface cannot be assumed to provide hard lifecycle blocking.`,
    ``,
    `- Discover the environment and host capabilities before relying on them.`,
    `- For software/project work, run \`npx github:dyphn1/Harness-everything next "<summary>"\` before mutation and surface the routing checkpoint.`,
    `- Read every suggested skill's complete \`SKILL.md\` entry before resolving applicability; do not omit it from metadata or confidence alone.`,
    `- Use the selected workflow topology as planning guidance; the model may adapt or skip steps with an explicit evidence-based reason.`,
    `- Do not impose a universal TODO/TDD/Fable sequence; use the smallest useful topology plus applicable skills.`,
    `- Prefer objective verification before declaring done; missing verification is a reminder, not a persistent lock.`,
    `- After 3 same-signature failures, stop retrying and use a fresh diagnosis / zoom-out.`,
    `- Prefer targeted edits and logically complete commits.`,
    ``
  ].join('\n');
}

module.exports = {
  MARKER,
  advisoryInstructions,
  hasHarnessMarker,
  assertHarnessOwnedOrAbsent,
  injectAdvisoryText,
  removeAdvisoryText,
  installContinueRule,
  removeContinueRule,
  buildCopilotGlobalContent,
  buildCodexGlobalContent,
};
