const { verifyEsUser } = require('./_supabase-auth.js');

const ES_MCP_ENDPOINT = process.env.ES_MCP_ENDPOINT || 'https://mcp.essentiallysports.com/mcp';
const ES_MCP_ISSUER = process.env.ES_MCP_ISSUER || 'https://mcp.essentiallysports.com';
const ES_MCP_ACCESS_TOKEN = process.env.ES_MCP_ACCESS_TOKEN || '';
const ES_MCP_REFRESH_TOKEN = process.env.ES_MCP_REFRESH_TOKEN || '';
const ES_MCP_CLIENT_ID = process.env.ES_MCP_CLIENT_ID || '';
const ES_MCP_TOKEN_ENDPOINT = process.env.ES_MCP_TOKEN_ENDPOINT || '';
const ES_MCP_PROTOCOL_VERSION = process.env.ES_MCP_PROTOCOL_VERSION || '2025-06-18';
const ES_MCP_INTELLIGENCE_TOOL = process.env.ES_MCP_INTELLIGENCE_TOOL || '';
const ES_MCP_TRANSCRIBE_TOOL = process.env.ES_MCP_TRANSCRIBE_TOOL || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const TRANSCRIPTION_MODEL = process.env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-4o-transcribe';

let cachedMcpAccessToken = '';

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
    body: JSON.stringify(body),
  };
}

function safeError(error) {
  return String(error?.message || error || 'Unknown error')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .slice(0, 260);
}

function parseJsonBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  return JSON.parse(raw);
}

function parseMcpPayload(text, contentType) {
  if (!contentType.includes('text/event-stream')) return JSON.parse(text);
  const payloads = text
    .split(/\r?\n/)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trim())
    .filter(Boolean)
    .map(line => JSON.parse(line));
  return payloads[payloads.length - 1] || null;
}

async function getMcpTokenEndpoint() {
  if (ES_MCP_TOKEN_ENDPOINT) return ES_MCP_TOKEN_ENDPOINT;
  const response = await fetch(`${ES_MCP_ISSUER}/.well-known/oauth-authorization-server`);
  if (!response.ok) throw new Error(`Could not read ES MCP OAuth metadata: ${response.status}`);
  const metadata = await response.json();
  if (!metadata.token_endpoint) throw new Error('ES MCP OAuth metadata did not include a token endpoint.');
  return metadata.token_endpoint;
}

async function getMcpAccessToken() {
  if (cachedMcpAccessToken) return cachedMcpAccessToken;
  if (ES_MCP_ACCESS_TOKEN) {
    cachedMcpAccessToken = ES_MCP_ACCESS_TOKEN;
    return cachedMcpAccessToken;
  }
  if (!ES_MCP_REFRESH_TOKEN || !ES_MCP_CLIENT_ID) return '';

  const response = await fetch(await getMcpTokenEndpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: ES_MCP_REFRESH_TOKEN,
      client_id: ES_MCP_CLIENT_ID,
    }),
  });
  const token = await response.json().catch(() => null);
  if (!response.ok || !token?.access_token) {
    throw new Error(token?.error_description || token?.error || `ES MCP token refresh failed: ${response.status}`);
  }
  cachedMcpAccessToken = token.access_token;
  return cachedMcpAccessToken;
}

async function mcpRequest(method, params, sessionId) {
  const accessToken = await getMcpAccessToken();
  if (!accessToken) throw new Error('ES MCP access token is not configured.');
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': ES_MCP_PROTOCOL_VERSION,
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;

  const response = await fetch(ES_MCP_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params,
    }),
  });
  const text = await response.text();
  const data = text ? parseMcpPayload(text, response.headers.get('content-type') || '') : null;
  if (!response.ok || data?.error) {
    throw new Error(data?.error?.message || `ES MCP request failed: ${response.status}`);
  }
  return {
    data,
    sessionId: response.headers.get('mcp-session-id') || sessionId || '',
  };
}

async function mcpNotify(method, params, sessionId) {
  const accessToken = await getMcpAccessToken();
  if (!accessToken) return;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': ES_MCP_PROTOCOL_VERSION,
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  await fetch(ES_MCP_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', method, params }),
  }).catch(() => null);
}

async function initializeMcpSession() {
  const initialized = await mcpRequest('initialize', {
    protocolVersion: ES_MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: {
      name: 'es-reels-studio',
      version: '1.0.0',
    },
  });
  await mcpNotify('notifications/initialized', {}, initialized.sessionId);
  return initialized.sessionId;
}

async function listMcpTools(sessionId) {
  const listed = await mcpRequest('tools/list', {}, sessionId);
  return listed.data?.result?.tools || listed.data?.result || [];
}

async function findIntelligenceTool(sessionId) {
  if (ES_MCP_INTELLIGENCE_TOOL) return ES_MCP_INTELLIGENCE_TOOL;
  const tools = await listMcpTools(sessionId);
  const names = Array.isArray(tools) ? tools.map(tool => tool?.name || tool).filter(Boolean) : [];
  return names.find(name => /video.*intelligence|caption.*style|style.*caption|prompt.*style/i.test(name)) || '';
}

async function findTranscriptionTool(sessionId) {
  if (ES_MCP_TRANSCRIBE_TOOL) return ES_MCP_TRANSCRIBE_TOOL;
  const tools = await listMcpTools(sessionId);
  const names = Array.isArray(tools) ? tools.map(tool => tool?.name || tool).filter(Boolean) : [];
  return names.find(name => /transcrib|speech.*text|audio.*text|video.*caption|caption.*generat/i.test(name)) || '';
}

function normalizeMcpPatch(result) {
  const content = result?.content || result?.structuredContent || result?.data || result;
  if (Array.isArray(content)) {
    const textBlock = content.find(item => item?.type === 'text' && item.text);
    if (textBlock) return normalizeMcpPatch(textBlock.text);
  }
  if (typeof content === 'string') {
    const cleaned = content.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try {
      return JSON.parse(cleaned);
    } catch (error) {
      return { summary: cleaned.slice(0, 180), patch: {} };
    }
  }
  return content && typeof content === 'object' ? content : { patch: {} };
}

function normalizeSegmentsFromProvider(segments) {
  return segments.map(segment => ({
    start: Number(segment.start ?? segment.start_time ?? segment.startTime) || 0,
    end: Number(segment.end ?? segment.end_time ?? segment.endTime) || 0,
    text: String(segment.text ?? segment.caption ?? segment.content ?? '').trim(),
    confidence: segment.confidence == null ? null : Number(segment.confidence),
    words: Array.isArray(segment.words) ? segment.words : [],
  })).filter(segment => segment.text);
}

function normalizeMcpTranscription(result) {
  const content = result?.content || result?.structuredContent || result?.data || result;
  if (Array.isArray(content)) {
    const textBlock = content.find(item => item?.type === 'text' && item.text);
    if (textBlock) return normalizeMcpTranscription(textBlock.text);
    const nested = content.find(item => item && typeof item === 'object');
    if (nested) return normalizeMcpTranscription(nested);
  }
  if (typeof content === 'string') {
    const cleaned = content.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try {
      return normalizeMcpTranscription(JSON.parse(cleaned));
    } catch (error) {
      return {
        provider: 'ES MCP',
        text: cleaned,
        segments: chunkPlainTranscript(cleaned),
      };
    }
  }

  const value = content && typeof content === 'object' ? content : {};
  const segments = value.segments || value.captions || value.transcript?.segments || value.result?.segments || [];
  const text = value.text || value.transcript || value.result?.text || '';
  return {
    provider: value.provider || 'ES MCP',
    language: value.language || '',
    text: typeof text === 'string' ? text : '',
    segments: normalizeSegmentsFromProvider(Array.isArray(segments) ? segments : []),
  };
}

async function callMcpIntelligence(payload) {
  if (!ES_MCP_ACCESS_TOKEN && (!ES_MCP_REFRESH_TOKEN || !ES_MCP_CLIENT_ID)) return null;
  const sessionId = await initializeMcpSession();
  const toolName = await findIntelligenceTool(sessionId);
  if (!toolName) return null;
  const called = await mcpRequest('tools/call', {
    name: toolName,
    arguments: {
      task: 'reels_caption_style_patch',
      prompt: payload.prompt,
      target: payload.target,
      brandKit: payload.brandKit || [],
      outputSchema: {
        summary: 'short human-readable result',
        patch: {
          text: 'optional rewritten caption text',
          position: 'optional lower|center|upper',
          style: 'optional caption style object',
          styleName: 'optional visible style name',
        },
      },
    },
  }, sessionId);
  return normalizeMcpPatch(called.data?.result);
}

async function transcribeWithMcp(payload) {
  if (!ES_MCP_ACCESS_TOKEN && (!ES_MCP_REFRESH_TOKEN || !ES_MCP_CLIENT_ID)) return null;
  if (!payload.data) throw new Error('Missing video/audio data.');

  const sessionId = await initializeMcpSession();
  const toolName = await findTranscriptionTool(sessionId);
  if (!toolName) {
    return {
      provider: 'ES MCP',
      text: '',
      segments: [],
      error: 'ES MCP is configured, but no speech transcription tool was discovered. Set ES_MCP_TRANSCRIBE_TOOL to the correct MCP tool name.',
    };
  }

  const called = await mcpRequest('tools/call', {
    name: toolName,
    arguments: {
      task: 'transcribe_video_for_reels_captions',
      file_name: payload.fileName || 'reels-upload.mp4',
      fileName: payload.fileName || 'reels-upload.mp4',
      mime_type: payload.mimeType || 'application/octet-stream',
      mimeType: payload.mimeType || 'application/octet-stream',
      data: payload.data,
      base64: payload.data,
      output: {
        format: 'segments',
        timestamps: 'segment',
        fields: ['start', 'end', 'text', 'confidence', 'words'],
      },
    },
  }, sessionId);

  return normalizeMcpTranscription(called.data?.result);
}

async function transcribeWithOpenAI(payload) {
  if (!OPENAI_API_KEY) {
    return json(501, {
      error: 'Speech recognition is wired, but OPENAI_API_KEY is not configured for this environment.',
      provider: 'not-configured',
    });
  }
  if (!payload.data) return json(400, { error: 'Missing video/audio data.' });
  const buffer = Buffer.from(payload.data, 'base64');
  const blob = new Blob([buffer], { type: payload.mimeType || 'application/octet-stream' });
  const form = new FormData();
  form.append('file', blob, payload.fileName || 'reels-upload.mp4');
  form.append('model', TRANSCRIPTION_MODEL);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: form,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    return json(response.status, {
      error: data?.error?.message || `Speech recognition failed: ${response.status}`,
      provider: 'openai',
    });
  }

  const segments = Array.isArray(data?.segments)
    ? data.segments.map(segment => ({
      start: Number(segment.start) || 0,
      end: Number(segment.end) || 0,
      text: String(segment.text || '').trim(),
      confidence: segment.avg_logprob == null ? null : Math.max(0, Math.min(1, 1 + Number(segment.avg_logprob))),
    }))
    : chunkPlainTranscript(data?.text || '');

  return json(200, {
    provider: `OpenAI ${TRANSCRIPTION_MODEL}`,
    language: data?.language || '',
    text: data?.text || segments.map(segment => segment.text).join(' '),
    segments,
  });
}

function chunkPlainTranscript(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const segments = [];
  for (let i = 0; i < words.length; i += 8) {
    const chunk = words.slice(i, i + 8);
    const start = (i / 8) * 2.8;
    segments.push({
      start,
      end: start + 2.8,
      text: chunk.join(' '),
      confidence: null,
    });
  }
  return segments;
}

function localStyleFallback(payload) {
  const prompt = String(payload.prompt || '').toLowerCase();
  const brand = Array.isArray(payload.brandKit) ? payload.brandKit[0] : null;
  const patch = {};
  const style = {};

  if (brand?.primary) {
    style.background = brand.primary.background;
    style.foreground = brand.primary.foreground;
    style.accent = brand.primary.mist || brand.primary.background;
    patch.styleName = `${brand.team || brand.variation || 'Brand'} caption`;
  }
  if (prompt.includes('top') || prompt.includes('upper')) patch.position = 'upper';
  if (prompt.includes('center') || prompt.includes('middle')) patch.position = 'center';
  if (prompt.includes('bottom') || prompt.includes('lower')) patch.position = 'lower';
  if (prompt.includes('punchy') || prompt.includes('shorter')) {
    const text = String(payload.target?.text || '').replace(/\s+/g, ' ').trim();
    patch.text = text.split(' ').slice(0, 9).join(' ');
  }
  if (prompt.includes('yellow') || prompt.includes('highlight')) style.accent = '#ffd447';
  if (Object.keys(style).length) patch.style = style;

  return {
    provider: 'Local rules fallback',
    summary: 'Applied local caption rules. Configure an ES MCP intelligence tool for the full prompt pass.',
    patch,
  };
}

async function styleWithIntelligence(payload) {
  const mcpResult = await callMcpIntelligence(payload).catch(error => ({
    provider: 'ES MCP error',
    summary: safeError(error),
    patch: {},
  }));

  if (mcpResult && (mcpResult.patch || mcpResult.summary)) {
    return json(200, {
      provider: mcpResult.provider || 'ES MCP',
      summary: mcpResult.summary || 'Applied ES MCP intelligence patch.',
      patch: mcpResult.patch || {},
    });
  }

  return json(200, localStyleFallback(payload));
}

async function transcribeVideo(payload) {
  const mcpResult = await transcribeWithMcp(payload).catch(error => ({
    provider: 'ES MCP error',
    text: '',
    segments: [],
    error: safeError(error),
  }));

  if (mcpResult?.segments?.length) {
    return json(200, {
      provider: mcpResult.provider || 'ES MCP',
      language: mcpResult.language || '',
      text: mcpResult.text || mcpResult.segments.map(segment => segment.text).join(' '),
      segments: mcpResult.segments,
    });
  }

  if (OPENAI_API_KEY) return transcribeWithOpenAI(payload);

  return json(501, {
    error: mcpResult?.error || 'ES MCP transcription is not configured for this environment. Set ES_MCP_TRANSCRIBE_TOOL to the ES MCP speech-recognition tool name.',
    provider: mcpResult?.provider || 'not-configured',
  });
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });

  try {
    const auth = await verifyEsUser(event);
    if (!auth.ok) return json(auth.statusCode, { error: auth.error });

    const payload = parseJsonBody(event);
    if (payload.action === 'transcribe') return transcribeVideo(payload);
    if (payload.action === 'style') return styleWithIntelligence(payload);
    return json(400, { error: 'Unknown video intelligence action.' });
  } catch (error) {
    return json(500, { error: safeError(error) });
  }
};
