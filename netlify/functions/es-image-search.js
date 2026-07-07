const ES_MEDIA_ENDPOINT = 'https://www.essentiallysports.com/wp-json/wp/v2/media';
const { verifyEsUser } = require('./_supabase-auth.js');
const ES_MCP_ENDPOINT = process.env.ES_MCP_ENDPOINT || 'https://mcp.essentiallysports.com/mcp';
const ES_MCP_ISSUER = process.env.ES_MCP_ISSUER || 'https://mcp.essentiallysports.com';
const ES_MCP_ACCESS_TOKEN = process.env.ES_MCP_ACCESS_TOKEN || '';
const ES_MCP_REFRESH_TOKEN = process.env.ES_MCP_REFRESH_TOKEN || '';
const ES_MCP_CLIENT_ID = process.env.ES_MCP_CLIENT_ID || '';
const ES_MCP_TOKEN_ENDPOINT = process.env.ES_MCP_TOKEN_ENDPOINT || '';
const ES_MCP_SEARCH_TOOL = process.env.ES_MCP_SEARCH_TOOL || 'search_images';
const ES_MCP_PROTOCOL_VERSION = process.env.ES_MCP_PROTOCOL_VERSION || '2025-06-18';
const ES_IMAGE_BUCKET = process.env.ES_IMAGE_BUCKET || 'essentiallysports-images-v2prod';
let cachedMcpAccessToken = '';
const ALLOWED_IMAGE_HOSTS = new Set([
  'image-cdn.essentiallysports.com',
  'www.essentiallysports.com',
  'www.staging.essentiallysports.com',
]);

function getMcpConfigState() {
  const hasAccessToken = Boolean(ES_MCP_ACCESS_TOKEN);
  const hasRefreshTokenMode = Boolean(ES_MCP_CLIENT_ID && ES_MCP_REFRESH_TOKEN);
  return {
    mcpConfigured: hasAccessToken || hasRefreshTokenMode,
    tokenMode: hasAccessToken ? 'access-token' : (hasRefreshTokenMode ? 'refresh-token' : 'none'),
    endpoint: ES_MCP_ENDPOINT,
    issuer: ES_MCP_ISSUER,
    searchTool: ES_MCP_SEARCH_TOOL,
    protocolVersion: ES_MCP_PROTOCOL_VERSION,
    imageBucket: ES_IMAGE_BUCKET,
    fallback: 'wordpress-media',
  };
}

function safeDiagnosticError(error) {
  return String(error?.message || error || 'Unknown MCP probe error')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .slice(0, 220);
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      Vary: 'Origin',
    },
    body: JSON.stringify(body),
  };
}

function cleanText(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function preferredSource(media) {
  const sizes = media?.media_details?.sizes || {};
  return sizes['1536x1536']?.source_url
    || sizes.large?.source_url
    || sizes.full?.source_url
    || media?.source_url
    || media?.guid?.rendered
    || '';
}

function mediaResult(media) {
  const sourceUrl = preferredSource(media);
  return {
    id: media?.id,
    title: cleanText(media?.title?.rendered),
    caption: cleanText(media?.caption?.rendered || media?.media_details?.image_meta?.caption),
    credit: cleanText(media?.media_details?.image_meta?.credit || media?.media_details?.image_meta?.copyright),
    sourceUrl,
    proxyUrl: sourceUrl ? `/api/es-image-search?image=${encodeURIComponent(sourceUrl)}` : '',
    width: media?.media_details?.width || null,
    height: media?.media_details?.height || null,
  };
}

function isAllowedImageUrl(parsed) {
  if (ALLOWED_IMAGE_HOSTS.has(parsed.hostname)) return true;
  const hostAndPath = `${parsed.hostname}${parsed.pathname}`;
  return parsed.hostname.endsWith('.amazonaws.com')
    && hostAndPath.includes(ES_IMAGE_BUCKET);
}

async function proxyImage(imageUrl) {
  let parsed;
  try {
    parsed = new URL(imageUrl);
  } catch (error) {
    return json(400, { error: 'Invalid image URL.' });
  }

  if (!isAllowedImageUrl(parsed)) {
    return json(403, { error: 'Image host is not approved.' });
  }

  const response = await fetch(parsed.toString(), {
    headers: {
      'User-Agent': 'ES-Designer/1.0 (+https://www.essentiallysports.com/)',
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    },
  });

  if (!response.ok) {
    return json(response.status, { error: 'Image could not be fetched.' });
  }

  const contentType = response.headers.get('content-type') || 'image/jpeg';
  if (!contentType.startsWith('image/')) {
    return json(415, { error: 'URL did not return an image.' });
  }

  const arrayBuffer = await response.arrayBuffer();
  return {
    statusCode: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*',
    },
    body: Buffer.from(arrayBuffer).toString('base64'),
    isBase64Encoded: true,
  };
}

function parseMcpPayload(text, contentType) {
  if (!contentType.includes('text/event-stream')) {
    return JSON.parse(text);
  }

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
    const message = data?.error?.message || `ES MCP request failed: ${response.status}`;
    throw new Error(message);
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
    body: JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
    }),
  }).catch(() => null);
}

async function listMcpToolsForProbe() {
  try {
    const listed = await mcpRequest('tools/list', {}, '');
    return listed.data?.result?.tools || listed.data?.result || [];
  } catch (directError) {
    const initialized = await mcpRequest('initialize', {
      protocolVersion: ES_MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: 'es-designer-health-check',
        version: '1.0.0',
      },
    });
    await mcpNotify('notifications/initialized', {}, initialized.sessionId);
    const listed = await mcpRequest('tools/list', {}, initialized.sessionId);
    return listed.data?.result?.tools || listed.data?.result || [];
  }
}

async function getMcpDiagnosticState({ probe = false } = {}) {
  const state = getMcpConfigState();
  if (!probe) return state;

  state.probe = {
    attempted: false,
    ok: false,
    toolCount: 0,
    imageSearchTool: '',
    error: '',
  };

  if (!state.mcpConfigured) {
    state.probe.error = 'MCP credentials are not configured.';
    return state;
  }

  state.probe.attempted = true;
  try {
    const tools = await listMcpToolsForProbe();
    const toolNames = Array.isArray(tools)
      ? tools.map(tool => (typeof tool === 'string' ? tool : tool?.name)).filter(Boolean)
      : [];
    state.probe.ok = true;
    state.probe.toolCount = toolNames.length;
    state.probe.imageSearchTool = toolNames.find(name => name === 'search_images')
      || toolNames.find(name => name.endsWith('__search_images'))
      || toolNames.find(name => /search.*images?/i.test(name))
      || '';
  } catch (error) {
    state.probe.error = safeDiagnosticError(error);
  }

  return state;
}

function shouldProbeHealth(value) {
  return ['probe', 'deep', 'check'].includes(String(value || '').toLowerCase());
}

function parseMaybeJson(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || !/^[{[]/.test(trimmed)) return value;
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    return value;
  }
}

function s3UrlToHttps(value) {
  const raw = String(value || '').trim();
  if (!raw.startsWith('s3://')) return '';
  const withoutScheme = raw.slice(5);
  const slashIndex = withoutScheme.indexOf('/');
  if (slashIndex <= 0) return '';
  const bucket = withoutScheme.slice(0, slashIndex);
  const key = withoutScheme.slice(slashIndex + 1);
  if (bucket !== ES_IMAGE_BUCKET || !key) return '';
  return `https://${bucket}.s3.amazonaws.com/${key.split('/').map(encodeURIComponent).join('/')}`;
}

function bucketKeyToHttps(bucket, key) {
  const cleanBucket = String(bucket || '').trim();
  const cleanKey = String(key || '').replace(/^\/+/, '').trim();
  if (cleanBucket !== ES_IMAGE_BUCKET || !cleanKey) return '';
  return `https://${cleanBucket}.s3.amazonaws.com/${cleanKey.split('/').map(encodeURIComponent).join('/')}`;
}

function resolveMcpImageUrl(item) {
  const directUrl = item.url
    || item.image_url
    || item.imageUrl
    || item.source_url
    || item.sourceUrl
    || item.signed_url
    || item.signedUrl
    || item.full_url
    || item.fullUrl
    || item.download_url
    || item.downloadUrl
    || item.thumbnail_url
    || item.thumbnailUrl
    || '';
  if (/^https?:\/\//i.test(directUrl)) return directUrl;

  const s3Url = item.s3_url
    || item.s3Url
    || item.s3_uri
    || item.s3Uri
    || item.s3
    || '';
  const fromS3Url = s3UrlToHttps(s3Url);
  if (fromS3Url) return fromS3Url;

  return bucketKeyToHttps(
    item.bucket || item.s3_bucket || item.s3Bucket,
    item.key || item.s3_key || item.s3Key || item.path
  );
}

function addMcpImageCandidate(candidates, item) {
  if (!item || typeof item !== 'object') return;
  const sourceUrl = resolveMcpImageUrl(item);

  if (!sourceUrl) return;

  candidates.push({
    id: item.id || item.asset_id || item.assetId || item.key || sourceUrl,
    title: cleanText(item.title || item.name || item.caption || item.description || 'ES agency image'),
    caption: cleanText(item.caption || item.description),
    credit: cleanText(item.credit || item.agency || item.source || item.provider || 'agency'),
    source: 'mcp-agency',
    sourceUrl,
    proxyUrl: `/api/es-image-search?image=${encodeURIComponent(sourceUrl)}`,
    width: item.width || item.w || null,
    height: item.height || item.h || null,
  });
}

function addMcpTextImageCandidates(candidates, text) {
  const value = String(text || '');
  const recordPattern = /\*\*([^*\n]+)\*\*\s*\nType:\s*AGENCY\s*·\s*Full-resolution URL[^\n]*?:\s*(https?:\/\/[^\s)]+)([\s\S]*?)(?=\n+\*\*[^*\n]+\*\*\s*\nType:|$)/gi;
  let match;

  while ((match = recordPattern.exec(value))) {
    const details = match[3] || '';
    const readField = label => {
      const fieldMatch = details.match(new RegExp(`(?:^|\\n)${label}:\\s*([^\\n]+)`, 'i'));
      return fieldMatch ? fieldMatch[1].trim() : '';
    };

    addMcpImageCandidate(candidates, {
      title: match[1].trim(),
      url: match[2].trim(),
      caption: readField('Caption'),
      credit: readField('Credit'),
      alt: readField('Alt'),
      source: 'agency',
    });
  }
}

function walkMcpResult(value, candidates, seen = new WeakSet()) {
  const parsed = parseMaybeJson(value);
  if (!parsed) return;

  if (typeof parsed === 'string') {
    addMcpTextImageCandidates(candidates, parsed);
    if (/^https?:\/\//i.test(parsed)) addMcpImageCandidate(candidates, { url: parsed });
    return;
  }

  if (Array.isArray(parsed)) {
    parsed.forEach(item => walkMcpResult(item, candidates, seen));
    return;
  }

  if (typeof parsed !== 'object') return;
  if (seen.has(parsed)) return;
  seen.add(parsed);

  addMcpImageCandidate(candidates, parsed);

  if (parsed.type === 'text' && parsed.text) walkMcpResult(parsed.text, candidates, seen);
  if (parsed.type === 'image' && parsed.data) addMcpImageCandidate(candidates, parsed);

  [
    parsed.results,
    parsed.images,
    parsed.items,
    parsed.assets,
    parsed.data,
    parsed.content,
    parsed.structuredContent,
    parsed.result,
  ].forEach(child => walkMcpResult(child, candidates, seen));
}

function normalizeMcpImages(result) {
  const candidates = [];
  walkMcpResult(result, candidates);

  const seenUrls = new Set();
  return candidates.filter(candidate => {
    if (!candidate.sourceUrl || seenUrls.has(candidate.sourceUrl)) return false;
    seenUrls.add(candidate.sourceUrl);
    return true;
  });
}

async function callMcpSearchImages(query, perPage) {
  if (!ES_MCP_ACCESS_TOKEN && (!ES_MCP_REFRESH_TOKEN || !ES_MCP_CLIENT_ID)) return [];

  const args = {
    query,
    per_page: Math.max(perPage, 10),
    type: 'agency',
  };

  const resolveToolName = async sessionId => {
    if (ES_MCP_SEARCH_TOOL !== 'search_images') return ES_MCP_SEARCH_TOOL;
    try {
      const listed = await mcpRequest('tools/list', {}, sessionId);
      const tools = listed.data?.result?.tools || listed.data?.result || [];
      const names = Array.isArray(tools) ? tools.map(tool => tool?.name).filter(Boolean) : [];
      return names.find(name => name === 'search_images')
        || names.find(name => name.endsWith('__search_images'))
        || names.find(name => /search.*images?/i.test(name))
        || ES_MCP_SEARCH_TOOL;
    } catch (error) {
      return ES_MCP_SEARCH_TOOL;
    }
  };

  const callTool = async sessionId => mcpRequest('tools/call', {
    name: await resolveToolName(sessionId),
    arguments: args,
  }, sessionId);

  try {
    const direct = await callTool();
    return normalizeMcpImages(direct.data?.result).slice(0, perPage);
  } catch (directError) {
    const initialized = await mcpRequest('initialize', {
      protocolVersion: ES_MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: 'es-designer',
        version: '1.0.0',
      },
    });
    await mcpNotify('notifications/initialized', {}, initialized.sessionId);
    const called = await callTool(initialized.sessionId);
    return normalizeMcpImages(called.data?.result).slice(0, perPage);
  }
}

async function searchWordPressMedia(query, perPage) {
  const url = new URL(ES_MEDIA_ENDPOINT);
  url.searchParams.set('search', query);
  url.searchParams.set('per_page', String(perPage));
  url.searchParams.set('media_type', 'image');
  url.searchParams.set('orderby', 'date');
  url.searchParams.set('order', 'desc');
  url.searchParams.set('_fields', 'id,title,caption,source_url,guid,media_details');

  const response = await fetch(url.toString(), {
    headers: {
      'User-Agent': 'ES-Designer/1.0 (+https://www.essentiallysports.com/)',
      Accept: 'application/json',
    },
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.message || 'ES media search failed.');
  }

  return Array.isArray(data)
    ? data.map(mediaResult).filter(result => result.sourceUrl)
    : [];
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      },
      body: '',
    };
  }

  try {
    const params = event.queryStringParameters || {};
    const probeHealth = shouldProbeHealth(params.health);
    if ((params.health === '1' || params.health === 'true') && !probeHealth) {
      return json(200, await getMcpDiagnosticState({ probe: false }));
    }
    if (params.image) return proxyImage(params.image);

    const auth = await verifyEsUser(event);
    if (!auth.ok) {
      return json(auth.statusCode, { error: auth.error });
    }

    if (probeHealth) {
      return json(200, await getMcpDiagnosticState({ probe: shouldProbeHealth(params.health) }));
    }

    const query = cleanText(params.query).slice(0, 140);
    const perPage = Math.min(Math.max(parseInt(params.per_page || '25', 10) || 25, 1), 25);
    if (!query) return json(400, { error: 'Missing image search query.' });

    const configState = getMcpConfigState();
    const meta = {
      mcpConfigured: configState.mcpConfigured,
      mcpAttempted: false,
      mcpError: '',
      fallbackUsed: false,
    };
    let source = 'wordpress-media';
    let results = [];
    try {
      meta.mcpAttempted = configState.mcpConfigured;
      if (!configState.mcpConfigured) {
        meta.mcpError = 'MCP credentials are not configured.';
      }
      results = await callMcpSearchImages(query, perPage);
      if (results.length) source = 'mcp-agency';
    } catch (error) {
      meta.mcpError = safeDiagnosticError(error);
      results = [];
    }
    if (!results.length) {
      meta.fallbackUsed = true;
      results = await searchWordPressMedia(query, perPage);
    }

    return json(200, { query, source, results, meta });
  } catch (error) {
    return json(500, {
      error: error.message || 'ES image search failed.',
    });
  }
};
