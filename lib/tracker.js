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

function blankProvider() {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    cost_usd: 0,
    calls: 0,
  };
}

function hasActiveToken(provider) {
  const envByProvider = {
    openai: ['OPENAI_API_KEY', 'OPENAI_KEY', 'OPENAI_ACCESS_TOKEN'],
    claude: ['ANTHROPIC_API_KEY', 'ANTHROPIC_KEY', 'ANTHROPIC_ACCESS_TOKEN'],
  };

  const keys = envByProvider[provider] || [];
  return keys.some(key => Boolean(process.env[key]));
}

function blankDay(date = today()) {
  return {
    date,
    providers: {},
    estimated_providers: {},
    total_cost_usd: 0,
    estimated_total_cost_usd: 0,
    updated_at: null,
  };
}

function normalizeDay(data, fallbackDate = today(), updatedAt = null) {
  const date = typeof data.date === 'string' && data.date ? data.date : fallbackDate;
  const providers = data.providers && typeof data.providers === 'object' ? data.providers : {};
  const estimatedProviders = data.estimated_providers && typeof data.estimated_providers === 'object'
    ? data.estimated_providers
    : {};

  for (const provider of Object.values(providers)) {
    provider.input_tokens = Number(provider.input_tokens) || 0;
    provider.output_tokens = Number(provider.output_tokens) || 0;
    provider.cache_read_tokens = Number(provider.cache_read_tokens) || 0;
    provider.cache_creation_tokens = Number(provider.cache_creation_tokens) || 0;
    provider.cost_usd = Number(provider.cost_usd) || 0;
    provider.calls = Number(provider.calls) || 0;
  }

  for (const provider of Object.values(estimatedProviders)) {
    provider.input_tokens = Number(provider.input_tokens) || 0;
    provider.output_tokens = Number(provider.output_tokens) || 0;
    provider.cache_read_tokens = Number(provider.cache_read_tokens) || 0;
    provider.cache_creation_tokens = Number(provider.cache_creation_tokens) || 0;
    provider.cost_usd = Number(provider.cost_usd) || 0;
    provider.calls = Number(provider.calls) || 0;
  }

  const totalFromProviders = Object.values(providers)
    .reduce((sum, prov) => sum + (Number(prov.cost_usd) || 0), 0);
  const estimatedTotalFromProviders = Object.values(estimatedProviders)
    .reduce((sum, prov) => sum + (Number(prov.cost_usd) || 0), 0);
  const total_cost_usd = Number(data.total_cost_usd);
  const estimated_total_cost_usd = Number(data.estimated_total_cost_usd);
  const updated_at = typeof data.updated_at === 'string' ? data.updated_at : updatedAt;

  return {
    date,
    providers,
    estimated_providers: estimatedProviders,
    total_cost_usd: Number.isFinite(total_cost_usd) ? total_cost_usd : totalFromProviders,
    estimated_total_cost_usd: Number.isFinite(estimated_total_cost_usd) ? estimated_total_cost_usd : estimatedTotalFromProviders,
    updated_at,
  };
}

function loadDay(date = today()) {
  const file = usageFile(date);
  if (!fs.existsSync(file)) {
    return blankDay(date);
  }
  const mtime = fs.statSync(file).mtime.toISOString();
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return normalizeDay(data, date, mtime);
  } catch {
    return { ...blankDay(date), updated_at: mtime };
  }
}

function saveDay(data, date = today()) {
  const snapshot = {
    ...normalizeDay(data, date),
    updated_at: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(usageFile(date)), { recursive: true });
  fs.writeFileSync(usageFile(date), JSON.stringify(snapshot, null, 2));
  return snapshot;
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
  return trackInternal({ provider, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, forceEstimated: false });
}

function trackEstimated({ provider, model, input_tokens = 0, output_tokens = 0, cache_read_tokens = 0, cache_creation_tokens = 0 }) {
  return trackInternal({ provider, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, forceEstimated: true });
}

function trackInternal({ provider, model, input_tokens = 0, output_tokens = 0, cache_read_tokens = 0, cache_creation_tokens = 0, forceEstimated = false }) {
  const usage = loadDay();
  const shouldEstimate = forceEstimated || (provider === 'openai' && !hasActiveToken('openai'));
  const targetProviders = shouldEstimate ? usage.estimated_providers : usage.providers;
  const key = provider;

  if (!targetProviders[key]) {
    targetProviders[key] = blankProvider();
  }

  const p = targetProviders[key];
  p.input_tokens          += input_tokens;
  p.output_tokens         += output_tokens;
  p.cache_read_tokens     += cache_read_tokens;
  p.cache_creation_tokens += cache_creation_tokens;
  p.calls                 += 1;

  const callCost = calcCost(provider, model, input_tokens, output_tokens, cache_read_tokens);
  p.cost_usd = (p.cost_usd || 0) + callCost;

  usage.total_cost_usd = Object.values(usage.providers)
    .reduce((sum, prov) => sum + (prov.cost_usd || 0), 0);
  usage.estimated_total_cost_usd = Object.values(usage.estimated_providers || {})
    .reduce((sum, prov) => sum + (prov.cost_usd || 0), 0);

  saveDay(usage);
  return { usage, callCost, estimated: shouldEstimate };
}

/** Returns true if today's cost >= daily limit AND guard is active. */
function isBlocked() {
  const config = loadConfig();

  if (config.disabled === true) return false;
  if (config.unlocked_until === today()) return false;

  const usage = loadDay();
  return (usage.total_cost_usd + (usage.estimated_total_cost_usd || 0)) >= config.daily_limit_usd;
}

/** Unlock for today (no blocking until midnight). */
function unlockToday() {
  const config = loadConfig();
  config.unlocked_until = today();
  saveConfig(config);
}

/** Reset today's usage counters. */
function resetToday() {
  const blank = blankDay();
  return saveDay(blank);
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

module.exports = { track, trackEstimated, isBlocked, unlockToday, resetToday, loadDay, loadHistory, calcCost, today, hasActiveToken };
