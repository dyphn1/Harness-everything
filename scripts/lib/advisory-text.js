// Prompt-injection-only guidance for platforms with no hook/execution
// mechanism (Cursor, Copilot, Codex, Continue, Hermes). Single source of
// truth for the advisory block - it used to be duplicated verbatim inside
// installer.js's top level and again inside main().
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
  `Every time you receive a new prompt, you MUST load the \`harness-everything\` skill and immediately do the following:`,
  `1. Run the Tier Router script: \`node harness-everything/scripts/tier-router.js "<Brief summary of user's prompt>"\` (or simulate its routing logic if terminal is not initialized yet).`,
  `2. Output a clear, stylized routing checkpoint block at the VERY BEGINNING of your response to the user:`,
  `   \`\`\`markdown`,
  `   ## 🚦 Harness OS Routing Checkpoint`,
  `   - **Active Tier**: Tier 1 (Trivial) | Tier 2 (Standard) | Tier 3 (Macro)`,
  `   - **Rationale**: <1-sentence rationale from the tier router output>`,
  `   - **Routed Skills, Guides & Actions**:`,
  `     - \`path/to/skill/or/guide.md\` (<Brief reason why this guide/skill is loaded/used>)`,
  `   \`\`\``,
  ``,
  `## 🤖 COGNITIVE COMPLIANCE (NO SILENT DEGRADES FOR NEW FEATURES)`,
  `- **Newly Added Features / Extensions**: Copilot is highly prone to treating new feature requests as Tier 1 direct edits. If a task introduces *any* new logic, a new API endpoint, or a new file/module, you **MUST NOT** treat it as Tier 1. It **MUST** be treated as a **Tier 2 (Standard Task)** or **Tier 3 (Macro Task)**.`,
  `- **Tier 2 Activation**: Initialize the \`todo-driven-workflow\` checklist first. Summon Domain Experts based on tech stack. Load and execute the \`tdd\` (Test-Driven Development) skill (write tests first, implement, refactor).`,
  `- **Tier 3 Activation**: Initialize the \`todo-driven-workflow\` checklist, load \`fable-mode\` and \`fable-discipline\`, run sub-agents via \`create-agent-launcher\`, and write global docs using \`repo-docs\`.`,
  `- **Memory Summarization (Self-Evolve)**: Upon task completion, you **MUST** run the \`self-evolve\` skill (running \`node self-evolve/scripts/self-regression.js\` or writing memories) to record key insights, lessons learned, and error boundaries so your context builds across sessions.`,
  `- **Environment Discovery**: Discover the environment (OS, shell, package manager) before running commands - don't assume.`,
  `- **Rule of 3**: If the same error repeats 3 times in a row, STOP retrying. Explain what's failing and ask the human for direction instead of continuing to guess.`,
  `- **Prefer Editing**: Prefer editing over rewriting; commit logically complete chunks rather than one giant diff.`,
  ``
].join('\n');

function injectAdvisoryText(targetFile, header, label) {
  const dir = path.dirname(targetFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (fs.existsSync(targetFile)) {
    const content = fs.readFileSync(targetFile, 'utf8');
    if (!content.includes(MARKER)) {
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
      if (hashMarkerIndex !== -1) {
        cleanContent = content.substring(0, hashMarkerIndex).trim() + '\n';
      } else {
        cleanContent = content.substring(0, markerIndex).trim() + '\n';
      }

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

// Continue.dev reads project rules as individual Markdown files (with YAML
// frontmatter) from a `.continue/rules/` folder rather than one shared file,
// so - unlike the shared-file platforms above - Harness gets its own
// dedicated `harness.md` rule file instead of appending into an arbitrary
// pre-existing one.
function installContinueRule(targetFile, label) {
  const dir = path.dirname(targetFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(targetFile) && fs.readFileSync(targetFile, 'utf8').includes(MARKER)) {
    return;
  }
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
    if (content.includes(MARKER)) {
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
    `This file is advisory only - this platform has no hook/execution mechanism to`,
    `enforce it mechanically (unlike Claude Code's hook-based circuit breaker). Treat`,
    `these as strong defaults, not guarantees.`,
    ``,
    `- Discover the environment (OS, shell, package manager) before running commands - don't assume.`,
    `- Triage tasks: trivial fixes need no plan; standard features need tests; large refactors need`,
    `  an explicit plan reviewed with the human before implementation.`,
    `- If the same error repeats 3 times in a row, STOP retrying. Explain what's failing and ask the`,
    `  human for direction instead of continuing to guess.`,
    `- Prefer editing over rewriting; commit logically complete chunks rather than one giant diff.`,
    ``
  ].join('\n');
}

module.exports = {
  MARKER,
  advisoryInstructions,
  injectAdvisoryText,
  removeAdvisoryText,
  installContinueRule,
  removeContinueRule,
  buildCopilotGlobalContent,
  buildCodexGlobalContent,
};
