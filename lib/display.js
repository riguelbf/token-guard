'use strict';

// ANSI colors (no external deps)
const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  white:  '\x1b[37m',
};

function fmt(text, ...codes) {
  return codes.map(code => c[code] || '').join('') + text + c.reset;
}

function fmtNum(n) {
  return n.toLocaleString('en-US');
}

function fmtUsd(n) {
  return '$' + n.toFixed(4);
}

function bar(ratio, width = 20) {
  const filled = Math.min(Math.round(ratio * width), width);
  const empty  = width - filled;
  const color  = ratio >= 1 ? 'red' : ratio >= 0.8 ? 'yellow' : 'green';
  return fmt('█'.repeat(filled), color) + fmt('░'.repeat(empty), 'dim');
}

function printStatus(usage, config) {
  const limit   = config.daily_limit_usd;
  const spent   = usage.total_cost_usd;
  const remain  = Math.max(limit - spent, 0);
  const ratio   = Math.min(spent / limit, 1);
  const pct     = (ratio * 100).toFixed(1);
  const blocked = require('./tracker').isBlocked();
  const unlocked = config.unlocked_until === require('./tracker').today();

  console.log('');
  console.log(fmt('  Token Guard', 'bold', 'cyan') + fmt(`  —  ${usage.date}`, 'dim'));
  console.log(fmt('  ' + '─'.repeat(60), 'dim'));

  // Provider rows
  const provHeaders = ['Provider', 'Input tkns', 'Output tkns', 'Cache tkns', 'Cost'];
  const colW = [12, 12, 12, 12, 12];

  function row(cols, style) {
    const cells = cols.map((v, i) => String(v).padEnd(colW[i]));
    const line = '  ' + cells.join('  ');
    return style ? fmt(line, style) : line;
  }

  console.log(row(provHeaders, 'bold'));
  console.log(fmt('  ' + '─'.repeat(60), 'dim'));

  if (Object.keys(usage.providers).length === 0) {
    console.log(fmt('  No usage recorded today.', 'dim'));
  } else {
    for (const [name, p] of Object.entries(usage.providers)) {
      console.log(row([
        name,
        fmtNum(p.input_tokens),
        fmtNum(p.output_tokens),
        fmtNum(p.cache_read_tokens || 0),
        fmtUsd(p.cost_usd || 0),
      ]));
    }
  }

  console.log(fmt('  ' + '─'.repeat(60), 'dim'));

  // Progress bar
  const barStr = bar(ratio);
  const spentColor = ratio >= 1 ? 'red' : ratio >= 0.8 ? 'yellow' : 'green';
  console.log(`  ${barStr}  ${fmt(fmtUsd(spent), spentColor, 'bold')} / ${fmtUsd(limit)}  (${pct}%)`);
  console.log(`  Remaining: ${fmt(fmtUsd(remain), 'cyan')}  |  Calls: ${Object.values(usage.providers).reduce((s, p) => s + p.calls, 0)}`);

  // Status
  let statusMsg;
  if (blocked) {
    statusMsg = fmt('  BLOCKED — daily limit reached. Run: token-guard unlock', 'red', 'bold');
  } else if (unlocked) {
    statusMsg = fmt('  UNLOCKED — limit bypassed for today', 'yellow', 'bold');
  } else if (ratio >= 0.8) {
    statusMsg = fmt('  WARNING — approaching daily limit', 'yellow');
  } else {
    statusMsg = fmt('  OK', 'green');
  }
  console.log('');
  console.log(statusMsg);
  console.log('');
}

function printHistory(days) {
  console.log('');
  console.log(fmt('  Usage History', 'bold', 'cyan'));
  console.log(fmt('  ' + '─'.repeat(40), 'dim'));
  const headers = ['Date', 'Claude', 'OpenAI', 'Total Cost'];
  console.log(fmt('  ' + headers.map((h, i) => h.padEnd([12,10,10,12][i])).join('  '), 'bold'));
  console.log(fmt('  ' + '─'.repeat(40), 'dim'));

  for (const day of days) {
    const claudeCost = (day.providers.claude?.cost_usd || 0);
    const openaiCost = (day.providers.openai?.cost_usd || 0);
    const total      = day.total_cost_usd || 0;
    const cols = [
      day.date,
      fmtUsd(claudeCost),
      fmtUsd(openaiCost),
      fmtUsd(total),
    ];
    console.log('  ' + cols.map((v, i) => String(v).padEnd([12,10,10,12][i])).join('  '));
  }
  console.log('');
}

module.exports = { printStatus, printHistory };
