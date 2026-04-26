'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.token-guard');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const USAGE_DIR = path.join(CONFIG_DIR, 'usage');
const ACTIVATION_FILE = path.join(CONFIG_DIR, 'activation.txt');

// Cost per 1M tokens in USD
const DEFAULT_CONFIG = {
  daily_limit_usd: 10.0,
  proxy_port: 4141,
  unlocked_until: null,
  models: {
    // Claude
    'claude-opus-4':       { input: 15,   output: 75,   cache_read: 1.50 },
    'claude-opus-4-5':     { input: 15,   output: 75,   cache_read: 1.50 },
    'claude-opus-4-6':     { input: 15,   output: 75,   cache_read: 1.50 },
    'claude-sonnet-4':     { input: 3,    output: 15,   cache_read: 0.30 },
    'claude-sonnet-4-5':   { input: 3,    output: 15,   cache_read: 0.30 },
    'claude-sonnet-4-6':   { input: 3,    output: 15,   cache_read: 0.30 },
    'claude-haiku-4':      { input: 0.8,  output: 4,    cache_read: 0.08 },
    'claude-haiku-4-5':    { input: 0.8,  output: 4,    cache_read: 0.08 },
    // OpenAI / Codex
    'gpt-4o':              { input: 2.5,  output: 10   },
    'gpt-4o-mini':         { input: 0.15, output: 0.6  },
    'o1':                  { input: 15,   output: 60   },
    'o1-mini':             { input: 3,    output: 12   },
    'o3':                  { input: 10,   output: 40   },
    'o3-mini':             { input: 1.1,  output: 4.4  },
    'gpt-4-turbo':         { input: 10,   output: 30   },
    'gpt-4':               { input: 30,   output: 60   },
    'gpt-3.5-turbo':       { input: 0.5,  output: 1.5  },
    'codex-mini-latest':   { input: 1.5,  output: 6    },
  },
  // Fallback when model is unknown
  default_costs: {
    claude: { input: 3,   output: 15,  cache_read: 0.3 },
    openai: { input: 2.5, output: 10  },
  },
};

function ensureDirs() {
  [CONFIG_DIR, USAGE_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

function load() {
  ensureDirs();
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return structuredClone(DEFAULT_CONFIG);
  }
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    // Deep merge: keep saved top-level values, but merge models
    return {
      ...DEFAULT_CONFIG,
      ...saved,
      models: { ...DEFAULT_CONFIG.models, ...(saved.models || {}) },
      default_costs: { ...DEFAULT_CONFIG.default_costs, ...(saved.default_costs || {}) },
    };
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

function save(config) {
  ensureDirs();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

module.exports = { load, save, CONFIG_DIR, USAGE_DIR, CONFIG_FILE, ACTIVATION_FILE };
