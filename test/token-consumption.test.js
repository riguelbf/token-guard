'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'token-guard-test-'));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  return home;
}

function resetModules() {
  for (const mod of ['../lib/tracker', '../lib/config', '../lib/proxy']) {
    delete require.cache[require.resolve(mod)];
  }
}

test('tracks token consumption and prints the updated status', () => {
  const home = makeHome();
  process.env.OPENAI_API_KEY = 'test-key';
  resetModules();

  const tracker = require('../lib/tracker');
  tracker.resetToday();

  const result = tracker.track({
    provider: 'openai',
    model: 'gpt-4o',
    input_tokens: 1000,
    output_tokens: 500,
  });

  assert.equal(result.usage.providers.openai.calls, 1);
  assert.equal(result.usage.providers.openai.input_tokens, 1000);
  assert.equal(result.usage.providers.openai.output_tokens, 500);
  assert.equal(result.usage.total_cost_usd.toFixed(4), '0.0075');

  const snapshot = tracker.loadDay();
  assert.equal(snapshot.updated_at.length > 0, true);
  assert.equal(snapshot.total_cost_usd.toFixed(4), '0.0075');

  const output = execFileSync(process.execPath, [path.join(__dirname, '..', 'bin', 'token-guard.js'), 'status'], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    encoding: 'utf8',
  });

  assert.match(output, /openai\s+1,000\s+500\s+0\s+\$0\.0075/);
  assert.match(output, /Calls:\s+1/);
  delete process.env.OPENAI_API_KEY;
});

test('tracks openai usage as estimated when no api token is active', () => {
  const home = makeHome();
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_KEY;
  delete process.env.OPENAI_ACCESS_TOKEN;
  resetModules();

  const tracker = require('../lib/tracker');
  tracker.resetToday();

  const result = tracker.track({
    provider: 'openai',
    model: 'gpt-4o',
    input_tokens: 200,
    output_tokens: 50,
  });

  assert.equal(result.estimated, true);
  assert.equal(result.usage.providers.openai?.calls || 0, 0);
  assert.equal(result.usage.estimated_providers.openai.calls, 1);
  assert.equal(result.usage.estimated_total_cost_usd > 0, true);

  const output = execFileSync(process.execPath, [path.join(__dirname, '..', 'bin', 'token-guard.js'), 'status'], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    encoding: 'utf8',
  });

  assert.match(output, /Estimated:/);
  assert.match(output, /ESTIMATED — no exact usage was available/);
});

test('proxy parser records nested OpenAI usage payloads', () => {
  makeHome();
  resetModules();

  const tracker = require('../lib/tracker');
  const calls = [];
  tracker.track = payload => {
    calls.push(payload);
    return { usage: {}, callCost: 0 };
  };

  const proxy = require('../lib/proxy');
  proxy.__test__.extractUsageFromPayload({
    type: 'response.done',
    response: {
      usage: {
        input_tokens: 12,
        output_tokens: 8,
        cache_read_input_tokens: 3,
        cache_creation_input_tokens: 1,
      },
    },
  }, 'gpt-4o', 'openai');

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    provider: 'openai',
    model: 'gpt-4o',
    input_tokens: 12,
    output_tokens: 8,
    cache_read_tokens: 3,
    cache_creation_tokens: 1,
  });
});

test('proxy records estimated OpenAI usage when exact usage is missing', () => {
  const home = makeHome();
  resetModules();

  const proxy = require('../lib/proxy');
  const hadUsage = proxy.__test__.recordEstimatedUsage({
    requestData: {
      model: 'gpt-4o',
      input: 'Write a short haiku about testing.',
    },
    responseData: {
      output_text: 'Testing is steady\nSmall checks keep bugs from growing\nConfidence blooms.',
    },
    model: 'gpt-4o',
    provider: 'openai',
  });

  assert.equal(hadUsage, true);

  const tracker = require('../lib/tracker');
  const snapshot = tracker.loadDay();

  assert.equal(snapshot.providers.openai?.calls || 0, 0);
  assert.equal(snapshot.estimated_providers.openai.calls, 1);
  assert.equal(snapshot.estimated_total_cost_usd > 0, true);

  const output = execFileSync(process.execPath, [path.join(__dirname, '..', 'bin', 'token-guard.js'), 'status'], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    encoding: 'utf8',
  });

  assert.match(output, /ESTIMATED — no exact usage was available/);
  assert.match(output, /Estimated:/);
});

test('estimate command prints a local usage estimate', () => {
  const home = makeHome();
  resetModules();

  const output = execFileSync(process.execPath, [
    path.join(__dirname, '..', 'bin', 'token-guard.js'),
    'estimate',
    '--model=gpt-4o',
    '--input-text=Write a short haiku about tests.',
    '--output-text=Tests keep bugs away.',
  ], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    encoding: 'utf8',
  });

  assert.match(output, /Estimated usage/);
  assert.match(output, /Provider:\s+openai/);
  assert.match(output, /Model:\s+gpt-4o/);
  assert.match(output, /Input:\s+\d+/);
  assert.match(output, /Output:\s+\d+/);
  assert.match(output, /Cost:\s+~\$\d+\.\d{4}/);
});

test('claude stop hook records nested usage payloads', () => {
  const home = makeHome();
  resetModules();

  const hookPath = path.join(__dirname, '..', 'lib', 'hooks', 'claude-stop.js');
  const payload = JSON.stringify({
    model: 'claude-sonnet-4',
    response: {
      usage: {
        input_tokens: 77,
        output_tokens: 33,
        cache_read_input_tokens: 11,
        cache_creation_input_tokens: 4,
      },
    },
  });

  execFileSync(process.execPath, [hookPath], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    input: payload,
    encoding: 'utf8',
  });

  const tracker = require('../lib/tracker');
  const snapshot = tracker.loadDay();

  assert.equal(snapshot.providers.claude.calls, 1);
  assert.equal(snapshot.providers.claude.input_tokens, 77);
  assert.equal(snapshot.providers.claude.output_tokens, 33);
  assert.equal(snapshot.providers.claude.cache_read_tokens, 11);
  assert.equal(snapshot.providers.claude.cache_creation_tokens, 4);
  assert.equal(snapshot.total_cost_usd > 0, true);
});

test('claude stop hook records usage from the transcript file', () => {
  const home = makeHome();
  resetModules();

  const transcriptPath = path.join(home, '.claude', 'projects', 'sample-session.jsonl');
  fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: 'hello' },
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'ok' }],
          usage: {
            input_tokens: 91,
            output_tokens: 29,
            cache_read_input_tokens: 13,
            cache_creation_input_tokens: 7,
          },
        },
      }),
      '',
    ].join('\n')
  );

  const hookPath = path.join(__dirname, '..', 'lib', 'hooks', 'claude-stop.js');
  execFileSync(process.execPath, [hookPath], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    input: JSON.stringify({
      session_id: 'session-123',
      transcript_path: transcriptPath,
      hook_event_name: 'Stop',
      stop_hook_active: false,
      cwd: home,
    }),
    encoding: 'utf8',
  });

  const tracker = require('../lib/tracker');
  const snapshot = tracker.loadDay();

  assert.equal(snapshot.providers.claude.calls, 1);
  assert.equal(snapshot.providers.claude.input_tokens, 91);
  assert.equal(snapshot.providers.claude.output_tokens, 29);
  assert.equal(snapshot.providers.claude.cache_read_tokens, 13);
  assert.equal(snapshot.providers.claude.cache_creation_tokens, 7);
  assert.equal(snapshot.total_cost_usd > 0, true);
});
