'use strict';

const fs = require('fs');
const path = require('path');
const { load: loadConfig, save: saveConfig, USAGE_DIR } = require('./config');

function today() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function usageFile(date = today()) {
  return path.join(USAGE_DIR, `${date}.json`);
}

function loadDay(date = today()) {
  const file = usageFile(date);
  if (!fs.existsSync(file)) {
    return { date, providers: {}, total_cost_usd: 0 };
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { date, providers: {}, total_cost_usd: 0 };
  }
}

function saveDay(data, date = today()) {
  fs.writeFileSync(usageFile(date), JSON.stringify(data, null, 2));
}

function calcCost(provider, model, inputTokens, outputTokens, cacheReadTokens = 0) {
  const config = loadConfig();

  // Find matching model costs (partial match, longest wins)
  let costs = null;
  if (model) {
    const lm = model.toLowerCase();
    const matchedKey = Object.keys(config.models)
      .filter(k => lm.includes(k.toLowerCase()))
      .sort((a, b) => b.length - a.length)[0];
    if (matchedKey) costs = config.models[matchedKey];
  }

  if (!costs) {
    costs = config.default_costs[provider] || config.default_costs.openai;
  }

  const inputCost     = (inputTokens     / 1_000_000) * costs.input;
  const outputCost    = (outputTokens    / 1_000_000) * costs.output;
  const cacheCost     = (cacheReadTokens / 1_000_000) * (costs.cache_read || 0);

  return inputCost + outputCost + cacheCost;
}

/**
 * Record token usage.
 * @param {object} opts
 * @param {string} opts.provider - 'claude' | 'openai'
 * @param {string} [opts.model]
 * @param {number} [opts.input_tokens]
 * @param {number} [opts.output_tokens]
 * @param {number} [opts.cache_read_tokens]
 * @param {number} [opts.cache_creation_tokens]
 * @returns {{ usage: object, callCost: number }}
 */
function track({ provider, model, input_tokens = 0, output_tokens = 0, cache_read_tokens = 0, cache_creation_tokens = 0 }) {
  const usage = loadDay();

  if (!usage.providers[provider]) {
    usage.providers[provider] = {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      cost_usd: 0,
      calls: 0,
    };
  }

  const p = usage.providers[provider];
  p.input_tokens          += input_tokens;
  p.output_tokens         += output_tokens;
  p.cache_read_tokens     += cache_read_tokens;
  p.cache_creation_tokens += cache_creation_tokens;
  p.calls                 += 1;

  const callCost = calcCost(provider, model, input_tokens, output_tokens, cache_read_tokens);
  p.cost_usd = (p.cost_usd || 0) + callCost;

  usage.total_cost_usd = Object.values(usage.providers)
    .reduce((sum, prov) => sum + (prov.cost_usd || 0), 0);

  saveDay(usage);
  return { usage, callCost };
}

/** Returns true if today's cost >= daily limit AND guard is active. */
function isBlocked() {
  const config = loadConfig();

  if (config.disabled === true) return false;
  if (config.unlocked_until === today()) return false;

  const usage = loadDay();
  return usage.total_cost_usd >= config.daily_limit_usd;
}

/** Unlock for today (no blocking until midnight). */
function unlockToday() {
  const config = loadConfig();
  config.unlocked_until = today();
  saveConfig(config);
}

/** Reset today's usage counters. */
function resetToday() {
  const blank = { date: today(), providers: {}, total_cost_usd: 0 };
  saveDay(blank);
  return blank;
}

/** Load usage for the last N days. */
function loadHistory(days = 7) {
  const result = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const date = `${y}-${m}-${day}`;
    result.push(loadDay(date));
  }
  return result;
}

module.exports = { track, isBlocked, unlockToday, resetToday, loadDay, loadHistory, calcCost, today };
