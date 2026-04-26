'use strict';

/**
 * OpenAI-compatible HTTP proxy.
 *
 * Usage: point OPENAI_BASE_URL=http://localhost:4141/v1
 *
 * - Blocks requests when daily limit is reached
 * - Tracks token usage from responses (streaming and non-streaming)
 * - Forwards everything else to https://api.openai.com
 */

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const { track, isBlocked, loadDay } = require('./tracker');
const { load: loadConfig }          = require('./config');

const OPENAI_HOST = 'api.openai.com';
const PID_FILE    = path.join(require('os').homedir(), '.token-guard', 'proxy.pid');

function blockedResponse(res) {
  const usage  = loadDay();
  const config = loadConfig();
  const body   = JSON.stringify({
    error: {
      type:        'token_limit_exceeded',
      code:        'daily_limit_reached',
      message:     `Daily cost limit reached. Spent: $${usage.total_cost_usd.toFixed(4)} of $${config.daily_limit_usd.toFixed(2)}. Run 'token-guard unlock' to continue.`,
      current_usd: usage.total_cost_usd,
      limit_usd:   config.daily_limit_usd,
    },
  });
  res.writeHead(429, {
    'Content-Type':   'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;

  const inputTokens =
    usage.input_tokens ??
    usage.prompt_tokens ??
    0;

  const outputTokens =
    usage.output_tokens ??
    usage.completion_tokens ??
    0;

  const cacheReadTokens =
    usage.input_tokens_details?.cached_tokens ??
    usage.prompt_tokens_details?.cached_tokens ??
    0;

  const cacheCreationTokens =
    usage.cache_creation_input_tokens ??
    usage.output_tokens_details?.cached_tokens ??
    0;

  return {
    input_tokens: Number(inputTokens) || 0,
    output_tokens: Number(outputTokens) || 0,
    cache_read_tokens: Number(cacheReadTokens) || 0,
    cache_creation_tokens: Number(cacheCreationTokens) || 0,
  };
}

function recordUsage({ usage, model, provider }) {
  const normalized = normalizeUsage(usage);
  if (!normalized) return;

  if (
    normalized.input_tokens === 0 &&
    normalized.output_tokens === 0 &&
    normalized.cache_read_tokens === 0 &&
    normalized.cache_creation_tokens === 0
  ) {
    return;
  }

  track({
    provider,
    model,
    ...normalized,
  });
}

function extractUsageFromPayload(payload, model, provider) {
  if (!payload || typeof payload !== 'object') return;
  if (payload.usage) {
    recordUsage({ usage: payload.usage, model, provider });
    return;
  }
  if (payload.response?.usage) {
    recordUsage({ usage: payload.response.usage, model, provider });
  }
}

function extractUsageFromChunks(buffer, model, provider) {
  const lines = buffer.split('\n');
  for (const line of lines) {
    if (!line.startsWith('data: ') || line.includes('[DONE]')) continue;
    try {
      const data = JSON.parse(line.slice(6));
      extractUsageFromPayload(data, model, provider);
      if (data.usage || data.response?.usage) return;
    } catch { /* ignore malformed chunks */ }
  }
}

function createProxy(port) {
  const server = http.createServer((req, res) => {
    // Only proxy chat/completions and embeddings endpoints
    const isChatCompletions = req.url.includes('/chat/completions');
    const isCompletions     = req.url.includes('/completions');
    const isResponses       = req.url.includes('/responses');
    const isEmbeddings      = req.url.includes('/embeddings');
    const shouldTrackUsage   = isChatCompletions || isCompletions || isResponses || isEmbeddings;

    if (isBlocked() && shouldTrackUsage) {
      blockedResponse(res);
      return;
    }

    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
      const bodyBuf = Buffer.concat(body);
      let requestData = {};
      try { requestData = JSON.parse(bodyBuf.toString()); } catch { /* not JSON */ }

      const model    = requestData.model || 'unknown';
      const isStream = requestData.stream === true;
      const provider = 'openai';

      // Strip hop-by-hop headers and fix host
      const headers = { ...req.headers };
      delete headers['transfer-encoding'];
      delete headers['connection'];
      headers['host']           = OPENAI_HOST;
      headers['content-length'] = bodyBuf.length;
      headers['accept-encoding'] = 'identity';

      const options = {
        hostname: OPENAI_HOST,
        port:     443,
        path:     req.url,
        method:   req.method,
        headers,
      };

      const proxyReq = https.request(options, (proxyRes) => {
        const resHeaders = { ...proxyRes.headers };
        delete resHeaders['transfer-encoding'];
        res.writeHead(proxyRes.statusCode, resHeaders);

        if (isStream) {
          let sseBuffer = '';
          proxyRes.on('data', chunk => {
            res.write(chunk);
            sseBuffer += chunk.toString();
          });
          proxyRes.on('end', () => {
            res.end();
            // Extract usage from buffered SSE (appears in last chunk with stream_options.include_usage)
            extractUsageFromChunks(sseBuffer, model, provider);
          });
        } else {
          let responseBody = Buffer.alloc(0);
          proxyRes.on('data', chunk => {
            responseBody = Buffer.concat([responseBody, chunk]);
            res.write(chunk);
          });
          proxyRes.on('end', () => {
            res.end();
            if (shouldTrackUsage) {
              try {
                const data = JSON.parse(responseBody.toString());
                extractUsageFromPayload(data, model, provider);
              } catch { /* non-JSON response */ }
            }
          });
        }
      });

      proxyReq.on('error', err => {
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: `Proxy error: ${err.message}` } }));
        }
      });

      proxyReq.write(bodyBuf);
      proxyReq.end();
    });
  });

  server.listen(port, '127.0.0.1', () => {
    fs.writeFileSync(PID_FILE, String(process.pid));
    console.log(`token-guard proxy running on http://127.0.0.1:${port}`);
    console.log(`Set: OPENAI_BASE_URL=http://127.0.0.1:${port}/v1`);
  });

  process.on('SIGTERM', () => { server.close(); tryRemovePid(); process.exit(0); });
  process.on('SIGINT',  () => { server.close(); tryRemovePid(); process.exit(0); });

  return server;
}

function tryRemovePid() {
  try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
}

function getProxyStatus() {
  if (!fs.existsSync(PID_FILE)) return { running: false };
  const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
  try {
    process.kill(pid, 0); // signal 0 = check existence
    return { running: true, pid };
  } catch {
    tryRemovePid();
    return { running: false };
  }
}

function stopProxy() {
  const status = getProxyStatus();
  if (!status.running) return false;
  try {
    process.kill(status.pid, 'SIGTERM');
    tryRemovePid();
    return true;
  } catch {
    return false;
  }
}

module.exports = { createProxy, getProxyStatus, stopProxy, PID_FILE };
