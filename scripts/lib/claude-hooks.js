// Merge/remove Harness's hook entries in a Claude Code settings.json without
// disturbing anything else a user (or another tool) put there.
const fs = require('fs');

// Every hook this package ships is namespaced "harness:<phase>:<name>" (see
// hooks/hooks.json) specifically so removal can match on that prefix alone -
// never on loose text like "does the command mention harness", which could
// false-positive on someone else's unrelated hook (e.g. a script whose path
// or name happens to contain "harness").
function isHarnessHook(hook) {
  return !!(hook && hook.id && hook.id.startsWith('harness:'));
}

function mergeHarnessHooks(claudeConfig, resolvedHooks) {
  claudeConfig.hooks = claudeConfig.hooks || {};
  for (const [hookType, hookList] of Object.entries(resolvedHooks)) {
    const existingList = claudeConfig.hooks[hookType] || [];
    const mergedList = [...existingList];
    hookList.forEach(newHook => {
      const existsIdx = mergedList.findIndex(h => h.id === newHook.id);
      if (existsIdx !== -1) {
        mergedList[existsIdx] = newHook;
      } else {
        mergedList.push(newHook);
      }
    });
    claudeConfig.hooks[hookType] = mergedList;
  }
  return claudeConfig;
}

function removeHarnessHooks(claudeSettingsFile) {
  if (!fs.existsSync(claudeSettingsFile)) return false;
  try {
    const content = fs.readFileSync(claudeSettingsFile, 'utf8');
    let config = JSON.parse(content);
    if (!config.hooks) return false;

    let modified = false;
    for (const [hookType, hookList] of Object.entries(config.hooks)) {
      if (!Array.isArray(hookList)) continue;
      const originalLength = hookList.length;
      config.hooks[hookType] = hookList.filter(hook => !isHarnessHook(hook));
      if (config.hooks[hookType].length !== originalLength) {
        modified = true;
      }
      if (config.hooks[hookType].length === 0) {
        delete config.hooks[hookType];
      }
    }
    if (Object.keys(config.hooks || {}).length === 0) {
      delete config.hooks;
    }

    if (modified) {
      if (Object.keys(config).length === 0) {
        fs.unlinkSync(claudeSettingsFile);
        console.log(`  ✅ Cleaned up and removed empty Claude settings file: ${claudeSettingsFile}`);
      } else {
        fs.writeFileSync(claudeSettingsFile, JSON.stringify(config, null, 2), 'utf8');
        console.log(`  ✅ Safely removed Harness hooks from Claude settings: ${claudeSettingsFile}`);
      }
      return true;
    }
  } catch (e) {
    console.warn(`  ⚠️ Error cleaning Claude settings file ${claudeSettingsFile}: ${e.message}`);
  }
  return false;
}

module.exports = { isHarnessHook, mergeHarnessHooks, removeHarnessHooks };
