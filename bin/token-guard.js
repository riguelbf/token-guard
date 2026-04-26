#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { loadDay, loadHistory, track, isBlocked, unlockToday, resetToday, calcCost } = require('../lib/tracker');
const { load: loadConfig, save: saveConfig }                               = require('../lib/config');
const { printStatus, printHistory }                                        = require('../lib/display');
const { estimateUsageFromExchange }                                        = require('../lib/estimate');
const installer                                                            = require('../lib/installer');

const [,, cmd, ...args] = process.argv;

function prompt(question) {
  const readline = require('readline').createInterface({
    input:  process.stdin,
    output: process.stdout,
    terminal: false,
  });
  return new Promise(resolve => {
    process.stdout.write(question);
    readline.once('line', answer => {
      readline.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function main() {
  switch (cmd) {

    // ── status ──────────────────────────────────────────────────────────
    case undefined:
    case 'status': {
      const usage  = loadDay();
      const config = loadConfig();
      const { getProxyStatus } = require('../lib/proxy');
      printStatus(usage, config, getProxyStatus());
      break;
    }

    // ── history ─────────────────────────────────────────────────────────
    case 'history': {
      const days = parseInt(args[0] || '7', 10);
      printHistory(loadHistory(days));
      break;
    }

    // ── limit ────────────────────────────────────────────────────────────
    case 'limit': {
      const value = parseFloat(args[0]);
      if (isNaN(value) || value <= 0) {
        console.error('Usage: token-guard limit <usd>   (e.g. token-guard limit 10)');
        process.exit(1);
      }
      const config = loadConfig();
      config.daily_limit_usd = value;
      saveConfig(config);
      console.log(`Daily limit set to $${value.toFixed(2)}`);
      break;
    }

    // ── unlock ───────────────────────────────────────────────────────────
    // Raises the daily limit so tracking stays accurate.
    // Usage: token-guard unlock        → raises by $5 (default)
    //        token-guard unlock 20     → raises by $20
    case 'unlock': {
      const raise  = parseFloat(args[0] || '5');
      const usage  = loadDay();
      const config = loadConfig();
      const newLimit = config.daily_limit_usd + raise;

      console.log(`\nToday's usage : $${usage.total_cost_usd.toFixed(4)}`);
      console.log(`Current limit : $${config.daily_limit_usd.toFixed(2)}`);
      console.log(`New limit     : $${newLimit.toFixed(2)}  (+$${raise})`);
      const answer = await prompt('Confirm? [y/N] ');
      if (answer === 'y' || answer === 'yes') {
        config.daily_limit_usd = newLimit;
        delete config.unlocked_until;
        saveConfig(config);
        console.log(`Limit raised to $${newLimit.toFixed(2)}. Tracking continues.\n`);
      } else {
        console.log('Cancelled.\n');
      }
      break;
    }

    // ── reset ────────────────────────────────────────────────────────────
    case 'reset': {
      const usage  = loadDay();
      console.log(`\nToday's usage: $${usage.total_cost_usd.toFixed(4)}`);
      const answer = await prompt('Reset today\'s usage counters? [y/N] ');
      if (answer === 'y' || answer === 'yes') {
        resetToday();
        console.log('Today\'s usage reset.\n');
      } else {
        console.log('Cancelled.\n');
      }
      break;
    }

    // ── track ─────────────────────────────────────────────────────────────
    // Used internally by hooks or for manual recording
    // token-guard track --provider=claude --model=... --input=N --output=N --cache-read=N
    case 'track': {
      const opts = parseFlags(args);
      const provider          = opts.provider || 'claude';
      const model             = opts.model    || '';
      const input_tokens      = parseInt(opts.input      || opts.i || '0', 10);
      const output_tokens     = parseInt(opts.output     || opts.o || '0', 10);
      const cache_read_tokens = parseInt(opts['cache-read'] || '0', 10);

      const { usage, callCost } = track({ provider, model, input_tokens, output_tokens, cache_read_tokens });
      // Silent output — hooks don't need stdout noise
      process.stdout.write(JSON.stringify({
        call_cost_usd: callCost,
        total_cost_usd: usage.total_cost_usd,
      }) + '\n');
      break;
    }

    // ── estimate ────────────────────────────────────────────────────────
    // Estimate usage locally without calling OpenAI.
    // token-guard estimate --model=gpt-4o --input-text="..." [--output-text="..."]
    case 'estimate': {
      const opts = parseFlags(args);
      const provider = opts.provider || 'openai';
      const model = opts.model || '';
      const inputText = readTextOption(opts, 'input-text') || readTextOption(opts, 'text') || '';
      const outputText = readTextOption(opts, 'output-text') || '';

      const usage = estimateUsageFromExchange(
        { input: inputText },
        { output_text: outputText }
      );

      if (!usage) {
        console.error('Usage: token-guard estimate --model=<model> --input-text="..." [--output-text="..."]');
        process.exit(1);
      }

      const cost = calcCost(provider, model, usage.input_tokens, usage.output_tokens, usage.cache_read_tokens);
      console.log('');
      console.log('  Estimated usage');
      console.log(`  Provider: ${provider}`);
      console.log(`  Model:    ${model || '(default)'}`);
      console.log(`  Input:    ${usage.input_tokens}`);
      console.log(`  Output:   ${usage.output_tokens}`);
      console.log(`  Cache:    ${usage.cache_read_tokens}`);
      console.log(`  Cost:     ~$${cost.toFixed(4)}`);
      console.log('');
      break;
    }

    // ── disable ──────────────────────────────────────────────────────────
    case 'disable': {
      const config = loadConfig();
      config.disabled = true;
      saveConfig(config);
      console.log('token-guard disabled. No limits enforced until you run: token-guard enable');
      break;
    }

    // ── enable ────────────────────────────────────────────────────────────
    case 'enable': {
      const config = loadConfig();
      delete config.disabled;
      saveConfig(config);
      const usage = loadDay();
      console.log(`token-guard enabled. Daily limit: $${config.daily_limit_usd.toFixed(2)} | Today's usage: $${usage.total_cost_usd.toFixed(4)}`);
      break;
    }

    // ── check ─────────────────────────────────────────────────────────────
    // Exit 1 if blocked, 0 if OK. For use in scripts.
    case 'check': {
      if (isBlocked()) {
        const usage  = loadDay();
        const config = loadConfig();
        console.error(`[token-guard] Blocked: $${usage.total_cost_usd.toFixed(4)} / $${config.daily_limit_usd}`);
        process.exit(1);
      }
      process.exit(0);
      break;
    }

    // ── install ───────────────────────────────────────────────────────────
    case 'install': {
      console.log('\nInstalling Claude Code hooks...');
      installer.install();
      console.log('\nDone. Hooks will activate in the next Claude Code session.\n');

      const config = loadConfig();
      console.log('Codex config setup:');
      console.log(`  Config: ~/.codex/config.toml`);
      console.log(`  Base URL: http://127.0.0.1:${config.proxy_port}/v1`);
      console.log('');
      break;
    }

    // ── uninstall ─────────────────────────────────────────────────────────
    case 'uninstall': {
      console.log('\nRemoving Claude Code hooks...');
      installer.uninstall();
      console.log('Done.\n');
      break;
    }

    // ── proxy ─────────────────────────────────────────────────────────────
    case 'proxy': {
      const subCmd = args[0] || 'start';
      const { getProxyStatus, stopProxy, createProxy } = require('../lib/proxy');

      if (subCmd === 'status') {
        const s = getProxyStatus();
        if (s.running) {
          const config = loadConfig();
          console.log(`Proxy running (pid ${s.pid}) on http://127.0.0.1:${config.proxy_port}/v1`);
        } else {
          console.log('Proxy is not running.');
        }
        break;
      }

      if (subCmd === 'stop') {
        if (stopProxy()) {
          console.log('Proxy stopped.');
        } else {
          console.log('Proxy was not running.');
        }
        break;
      }

      if (subCmd === 'start') {
        const s = getProxyStatus();
        if (s.running) {
          const config = loadConfig();
          console.log(`Proxy already running (pid ${s.pid}) on port ${config.proxy_port}`);
          break;
        }
        // Detach from parent process
        if (!process.env.TOKEN_GUARD_PROXY_CHILD) {
          const { spawn } = require('child_process');
          const child = spawn(process.execPath, [__filename, 'proxy', 'start'], {
            detached: true,
            stdio:    'ignore',
            env:      { ...process.env, TOKEN_GUARD_PROXY_CHILD: '1' },
          });
          child.unref();
          const config = loadConfig();
          setTimeout(() => {
            const st = getProxyStatus();
            if (st.running) {
              console.log(`Proxy started (pid ${st.pid})`);
              console.log(`Codex uses ~/.codex/config.toml with openai_base_url=http://127.0.0.1:${config.proxy_port}/v1`);
            } else {
              console.log('Failed to start proxy. Run in foreground: TOKEN_GUARD_PROXY_CHILD=1 token-guard proxy start');
            }
          }, 600);
        } else {
          // We are the child — run the server
          const config = loadConfig();
          createProxy(config.proxy_port);
        }
        break;
      }

      console.error(`Unknown proxy command: ${subCmd}`);
      console.error('Usage: token-guard proxy [start|stop|status]');
      process.exit(1);
      break;
    }

    // ── config ────────────────────────────────────────────────────────────
    case 'config': {
      const config = loadConfig();
      const { CONFIG_FILE } = require('../lib/config');
      console.log(`\nConfig file: ${CONFIG_FILE}`);
      console.log(JSON.stringify(config, null, 2));
      break;
    }

    // ── help ──────────────────────────────────────────────────────────────
    case 'help':
    case '--help':
    case '-h': {
      printHelp();
      break;
    }

    default:
      console.error(`Unknown command: ${cmd}`);
      printHelp();
      process.exit(1);
  }
}

function parseFlags(args) {
  const result = {};
  for (const arg of args) {
    const m = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) result[m[1]] = m[2] !== undefined ? m[2] : true;
  }
  return result;
}

function readTextOption(opts, key) {
  if (opts[key] !== undefined && opts[key] !== true) {
    return String(opts[key]);
  }

  const fileKey = key.endsWith('-text') ? key.replace('-text', '-file') : `${key}-file`;
  if (opts[fileKey] && opts[fileKey] !== true) {
    const filePath = String(opts[fileKey]);
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    return fs.readFileSync(filePath, 'utf8');
  }

  return '';
}

function printHelp() {
  console.log(`
  token-guard — daily token cost limiter for Claude Code and OpenAI/Codex

  Commands:
    status                  Show today's usage and cost (default)
    history [days]          Show usage history (default: 7 days)
    limit <usd>             Set daily cost limit in USD
    unlock [+usd]           Raise today's limit by $usd (default +$5)
    disable                 Turn off the guard entirely
    enable                  Re-enable the guard
    reset                   Reset today's usage counters
    install                 Install Claude Code hooks (auto-tracks Claude usage)
    uninstall               Remove Claude Code hooks
    proxy start             Start OpenAI proxy on http://127.0.0.1:<port>/v1
    proxy stop              Stop the proxy
    proxy status            Show proxy status
    config                  Show current configuration
    track --provider=...    Record usage manually (used by hooks)
    estimate                Estimate tokens locally from text or files
    check                   Exit 1 if blocked, 0 if OK (for scripts)

  Quick start:
    token-guard limit 10          # set $10/day limit
    token-guard install           # hook into Claude Code
    token-guard proxy start       # start OpenAI proxy
`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
