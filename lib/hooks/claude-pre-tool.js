#!/usr/bin/env node
/**
 * Claude Code — PreToolUse hook
 * Blocks tool calls when the daily token cost limit is exceeded.
 * Installed automatically by: token-guard install
 */

'use strict';

process.stdin.resume();
process.stdin.setEncoding('utf8');

let raw = '';
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  try {
    // Always allow token-guard commands through (escape hatch)
    const payload = (() => { try { return JSON.parse(raw); } catch { return {}; } })();
    const toolName = payload.tool_name || '';
    const command  = (payload.tool_input || {}).command || '';
    if (command.trimStart().startsWith('token-guard')) {
      process.exit(0);
    }

    const tracker = require(require('path').join(__dirname, '..', 'tracker'));
    const config  = require(require('path').join(__dirname, '..', 'config')).load();

    // Check if guard is disabled entirely
    if (config.disabled === true) {
      process.exit(0);
    }

    if (!tracker.isBlocked()) {
      process.exit(0);
    }

    const day   = tracker.loadDay();
    const spent = day.total_cost_usd.toFixed(4);
    const limit = config.daily_limit_usd.toFixed(2);

    const reason =
      `Daily token cost limit reached: $${spent} of $${limit} used.\n` +
      `Run 'token-guard status'         — see usage details\n` +
      `Run 'token-guard unlock [+usd]'  — raise the daily limit (default +$5)\n` +
      `Run 'token-guard disable'        — turn off the guard entirely`;

    // Output block decision as JSON to stdout
    process.stdout.write(JSON.stringify({ decision: 'block', reason }));
    process.exit(2);
  } catch (e) {
    // On error, allow the tool call (fail open — don't break Claude Code)
    process.stderr.write(`[token-guard] pre-tool hook error: ${e.message}\n`);
    process.exit(0);
  }
});
