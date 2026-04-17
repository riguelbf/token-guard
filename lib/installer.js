'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const CLAUDE_SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
const HOOK_STOP       = path.join(__dirname, 'hooks', 'claude-stop.js');
const HOOK_PRE_TOOL   = path.join(__dirname, 'hooks', 'claude-pre-tool.js');

function loadSettings() {
  if (!fs.existsSync(CLAUDE_SETTINGS)) return {};
  try {
    return JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'));
  } catch {
    return {};
  }
}

function saveSettings(s) {
  const dir = path.dirname(CLAUDE_SETTINGS);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(s, null, 2));
}

function hasHook(hookList, marker) {
  return hookList.some(entry =>
    (entry.hooks || []).some(h => (h.command || '').includes(marker))
  );
}

function addHook(hookList, command) {
  hookList.push({
    matcher: '',
    hooks: [{ type: 'command', command }],
  });
}

function install() {
  const settings = loadSettings();
  if (!settings.hooks) settings.hooks = {};

  // Stop hook — track usage
  if (!settings.hooks.Stop) settings.hooks.Stop = [];
  if (!hasHook(settings.hooks.Stop, 'claude-stop')) {
    addHook(settings.hooks.Stop, `node ${HOOK_STOP}`);
    console.log('  [+] Stop hook installed');
  } else {
    console.log('  [=] Stop hook already present');
  }

  // PreToolUse hook — block when over limit
  if (!settings.hooks.PreToolUse) settings.hooks.PreToolUse = [];
  if (!hasHook(settings.hooks.PreToolUse, 'claude-pre-tool')) {
    addHook(settings.hooks.PreToolUse, `node ${HOOK_PRE_TOOL}`);
    console.log('  [+] PreToolUse hook installed');
  } else {
    console.log('  [=] PreToolUse hook already present');
  }

  saveSettings(settings);
  return settings;
}

function uninstall() {
  const settings = loadSettings();
  if (!settings.hooks) return;

  ['Stop', 'PreToolUse'].forEach(event => {
    if (!settings.hooks[event]) return;
    const before = settings.hooks[event].length;
    settings.hooks[event] = settings.hooks[event].filter(entry =>
      !(entry.hooks || []).some(h =>
        (h.command || '').includes('claude-stop') ||
        (h.command || '').includes('claude-pre-tool')
      )
    );
    const after = settings.hooks[event].length;
    if (before !== after) console.log(`  [-] ${event} hook removed`);
  });

  saveSettings(settings);
}

function status() {
  const settings = loadSettings();
  const hooks    = settings.hooks || {};
  const stop     = hasHook(hooks.Stop || [], 'claude-stop');
  const preTool  = hasHook(hooks.PreToolUse || [], 'claude-pre-tool');
  return { stop, preTool };
}

module.exports = { install, uninstall, status };
