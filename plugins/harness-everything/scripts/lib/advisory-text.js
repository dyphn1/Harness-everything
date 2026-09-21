// Prompt-injection guidance for integration paths where Harness cannot prove
// lifecycle-hook enforcement. Single source of truth for advisory blocks.
const fs = require('fs');
const path = require('path');

const MARKER = "Harness OS Guidance (Advisory)";

const advisoryInstructions = [
  `\n# ${MARKER}`,
  `Harness is an observer/router/reminder layer on this surface. Instruction/advisory delivery describes the mechanism, not semantic optionality; do not treat Harness as a hard scheduler.`,
  ``,
  `## 🚦 ENTRY TRIAGE & SEMANTIC CONTRACT`,
  `For software/project work, load the \`harness-everything\` skill and establish routing context before broad mutation:`,
  `1. MUST route before broad mutation; run \`npx github:dyphn1/Harness-everything next "<Brief summary of user's prompt>"\` when terminal execution is available and no equivalent routing state was injected.`,
  `2. MUST read/evaluate EVERY suggested skill. If applicable, MUST follow its core contract; if not-applicable, keep a flow-grounded reason.`,
  `3. Selected-topology required obligations are MUSTs. Implementation tactics MAY adapt; numeric iteration/revision/replan/worker values MAY guide planning but never hard-block.`,
  `4. MUST verify before claiming completion. Tier-3/Fable broad mutation MUST resolve isolation: linked worktree or explicit degraded fallback.`,
  `5. Use the routing checkpoint only as internal source state for the first Harness Status; do not render a competing progress block.`,
  ``,
  `## 📣 USER-VISIBLE STATUS (MUST)`,
  `For non-trivial software/project work, this semantic communication contract is mandatory even when the host integration itself is instruction-only. Render this Markdown shape:`,
  `### 🚦 Harness Status`,
  ``,
  `- **Current:** <what is being done now>`,
  `- **Read / Evidence:** <one short item inline, or nested bullets when there are multiple items>`,
  `- **Next:** <next intended action>`,
  `- **Risk / Blocked:** <only when materially applicable; omit otherwise>`,
  `Emit it before substantive execution, after a major phase, when direction materially changes, at meaningful long-running phase boundaries, and before final completion. This MUST does not imply a hard runtime lock.`,
  ``,
  `## 🤖 COGNITIVE COMPLIANCE`,
  `- **No universal skill pipeline**: do not force every task through TODO/TDD/Fable.`,
  `- **Rule of 3**: after 3 same-signature failures, stop micro-retrying and use a fresh diagnosis / zoom-out. This reflection boundary may block mutation until completed.`,
  `- **Permission boundaries are separate**: explicit host/user approval for destructive or external actions remains authoritative.`,
  `- **Contract strength**: MUST = required semantic obligation; SHOULD = default with evidence-based exception; MAY = optional optimization. Reminder-only mechanics never downgrade MUST.`,
  `- **Verification is evidence, not a cage**: MUST verify before completion claims; host hooks may remind rather than persistently block.`,
  `- **Environment discovery**: MUST establish relevant OS/shell/toolchain/host facts before relying on environment-sensitive behavior.`,
  `- **Memory / self-evolve**: durable writes MUST be authorized by the active workflow/session contract and backed by verified reusable evidence.`,
  `- **Editing / commits**: targeted edits SHOULD be preferred; before committing, MUST inspect the staged diff and SHOULD split unrelated concerns.`,
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
    `- MUST establish relevant environment/host facts before relying on environment-sensitive behavior.`,
    `- For software/project work, MUST establish routing before broad mutation; use \`npx github:dyphn1/Harness-everything next "<summary>"\` when terminal execution is available and routing state was not already injected.`,
    `- For non-trivial work, MUST render one Markdown \`### 🚦 Harness Status\` with bullet-aligned bold \`Current\`, \`Read / Evidence\`, \`Next\`, and optional \`Risk / Blocked\`; repeat it at major phase/direction boundaries and before final completion.`,
    `- MUST read/evaluate every suggested skill; applicable skill core contracts MUST be followed, while not-applicable needs a flow-grounded reason.`,
    `- Selected-topology required obligations are MUSTs; implementation tactics MAY adapt and numeric planning values MAY guide but never hard-block.`,
    `- Do not impose a universal TODO/TDD/Fable sequence; use the smallest useful topology plus applicable skills.`,
    `- MUST verify before declaring done; a reminder-only host mechanism does not make verification optional.`,
    `- Tier-3/Fable broad mutation MUST resolve isolation: verified linked worktree or explicit degraded fallback.`,
    `- After 3 same-signature failures, MUST stop retrying and use a fresh diagnosis / zoom-out.`,
    `- Targeted edits SHOULD be preferred; before committing, MUST inspect the staged diff and SHOULD split unrelated concerns.`,
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
