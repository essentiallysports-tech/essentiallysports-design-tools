#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const tokenFile = process.env.ES_MCP_TOKEN_FILE;
const query = process.argv[2] || 'LeBron James';
if (!tokenFile) {
  console.error('Set ES_MCP_TOKEN_FILE to the private OAuth token JSON file.');
  process.exit(1);
}

const { accessToken } = JSON.parse(readFileSync(tokenFile, 'utf8'));
const endpoint = process.env.ES_MCP_ENDPOINT || 'https://mcp.essentiallysports.com/mcp';

function parseMcpBody(text) {
  if (!text.trim()) return null;
  const eventData = text
    .split('\n')
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trim())
    .filter(Boolean)
    .pop();
  return JSON.parse(eventData || text);
}

async function mcpCall(payload, sessionId = '') {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  return {
    status: response.status,
    sessionId: response.headers.get('mcp-session-id') || sessionId,
    data: parseMcpBody(text),
  };
}

const initialized = await mcpCall({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: {
      name: 'es-designer-diagnostic',
      version: '1.0.0',
    },
  },
});

await mcpCall({
  jsonrpc: '2.0',
  method: 'notifications/initialized',
  params: {},
}, initialized.sessionId);

const listed = await mcpCall({
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/list',
  params: {},
}, initialized.sessionId);

const tools = listed.data?.result?.tools || [];
const imageTool = tools.find(tool => tool.name === 'search_images')
  || tools.find(tool => String(tool.name).endsWith('__search_images'));

if (!imageTool) {
  console.log(JSON.stringify({
    initializeStatus: initialized.status,
    imageTool: null,
    availableTools: tools.map(tool => tool.name),
  }, null, 2));
  process.exit(1);
}

const called = await mcpCall({
  jsonrpc: '2.0',
  id: 3,
  method: 'tools/call',
  params: {
    name: imageTool.name,
    arguments: {
      query,
      per_page: 10,
      type: 'agency',
    },
  },
}, initialized.sessionId);

console.log(JSON.stringify({
  initializeStatus: initialized.status,
  imageTool: {
    name: imageTool.name,
    description: imageTool.description,
    inputSchema: imageTool.inputSchema,
  },
  callStatus: called.status,
  result: called.data?.result || called.data?.error || called.data,
}, null, 2));
