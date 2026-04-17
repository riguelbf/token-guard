#!/usr/bin/env node
/**
 * Claude Code — Stop hook
 * Reads token usage from the hook payload and records it.
 * Installed automatically by: token-guard install
 */

'use strict';

process.stdin.resume();
process.stdin.setEncoding('utf8');

let raw = '';
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(raw);

    // Claude Code Stop hook payload shape:
    // { session_id, model, usage: { input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens } }
    const usage = payload.usage || {};
    const model = payload.model || '';

    const input_tokens          = usage.input_tokens                  || 0;
    const output_tokens         = usage.output_tokens                 || 0;
    const cache_read_tokens     = usage.cache_read_input_tokens       || 0;
    const cache_creation_tokens = usage.cache_creation_input_tokens   || 0;

    if (input_tokens === 0 && output_tokens === 0) {
      process.exit(0);
    }

    // Resolve tracker relative to this file's location
    const tracker = require(require('path').join(__dirname, '..', 'tracker'));
    const { usage: day, callCost } = tracker.track({
      provider:  'claude',
      model,
      input_tokens,
      output_tokens,
      cache_read_tokens,
      cache_creation_tokens,
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
    // Never crash Claude Code due to our hook
    process.stderr.write(`[token-guard] hook error: ${e.message}\n`);
  }

  process.exit(0);
});
