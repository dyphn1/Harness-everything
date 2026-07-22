#!/usr/bin/env node
/**
 * Harness Todo CLI
 * A strict state machine for task management.
 * Designed to slap the LLM with Exit Code 1 if it violates the Todo-Driven Workflow.
 */
const fs = require('fs');
const path = require('path');
const { getWorkspaceRoot, getStateRoot } = require('../../hooks/scripts/lib/harness-state');

// Shared across sessions (not scoped to one): todo-cli.js is invoked as a
// plain CLI command by the agent, not a hook, so it never receives a
// session_id to scope by.
const harnessDir = getStateRoot(getWorkspaceRoot());
const stateFile = path.join(harnessDir, 'todo-state.json');

if (!fs.existsSync(harnessDir)) {
  fs.mkdirSync(harnessDir, { recursive: true });
}

function loadState() {
  if (fs.existsSync(stateFile)) {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  }
  return { tasks: [], activeId: null };
}

function saveState(state) {
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

function printList(state) {
  console.log('\n📋 Current Todo List:');
  if (state.tasks.length === 0) {
    console.log('  (Empty)');
  }
  state.tasks.forEach(t => {
    const status = t.id === state.activeId ? '[IN-PROGRESS]' : (t.completed ? '[COMPLETED]' : '[NOT-STARTED]');
    console.log(`  ${t.id}. ${status} ${t.title}`);
  });
  console.log('');
}

const args = process.argv.slice(2);
const command = args[0];

if (!command) {
  console.error("❌ Error: Missing command. Use 'init', 'add', 'start', 'complete', or 'status'.");
  process.exit(1);
}

const state = loadState();

switch (command) {
  case 'init':
    state.tasks = [];
    state.activeId = null;
    args.slice(1).forEach((title, idx) => {
      state.tasks.push({ id: idx + 1, title, completed: false });
    });
    saveState(state);
    console.log("✅ Todo list initialized.");
    printList(state);
    break;

  case 'add':
    const title = args.slice(1).join(' ');
    if (!title) {
      console.error("❌ Error: Missing task title.");
      process.exit(1);
    }
    const nextId = state.tasks.length > 0 ? Math.max(...state.tasks.map(t => t.id)) + 1 : 1;
    state.tasks.push({ id: nextId, title, completed: false });
    saveState(state);
    console.log(`✅ Added task ${nextId}.`);
    printList(state);
    break;

  case 'start':
    const startId = parseInt(args[1], 10);
    if (!startId) {
      console.error("❌ Error: Missing task ID. Usage: start <id>");
      process.exit(1);
    }
    if (state.activeId !== null && state.activeId !== startId) {
      console.error(`❌ [BLOCKED] Task ${state.activeId} is already IN-PROGRESS.`);
      console.error(`You MUST complete or un-start task ${state.activeId} before starting a new one. No multitasking.`);
      process.exit(1);
    }
    const taskToStart = state.tasks.find(t => t.id === startId);
    if (!taskToStart) {
      console.error(`❌ Error: Task ${startId} not found.`);
      process.exit(1);
    }
    if (taskToStart.completed) {
      console.error(`❌ Error: Task ${startId} is already completed.`);
      process.exit(1);
    }
    state.activeId = startId;
    saveState(state);
    console.log(`🚀 Started task ${startId}: ${taskToStart.title}`);
    break;

  case 'complete':
    const compId = parseInt(args[1], 10);
    if (!compId) {
      console.error("❌ Error: Missing task ID. Usage: complete <id>");
      process.exit(1);
    }
    if (state.activeId !== compId) {
      console.error(`❌ [BLOCKED] Task ${compId} is NOT currently in-progress.`);
      console.error(`You can only complete the active task. Active task is: ${state.activeId || 'None'}`);
      process.exit(1);
    }
    
    // ACTIONABLE RECOMMENDATION #1: Enforce State Transitions Programmatically
    // Do not rely on prompt obedience for running verify-gate.js. The CLI should block the complete command
    console.log("=== 🛡️ Executing Pre-Completion Verification Gate ===");
    try {
      const verifyScript = path.join(__dirname, 'verify-gate.js');
      if (fs.existsSync(verifyScript)) {
        require('child_process').execSync(`node "${verifyScript}"`, { stdio: 'inherit' });
      }
    } catch (err) {
      console.error(`\n❌ [BLOCKED] Verification Gate Failed (Exit Code 1).`);
      console.error(`You CANNOT complete this task. The code is broken.`);
      console.error(`Please fix the errors shown above and try again.`);
      process.exit(1);
    }

    const taskToComp = state.tasks.find(t => t.id === compId);
    taskToComp.completed = true;
    state.activeId = null;
    saveState(state);
    console.log(`✅ Completed task ${compId}: ${taskToComp.title}`);
    printList(state);
    break;

  case 'status':
    printList(state);
    break;

  default:
    console.error(`❌ Error: Unknown command '${command}'.`);
    process.exit(1);
}
