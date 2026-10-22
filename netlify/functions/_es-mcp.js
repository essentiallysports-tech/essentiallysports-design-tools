// Minimal ES MCP client shared by new functions (es-generate). Same token and
// session handling as es-image-search.js, which keeps its own copy untouched.
const ES_MCP_ENDPOINT = process.env.ES_MCP_ENDPOINT || 'https://mcp.essentiallysports.com/mcp';
const ES_MCP_ISSUER = process.env.ES_MCP_ISSUER || 'https://mcp.essentiallysports.com';
const ES_MCP_ACCESS_TOKEN = process.env.ES_MCP_ACCESS_TOKEN || '';
const ES_MCP_REFRESH_TOKEN = process.env.ES_MCP_REFRESH_TOKEN || '';
const ES_MCP_CLIENT_ID = process.env.ES_MCP_CLIENT_ID || '';
const ES_MCP_TOKEN_ENDPOINT = process.env.ES_MCP_TOKEN_ENDPOINT || '';
const ES_MCP_PROTOCOL_VERSION = process.env.ES_MCP_PROTOCOL_VERSION || '2025-06-18';

let cachedAccessToken = '';

function isMcpConfigured() {
  return Boolean(ES_MCP_ACCESS_TOKEN || (ES_MCP_CLIENT_ID && ES_MCP_REFRESH_TOKEN));
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

async function getTokenEndpoint() {
  if (ES_MCP_TOKEN_ENDPOINT) return ES_MCP_TOKEN_ENDPOINT;
  const response = await fetch(`${ES_MCP_ISSUER}/.well-known/oauth-authorization-server`);
  if (!response.ok) throw new Error(`Could not read ES MCP OAuth metadata: ${response.status}`);
  const metadata = await response.json();
  if (!metadata.token_endpoint) throw new Error('ES MCP OAuth metadata did not include a token endpoint.');
  return metadata.token_endpoint;
}

async function getAccessToken() {
  if (cachedAccessToken) return cachedAccessToken;
  if (ES_MCP_ACCESS_TOKEN) {
    cachedAccessToken = ES_MCP_ACCESS_TOKEN;
    return cachedAccessToken;
  }
  if (!ES_MCP_REFRESH_TOKEN || !ES_MCP_CLIENT_ID) return '';
  const response = await fetch(await getTokenEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
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
  cachedAccessToken = token.access_token;
  return cachedAccessToken;
}

async function post(body, sessionId, { expectReply = true, timeoutMs = 15000 } = {}) {
  const accessToken = await getAccessToken();
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
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!expectReply) return null;
  const text = await response.text();
  const data = text ? parseMcpPayload(text, response.headers.get('content-type') || '') : null;
  if (!response.ok || data?.error) {
    throw new Error(data?.error?.message || `ES MCP request failed: ${response.status}`);
  }
  return { data, sessionId: response.headers.get('mcp-session-id') || sessionId || '' };
}

// One session per function invocation: initialize once, then reuse.
function createSession() {
  let sessionId = '';
  let ready = null;
  const start = () => {
    if (!ready) {
      ready = (async () => {
        const initialized = await post({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'initialize',
          params: { protocolVersion: ES_MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'frameup-generate', version: '1.0.0' } },
        });
        sessionId = initialized.sessionId;
        await post({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, sessionId, { expectReply: false }).catch(() => {});
      })();
    }
    return ready;
  };
  const request = async (method, params, options) => {
    await start();
    const reply = await post({ jsonrpc: '2.0', id: Date.now(), method, params }, sessionId, options);
    return reply.data?.result;
  };
  return {
    listTools: async () => {
      const result = await request('tools/list', {});
      return Array.isArray(result?.tools) ? result.tools : (Array.isArray(result) ? result : []);
    },
    callTool: (name, args, options) => request('tools/call', { name, arguments: args }, options),
  };
}

module.exports = { isMcpConfigured, createSession };
