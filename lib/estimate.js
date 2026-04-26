'use strict';

function estimateTextTokens(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return 0;
  return Math.max(1, Math.ceil(normalized.length / 4));
}

function collectLikelyText(value, depth = 0, seen = new Set(), keyHint = '') {
  if (value == null || depth > 8) return '';
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return '';
  if (seen.has(value)) return '';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map(item => collectLikelyText(item, depth + 1, seen)).filter(Boolean).join(' ');
  }

  if (typeof value.text === 'string') return value.text;
  if (typeof value.input_text === 'string') return value.input_text;
  if (typeof value.output_text === 'string') return value.output_text;
  if (typeof value.delta === 'string') return value.delta;
  if (typeof value.content === 'string') return value.content;

  const skipKeys = new Set(['model', 'id', 'role', 'type', 'name', 'path', 'tool_call_id', 'status', 'event', 'created_at', 'timestamp', 'request_id', 'requestId', 'session_id', 'sessionId', 'cwd', 'hook_event_name', 'stop_hook_active']);
  const preferredKeys = ['input', 'instructions', 'prompt', 'messages', 'content', 'text', 'output', 'output_text', 'response', 'delta'];

  let out = '';
  for (const key of preferredKeys) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      out += ' ' + collectLikelyText(value[key], depth + 1, seen, key);
    }
  }

  for (const [key, child] of Object.entries(value)) {
    if (skipKeys.has(key) || preferredKeys.includes(key)) continue;
    if (typeof child === 'string') continue;
    if (keyHint === 'messages' && key === 'name') continue;
    out += ' ' + collectLikelyText(child, depth + 1, seen, key);
  }

  return out.trim();
}

function estimateUsageFromExchange(requestData = {}, responseData = {}, sseBuffer = '') {
  const inputText = collectLikelyText({
    input: requestData.input,
    instructions: requestData.instructions,
    prompt: requestData.prompt,
    messages: requestData.messages,
    content: requestData.content,
  });

  let outputText = '';
  if (sseBuffer) {
    const lines = String(sseBuffer).split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ') || trimmed.includes('[DONE]')) continue;
      try {
        const data = JSON.parse(trimmed.slice(6));
        outputText += ' ' + collectLikelyText(data);
      } catch { /* ignore malformed chunks */ }
    }
  } else {
    outputText = collectLikelyText(responseData);
  }

  const input_tokens = estimateTextTokens(inputText);
  const output_tokens = estimateTextTokens(outputText);
  if (input_tokens === 0 && output_tokens === 0) return null;

  return {
    input_tokens,
    output_tokens,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
  };
}

module.exports = {
  estimateTextTokens,
  collectLikelyText,
  estimateUsageFromExchange,
};
