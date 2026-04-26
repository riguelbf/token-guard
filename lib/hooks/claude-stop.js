#!/usr/bin/env node
/**
 * Claude Code — Stop hook
 * Reads token usage from the hook payload and records it.
 * Installed automatically by: token-guard install
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEBUG_LOG = path.join(os.tmpdir(), 'token-guard-claude-stop.log');

process.stdin.resume();
process.stdin.setEncoding('utf8');

let raw = '';
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(raw);
    const payloadKeys = Object.keys(payload || {});

    function appendDebug(line) {
      try {
        fs.appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${line}\n`);
      } catch { /* ignore debug logging errors */ }
    }

    function looksLikeUsageObject(value) {
      return !!value && typeof value === 'object' && (
        Object.prototype.hasOwnProperty.call(value, 'input_tokens') ||
        Object.prototype.hasOwnProperty.call(value, 'output_tokens') ||
        Object.prototype.hasOwnProperty.call(value, 'prompt_tokens') ||
        Object.prototype.hasOwnProperty.call(value, 'completion_tokens') ||
        Object.prototype.hasOwnProperty.call(value, 'cache_read_input_tokens') ||
        Object.prototype.hasOwnProperty.call(value, 'cache_creation_input_tokens') ||
        Object.prototype.hasOwnProperty.call(value, 'input_tokens_details') ||
        Object.prototype.hasOwnProperty.call(value, 'prompt_tokens_details') ||
        Object.prototype.hasOwnProperty.call(value, 'output_tokens_details')
      );
    }

    function findUsageObject(value, depth = 0, seen = new Set()) {
      if (!value || typeof value !== 'object' || depth > 6 || seen.has(value)) {
        return null;
      }
      seen.add(value);

      if (looksLikeUsageObject(value)) return value;
      if (looksLikeUsageObject(value.usage)) return value.usage;

      const preferredKeys = ['response', 'data', 'output', 'result', 'item', 'message'];
      for (const key of preferredKeys) {
        const found = findUsageObject(value[key], depth + 1, seen);
        if (found) return found;
      }

      for (const child of Object.values(value)) {
        const found = findUsageObject(child, depth + 1, seen);
        if (found) return found;
      }

      return null;
    }

    function normalizeUsage(usage) {
      if (!usage || typeof usage !== 'object') return null;
      return {
        input_tokens: Number(usage.input_tokens ?? usage.prompt_tokens ?? 0) || 0,
        output_tokens: Number(usage.output_tokens ?? usage.completion_tokens ?? 0) || 0,
        cache_read_tokens: Number(
          usage.cache_read_input_tokens ??
          usage.cache_read_tokens ??
          usage.input_tokens_details?.cached_tokens ??
          usage.prompt_tokens_details?.cached_tokens ??
          0
        ) || 0,
        cache_creation_tokens: Number(
          usage.cache_creation_input_tokens ??
          usage.output_tokens_details?.cached_tokens ??
          0
        ) || 0,
      };
    }

    function resolveTranscriptPath(transcriptPath) {
      if (!transcriptPath || typeof transcriptPath !== 'string') return null;
      if (transcriptPath.startsWith('~')) {
        return path.join(os.homedir(), transcriptPath.slice(1));
      }
      return transcriptPath;
    }

    function findLatestAssistantUsageFromTranscript(transcriptPath) {
      const resolvedPath = resolveTranscriptPath(transcriptPath);
      if (!resolvedPath || !fs.existsSync(resolvedPath)) {
        appendDebug(`transcript_missing path=${transcriptPath || '-'}`);
        return null;
      }

      const lines = fs.readFileSync(resolvedPath, 'utf8').split(/\r?\n/);
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const line = lines[i].trim();
        if (!line) continue;

        let entry;
        try {
          entry = JSON.parse(line);
        } catch {
          continue;
        }

        const role = entry?.message?.role;
        const messageUsage = entry?.message?.usage;
        const topLevelUsage = entry?.usage;
        const usageCandidate = findUsageObject(messageUsage) || findUsageObject(topLevelUsage);

        if (role === 'assistant' && usageCandidate) {
          appendDebug(`transcript_usage_found line=${i + 1} path=${resolvedPath}`);
          return usageCandidate;
        }
      }

      appendDebug(`transcript_usage_not_found path=${resolvedPath}`);
      return null;
    }

    const usage = findUsageObject(payload) || findLatestAssistantUsageFromTranscript(payload.transcript_path);
    const model = payload.model || payload.response?.model || '';
    const usageKeys = usage ? Object.keys(usage) : [];

    appendDebug(
      `seen payloadKeys=${payloadKeys.join(',') || '-'} usageKeys=${usageKeys.join(',') || '-'} model=${model || '-'}`
    );

    const normalized = normalizeUsage(usage);
    if (!normalized) {
      appendDebug('no_usage_found');
      process.exit(0);
    }

    if (
      normalized.input_tokens === 0 &&
      normalized.output_tokens === 0 &&
      normalized.cache_read_tokens === 0 &&
      normalized.cache_creation_tokens === 0
    ) {
      process.exit(0);
    }

    // Resolve tracker relative to this file's location
    const tracker = require(require('path').join(__dirname, '..', 'tracker'));
    const { usage: day, callCost } = tracker.track({
      provider:  'claude',
      model,
      ...normalized,
    });

    // Warn when approaching limit (80%) but don't block here — PreToolUse handles blocking
    const config     = require(require('path').join(__dirname, '..', 'config')).load();
    const ratio      = day.total_cost_usd / config.daily_limit_usd;

    if (ratio >= 0.8 && ratio < 1) {
      process.stderr.write(
        `[token-guard] Warning: ${(ratio * 100).toFixed(0)}% of daily budget used ($${day.total_cost_usd.toFixed(4)}/$${config.daily_limit_usd})\n`
      );
    }

    if (ratio >= 1) {
      process.stderr.write(
        `[token-guard] Daily limit reached ($${day.total_cost_usd.toFixed(4)}/$${config.daily_limit_usd}). Next tool call will be blocked. Run 'token-guard unlock' to continue.\n`
      );
    }
  } catch (e) {
    try {
      fs.appendFileSync(DEBUG_LOG, `${new Date().toISOString()} error=${e.message}\n`);
    } catch { /* ignore debug logging errors */ }
    // Never crash Claude Code due to our hook
    process.stderr.write(`[token-guard] hook error: ${e.message}\n`);
  }

  process.exit(0);
});
