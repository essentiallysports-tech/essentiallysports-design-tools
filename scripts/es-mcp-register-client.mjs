#!/usr/bin/env node

import { writeFileSync } from 'node:fs';

const issuer = process.env.ES_MCP_ISSUER || 'https://mcp.essentiallysports.com';
const redirectUri = process.argv[2] || process.env.ES_MCP_REDIRECT_URI;
const sessionFile = process.env.ES_MCP_SESSION_FILE || '';

if (!redirectUri || !redirectUri.startsWith('https://')) {
  console.error('Usage: node scripts/es-mcp-register-client.mjs https://your-site.example/api/es-mcp-oauth-callback');
  console.error('ES MCP requires an HTTPS redirect URI.');
  process.exit(1);
}

function base64Url(bytes) {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function sha256Base64Url(value) {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return base64Url(Buffer.from(digest));
}

const metadataResponse = await fetch(`${issuer}/.well-known/oauth-authorization-server`);
if (!metadataResponse.ok) {
  throw new Error(`Could not read OAuth metadata: ${metadataResponse.status}`);
}
const metadata = await metadataResponse.json();

const registrationResponse = await fetch(metadata.registration_endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    client_name: 'ES Designer',
    redirect_uris: [redirectUri],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    scope: 'mcp',
    token_endpoint_auth_method: 'none',
  }),
});

const registration = await registrationResponse.json();
if (!registrationResponse.ok) {
  console.error(JSON.stringify(registration, null, 2));
  throw new Error(`Client registration failed: ${registrationResponse.status}`);
}

const codeVerifier = base64Url(crypto.getRandomValues(new Uint8Array(48)));
const codeChallenge = await sha256Base64Url(codeVerifier);
const state = base64Url(crypto.getRandomValues(new Uint8Array(24)));
const authorizationUrl = new URL(metadata.authorization_endpoint);
authorizationUrl.searchParams.set('response_type', 'code');
authorizationUrl.searchParams.set('client_id', registration.client_id);
authorizationUrl.searchParams.set('redirect_uri', redirectUri);
authorizationUrl.searchParams.set('scope', 'mcp');
authorizationUrl.searchParams.set('state', state);
authorizationUrl.searchParams.set('code_challenge', codeChallenge);
authorizationUrl.searchParams.set('code_challenge_method', 'S256');

if (sessionFile) {
  writeFileSync(sessionFile, JSON.stringify({
    clientId: registration.client_id,
    redirectUri,
    codeVerifier,
    state,
    tokenEndpoint: metadata.token_endpoint,
    authorizationUrl: authorizationUrl.toString(),
  }, null, 2), { mode: 0o600 });
  console.log(`Saved the temporary OAuth session securely to ${sessionFile}.`);
} else {
  console.log('Registered ES MCP OAuth client.');
  console.log('');
  console.log('Save these temporarily while completing OAuth:');
  console.log(`ES_MCP_CLIENT_ID=${registration.client_id}`);
  console.log(`ES_MCP_REDIRECT_URI=${redirectUri}`);
  console.log(`ES_MCP_CODE_VERIFIER=${codeVerifier}`);
  console.log(`ES_MCP_OAUTH_STATE=${state}`);
  console.log(`ES_MCP_TOKEN_ENDPOINT=${metadata.token_endpoint}`);
  console.log('');
}
console.log('Open this URL, approve access, and exchange the returned code for a token:');
console.log(authorizationUrl.toString());
