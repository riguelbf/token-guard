'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { load: loadConfig, CONFIG_DIR, ACTIVATION_FILE } = require('./config');

const CLAUDE_SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
const CODEX_CONFIG    = path.join(os.homedir(), '.codex', 'config.toml');
const HOOK_STOP       = path.join(__dirname, 'hooks', 'claude-stop.js');
const HOOK_PRE_TOOL   = path.join(__dirname, 'hooks', 'claude-pre-tool.js');
const CODEX_START     = '# token-guard start';
const CODEX_END       = '# token-guard end';

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

function loadCodexConfig() {
  if (!fs.existsSync(CODEX_CONFIG)) return '';
  return fs.readFileSync(CODEX_CONFIG, 'utf8');
}

function saveCodexConfig(content) {
  const dir = path.dirname(CODEX_CONFIG);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CODEX_CONFIG, content);
}

function saveActivationFile(content) {
  const dir = path.dirname(ACTIVATION_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ACTIVATION_FILE, content);
}

function buildCodexBlock() {
  const port = loadConfig().proxy_port;
  return [
    CODEX_START,
    `openai_base_url = "http://127.0.0.1:${port}/v1"`,
    CODEX_END,
  ].join('\n');
}

function ensureCodexIntegration() {
  const current = loadCodexConfig();
  const block = buildCodexBlock();
  const port = loadConfig().proxy_port;

  if (current.includes(CODEX_START) && current.includes(CODEX_END)) {
    const start = current.indexOf(CODEX_START);
    const end = current.indexOf(CODEX_END) + CODEX_END.length;
    const next = current.slice(0, start) + block + current.slice(end);
    if (next !== current) saveCodexConfig(next);
  } else {
    const next = `${current.replace(/\s*$/, '')}

${block}
`;
    saveCodexConfig(next);
  }

  const activation = [
    `Token Guard activation`,
    `- Config directory: ${CONFIG_DIR}`,
    `- Codex config: ${CODEX_CONFIG}`,
    `- Proxy URL: http://127.0.0.1:${port}/v1`,
    `- Claude hooks are already configured in ~/.claude/settings.json`,
    `- This file is shell-agnostic and portable across macOS, Linux, and Windows`,
  ].join('\n');
  saveActivationFile(activation + '\n');

  return { changed: true, alreadyPresent: current.includes(CODEX_START) && current.includes(CODEX_END) };
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

  const codex = ensureCodexIntegration();
  if (codex.alreadyPresent) {
    console.log('  [=] Codex config already present');
  } else {
    console.log('  [+] Codex config installed');
  }
  console.log(`  [+] Portable activation file written: ${ACTIVATION_FILE}`);

  return settings;
}

function uninstall() {
  const settings = loadSettings();
  if (!settings.hooks) settings.hooks = {};

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

  const current = loadCodexConfig();
  if (current.includes(CODEX_START) && current.includes(CODEX_END)) {
    const start = current.indexOf(CODEX_START);
    const end = current.indexOf(CODEX_END) + CODEX_END.length;
    const next = current.slice(0, start).replace(/\s*$/, '') + '\n' + current.slice(end).replace(/^\s*/, '');
    saveCodexConfig(next);
    console.log('  [-] Codex config removed');
  }
  if (fs.existsSync(ACTIVATION_FILE)) {
    fs.unlinkSync(ACTIVATION_FILE);
    console.log('  [-] Portable activation file removed');
  }

  const zshrc = path.join(os.homedir(), '.zshrc');
  if (fs.existsSync(zshrc)) {
    const currentZsh = fs.readFileSync(zshrc, 'utf8');
    const cleanedZsh = currentZsh
      .split('# token-guard start')
      .join('')
      .split('# token-guard end')
      .join('')
      .replace(/\n{3,}/g, '\n\n');
    if (cleanedZsh !== currentZsh) fs.writeFileSync(zshrc, cleanedZsh);
  }
}

function status() {
  const settings = loadSettings();
  const hooks    = settings.hooks || {};
  const stop     = hasHook(hooks.Stop || [], 'claude-stop');
  const preTool  = hasHook(hooks.PreToolUse || [], 'claude-pre-tool');
  return { stop, preTool };
}

module.exports = { install, uninstall, status };
