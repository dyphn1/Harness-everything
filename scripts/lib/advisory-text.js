// Prompt-injection guidance for integration paths where Harness cannot prove
// lifecycle-hook enforcement. Single source of truth for advisory blocks.
const fs = require('fs');
const path = require('path');

const MARKER = "Harness OS Guidance (Advisory)";

const advisoryInstructions = [
  `\n# ${MARKER}`,
  `This surface cannot be assumed to mechanically enforce every Harness lifecycle transition.`,
  `Treat the workflow contract below as required agent behavior, while keeping enforcement`,
  `claims bounded by the host's verified capabilities.`,
  ``,
  `## 🚦 MANDATORY ENTRY TRIAGE & WORKFLOW ROUTING`,
  `For every software/project prompt, load the \`harness-everything\` skill and establish the routing contract before mutation:`,
  `1. Run \`npx github:dyphn1/Harness-everything next "<Brief summary of user's prompt>"\`. If terminal execution is unavailable, apply the same contract from the skill instead of skipping routing.`,
  `2. For EVERY suggested skill, read its complete \`SKILL.md\` entry and resolve applicability from \`USE FOR\`, \`DO NOT USE FOR\`, workflow/basic flow, and hard rules. A name, description, router summary, or "routine/simple/already clear" judgement is not enough to omit it.`,
  `3. The selected workflow topology is mandatory once applicable. Execute it to resolution; choose tools, reasoning, implementation technique, and decomposition freely inside it. Do not replace it with a direct path because you believe you can solve the task without the workflow.`,
  `4. If the selected workflow genuinely cannot cover part of the task, record an explicit escape for the uncovered scope with evidence. Covered obligations remain mandatory. Host-capability loss must be surfaced, not silently converted into optional execution.`,
  `5. Surface a compact checkpoint near the first progress update:`,
  `   \`\`\`markdown`,
  `   ## 🚦 Harness OS Routing Checkpoint`,
  `   - **Active Tier**: Tier 1 | Tier 2 | Tier 3 | unclassified`,
  `   - **Strategy**: <selected/deferred strategy>`,
  `   - **Workflow State**: <active | deferred | blocked | escaped>`,
  `   - **Required Invariants**: <router invariants>`,
  `   - **Suggested Skills**: <deduplicated suggestions or none>`,
  `   - **Applicability**: <use | not-applicable + reason | unresolved/unavailable>`,
  `   - **Escape**: <none | reason + uncovered scope + evidence>`,
  `   \`\`\``,
  ``,
  `## 🤖 COGNITIVE COMPLIANCE`,
  `- **No universal skill pipeline**: do not force every task through TODO/TDD/Fable. The router selects the smallest sufficient topology; suggested skills are resolved for applicability.`,
  `- **Applicable skill flow**: reading a skill is not permission to discard it when its workflow actually applies.`,
  `- **Pre-completion verification**: before declaring done, run \`npx github:dyphn1/Harness-everything verify\` in the project root and fix failures. An instruction-only host may not block you mechanically, but the requirement remains part of the contract.`,
  `- **Rule of 3**: after 3 same-signature failures, stop micro-retrying and use a fresh diagnosis / zoom-out.`,
  `- **Environment discovery**: discover OS, shell, package manager/runtime, and host capability before relying on them.`,
  `- **Memory / self-evolve**: persist only verified reusable lessons; use escape/replan/recovery evidence to improve workflow coverage rather than bypassing the active workflow.`,
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
    `- Execute the selected workflow topology to resolution. The model controls HOW inside the topology, not WHETHER the selected topology exists.`,
    `- Do not impose a universal TODO/TDD/Fable sequence; use the smallest selected topology plus applicable skills.`,
    `- Escape only for genuinely uncovered workflow scope and record reason + scope + evidence.`,
    `- Before declaring done, run \`npx github:dyphn1/Harness-everything verify\` and fix failures.`,
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
