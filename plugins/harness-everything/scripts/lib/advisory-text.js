// Prompt-injection-only guidance for platforms with no hook/execution
// mechanism (Cursor, Copilot, Codex, Continue, Hermes). Single source of
// truth for the advisory block.
const fs = require('fs');
const path = require('path');

const MARKER = "Harness OS Guidance (Advisory)";

const advisoryInstructions = [
  `\n# ${MARKER}`,
  `This file is advisory only - this platform has no hook/execution mechanism to`,
  `enforce it mechanically (unlike Claude Code's hook-based circuit breaker). Treat`,
  `these as strong defaults, not guarantees.`,
  ``,
  `## 🚦 MANDATORY ENTRY TRIAGE & ROUTING (ALWAYS RUN FIRST)`,
  `Every time you receive a new software/project prompt, you MUST load the \`harness-everything\` skill and immediately do the following:`,
  `1. Run \`npx github:dyphn1/Harness-everything next "<Brief summary of user's prompt>"\` (this prints the same routing recommendation kernel-router.js produces - it works from any directory and does not depend on where a local copy of the skill was installed). If the terminal is not available yet, apply the same routing contract from the loaded \`harness-everything\` skill instead of skipping this step.`,
  `2. For EVERY suggested skill, resolve and read its complete \`SKILL.md\` entry before deciding to skip it. Evaluate \`USE FOR\`, \`DO NOT USE FOR\`, workflow/basic flow, and hard rules against the task. If the entry explicitly requires another document to decide applicability, read that required material too. Do not reject a suggestion from only its name, description, router summary, or because the task seems routine/common.`,
  `3. After that evaluation, execution is advisory: use, combine, reorder, or skip skills as justified. Using one suggestion does not waive read-before-skip for the others. If a suggested skill cannot be resolved/read, mark it unresolved/unavailable instead of silently skipping it.`,
  `4. Output a clear routing checkpoint near the beginning of your response/update:`,
  `   \`\`\`markdown`,
  `   ## 🚦 Harness OS Routing Checkpoint`,
  `   - **Active Tier**: Tier 1 (Trivial) | Tier 2 (Standard) | Tier 3 (Macro)`,
  `   - **Rationale**: <1-sentence rationale from the router output>`,
  `   - **Required Invariants**: <router invariants>`,
  `   - **Suggested Skills**: <deduplicated router suggestions or none>`,
  `   - **Suggestion Evaluation**: <evaluated before skip | pending | unresolved/unavailable>`,
  `   - **Disposition**: <skills used, or skipped all after evaluation with a brief flow-grounded reason>`,
  `   \`\`\``,
  ``,
  `## 🤖 COGNITIVE COMPLIANCE (NO SILENT DEGRADES FOR NEW FEATURES)`,
  `- **Newly Added Features / Extensions**: Do not silently collapse a task that introduces new logic, a new API endpoint, or a new file/module into a trivial direct-edit path. Route it first and justify the tier from task evidence.`,
  `- **Tier 2 / Tier 3 Suggestions**: There is NO universal TODO/TDD/Fable sequence. Router suggestions are mandatory to evaluate by reading their skill entry, but optional to execute after that evaluation. Choose the smallest applicable set.`,
  `- **Pre-Completion Verification Gate**: Before telling the human the task is done, run \`npx github:dyphn1/Harness-everything verify\` in the project root. If it exits non-zero, fix the failures and run it again before declaring completion. On Claude Code this same check can be mechanically enforced by a stop hook; here nothing blocks you from skipping it, so treat it as a real requirement, not a suggestion.`,
  `- **Memory Summarization (Self-Evolve)**: When the task produces a reusable verified lesson, use the \`self-evolve\` flow to persist it; do not manufacture memory for routine work.`,
  `- **Environment Discovery**: Discover the environment (OS, shell, package manager) before running commands - don't assume.`,
  `- **Rule of 3**: If the same error repeats 3 times in a row, STOP retrying. Explain what's failing and use a fresh diagnosis / zoom-out instead of continuing to guess.`,
  `- **Prefer Editing**: Prefer editing over rewriting; commit logically complete chunks rather than one giant diff.`,
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
    let content = fs.readFileSync(targetFile, 'utf8');
    const markerIndex = content.indexOf(MARKER);
    if (markerIndex !== -1) {
      let cleanContent = content;
      const hashMarkerIndex = content.lastIndexOf('#', markerIndex);
      if (hashMarkerIndex !== -1) cleanContent = content.substring(0, hashMarkerIndex).trim() + '\n';
      else cleanContent = content.substring(0, markerIndex).trim() + '\n';

      const lines = cleanContent.trim().split('\n').map(l => l.trim()).filter(l => l !== '');
      if (lines.length === 0 || (lines.length === 1 && (lines[0] === '# Cursor Project Rules' || lines[0] === '# AGENTS.md' || lines[0] === '# Copilot Instructions' || lines[0] === '# .hermes.md'))) {
        fs.unlinkSync(targetFile);
        console.log(`  ✅ Removed empty advisory file: ${targetFile}`);
      } else {
        fs.writeFileSync(targetFile, cleanContent.trim() + '\n', 'utf8');
        console.log(`  ✅ Removed Harness guidance from: ${targetFile}`);
      }
    }
  } catch (e) {
    console.warn(`  ⚠️ Error removing advisory text from ${targetFile}: ${e.message}`);
  }
}

// Continue gets a dedicated rule file. If a user already owns that exact
// path, do not replace it just because Harness chose the same filename.
function installContinueRule(targetFile, label) {
  const dir = path.dirname(targetFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  assertHarnessOwnedOrAbsent(targetFile, label);
  if (fs.existsSync(targetFile) && hasHarnessMarker(fs.readFileSync(targetFile, 'utf8'))) return;
  const content = [
    `---`,
    `name: Harness OS Guidance`,
    `alwaysApply: true`,
    `description: "Harness OS routing, circuit-breaker awareness, and environment-discovery guidance (advisory only on Continue - no hook mechanism)"`,
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
    `description: "Harness OS Guidance - Global custom agent for orchestrating multi-agent workflows"`,
    `name: "Harness"`,
    `user-invocable: true`,
    `---`,
    `# AGENTS.md`,
    ``,
    `# ${MARKER}`,
    `This file is advisory only - this platform has no hook/execution mechanism to`,
    `enforce it mechanically. Treat these as strong defaults, not guarantees.`,
    ``,
    `- Discover the environment (OS, shell, package manager) before running commands - don't assume.`,
    `- For software/project work, run \`npx github:dyphn1/Harness-everything next "<summary>"\` before mutation and surface the routing checkpoint.`,
    `- For EVERY suggested skill, read its complete \`SKILL.md\` entry/basic flow before skipping it. Evaluate \`USE FOR\`, \`DO NOT USE FOR\`, workflow, and hard rules; do not skip from the name/description/router summary alone.`,
    `- Suggested-skill execution remains optional after evaluation. Using one suggestion does not waive evaluation of the other omitted suggestions; unreadable suggestions are unresolved/unavailable, not silently skipped.`,
    `- Do not impose a universal TODO/TDD/Fable sequence. Choose the smallest applicable skill set after evaluation.`,
    `- Before declaring a task done, run \`npx github:dyphn1/Harness-everything verify\` and fix any failures`,
    `  it reports - nothing here blocks you from skipping this, so treat it as a real requirement.`,
    `- If the same error repeats 3 times in a row, STOP retrying and use a fresh diagnosis / zoom-out.`,
    `- Prefer editing over rewriting; commit logically complete chunks rather than one giant diff.`,
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