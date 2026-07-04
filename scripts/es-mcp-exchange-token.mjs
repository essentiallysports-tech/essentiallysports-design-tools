#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';

const issuer = process.env.ES_MCP_ISSUER || 'https://mcp.essentiallysports.com';
const code = process.argv[2] || process.env.ES_MCP_AUTH_CODE;
const sessionFile = process.env.ES_MCP_SESSION_FILE || '';
const tokenFile = process.env.ES_MCP_TOKEN_FILE || '';
const session = sessionFile
  ? JSON.parse(readFileSync(sessionFile, 'utf8'))
  : {};
const clientId = process.env.ES_MCP_CLIENT_ID || session.clientId;
const redirectUri = process.env.ES_MCP_REDIRECT_URI || session.redirectUri;
const codeVerifier = process.env.ES_MCP_CODE_VERIFIER || session.codeVerifier;

if (!code || !clientId || !redirectUri || !codeVerifier) {
  console.error('Usage: ES_MCP_CLIENT_ID=... ES_MCP_REDIRECT_URI=... ES_MCP_CODE_VERIFIER=... node scripts/es-mcp-exchange-token.mjs <authorization-code>');
  process.exit(1);
}

const metadataResponse = await fetch(`${issuer}/.well-known/oauth-authorization-server`);
if (!metadataResponse.ok) {
  throw new Error(`Could not read OAuth metadata: ${metadataResponse.status}`);
}
const metadata = await metadataResponse.json();

const body = new URLSearchParams({
  grant_type: 'authorization_code',
  code,
  client_id: clientId,
  redirect_uri: redirectUri,
  code_verifier: codeVerifier,
});

const tokenResponse = await fetch(metadata.token_endpoint, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  },
  body,
});

const token = await tokenResponse.json();
if (!tokenResponse.ok) {
  console.error(JSON.stringify(token, null, 2));
  throw new Error(`Token exchange failed: ${tokenResponse.status}`);
}

if (tokenFile) {
  writeFileSync(tokenFile, JSON.stringify({
    accessToken: token.access_token,
    refreshToken: token.refresh_token || '',
    tokenType: token.token_type || 'Bearer',
    expiresIn: token.expires_in || null,
    scope: token.scope || 'mcp',
    clientId,
  }, null, 2), { mode: 0o600 });
  console.log(`ES MCP token exchange succeeded; credentials saved securely to ${tokenFile}.`);
} else {
  console.log('ES MCP token exchange succeeded.');
  console.log('');
  console.log('Set this in Vercel environment variables:');
  console.log(`ES_MCP_ACCESS_TOKEN=${token.access_token}`);
  if (token.refresh_token) {
    console.log('');
    console.log('Optional refresh token, store securely if ES wants long-lived refresh support later:');
    console.log(`ES_MCP_CLIENT_ID=${clientId}`);
    console.log(`ES_MCP_REFRESH_TOKEN=${token.refresh_token}`);
  }
}
