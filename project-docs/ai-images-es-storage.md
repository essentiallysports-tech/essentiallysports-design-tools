# AI Images / ES Storage integration

The workspace `AI Images` button searches for an image using the active canvas text/entity context, shows up to 4 options, and applies the selected image to the canvas.

## Frontend behavior

- File: `index.html`
- Button: `[data-ai-image-search]`
- Query builder: `getActiveImageSearchQueries()` / `getActiveHeadlineForImageSearch()`
- Picker: `#ai-image-picker`

The search now builds ranked queries instead of one glued-together query:

1. Explicit entity/name/team fields, such as player names or selected teams.
2. Likely entity names extracted from the headline/body text, such as `LeBron James` from `LeBron James makes history`.
3. Full headline/body text fallback.
4. Sport/context fallback.

The button tries these queries in order and stops when ES Storage returns usable images. This keeps the intended behavior: if the headline contains an entity name, the image search is entity-first instead of sending a generic full headline only.

The frontend preserves the backend `source` value:

- `mcp-agency` is shown as `ES Storage`.
- `wordpress-media` and `direct-wordpress-media` are shown as `ES media fallback`.

This makes it visible in the picker/status whether the user is choosing from the private ES Storage path or the fallback media search.

Search responses also include a non-secret `meta` object:

```json
{
  "mcpConfigured": true,
  "mcpAttempted": true,
  "mcpError": "Missing or invalid token.",
  "fallbackUsed": true
}
```

If MCP fails and fallback media results are shown, the frontend includes the sanitized fallback reason in both the status text and the picker subtitle. Token values are not returned.

If MCP credentials are not configured, the search response uses:

```json
{
  "mcpConfigured": false,
  "mcpAttempted": false,
  "mcpError": "MCP credentials are not configured.",
  "fallbackUsed": true
}
```

## Backend behavior

- File: `netlify/functions/es-image-search.js`
- Route: `/api/es-image-search`
- Netlify redirect: `netlify.toml` maps `/api/*` to `/.netlify/functions/:splat`.

The backend has two paths:

1. Preferred private ES MCP path, when configured.
2. Public EssentiallySports WordPress media fallback, when MCP is not configured or returns no usable results.

Use this non-secret health check on Netlify to confirm whether the private MCP path is configured:

```text
/api/es-image-search?health=1
```

Expected private setup:

```json
{
  "mcpConfigured": true,
  "tokenMode": "access-token or refresh-token",
  "endpoint": "https://mcp.essentiallysports.com/mcp",
  "searchTool": "search_images",
  "imageBucket": "essentiallysports-images-v2prod",
  "fallback": "wordpress-media"
}
```

The health check never returns the token value.

After adding credentials, use the probe mode to test the MCP handshake and tool discovery without performing an image search:

```text
/api/es-image-search?health=probe
```

Expected working probe:

```json
{
  "mcpConfigured": true,
  "probe": {
    "attempted": true,
    "ok": true,
    "toolCount": 1,
    "imageSearchTool": "mcp__es__search_images"
  }
}
```

If the token is missing/expired/wrong, `probe.ok` will be `false` and `probe.error` will contain a short sanitized MCP error.

For a complete deployed check, run:

```bash
ES_DESIGNER_AUTH_TOKEN=<supabase-access-token> npm run verify:es-images -- https://YOUR-SITE.netlify.app "LeBron James"
```

The verifier checks:

1. `/api/es-image-search?health=1`
2. `/api/es-image-search?health=probe` with an ES Designer bearer token
3. `/api/es-image-search?query=<entity>&per_page=15` with an ES Designer bearer token

The final `"pass"` value is `true` only when MCP is configured, the probe works, and the search response comes from `mcp-agency`. The command exits with code `1` when `"pass"` is `false`, so it can be used as a deployment check.

The image proxy path is also handled by the same function:

```text
/api/es-image-search?image=<encoded-image-url>
```

This keeps the canvas export-safe on Netlify by loading images through the same origin.

## Private ES MCP configuration

The ES files indicate the proper source call is:

```text
search_images(query=..., per_page>=10, type="agency")
```

`type="agency"` is intentional. The ES guidance says not to use `custom`/`all` because those can contain ES watermark overlays.

Set these Netlify environment variables when ES MCP access is available:

```text
ES_MCP_ACCESS_TOKEN=<bearer token>
ES_MCP_ENDPOINT=https://mcp.essentiallysports.com/mcp
ES_MCP_SEARCH_TOOL=search_images
ES_MCP_PROTOCOL_VERSION=2025-06-18
```

Only `ES_MCP_ACCESS_TOKEN` is required. The other values have safe defaults.

If ES gives a short-lived access token plus refresh token, you can store this pair instead of a permanent access token:

```text
ES_MCP_CLIENT_ID=<registered OAuth client id>
ES_MCP_REFRESH_TOKEN=<returned refresh token>
```

The backend will exchange the refresh token for an access token server-side before calling MCP. Do not put MCP tokens in frontend files.

When `ES_MCP_SEARCH_TOOL` is left as `search_images`, the backend also calls `tools/list` after initialization and will use a matching namespaced image-search tool if the MCP server exposes one, for example a name ending in `__search_images`.

## Current blocker

`https://mcp.essentiallysports.com/mcp` is reachable, but without a bearer token it returns:

```json
{"jsonrpc":"2.0","id":null,"error":{"code":-32001,"message":"Missing or invalid token."}}
```

OAuth metadata is available at:

```text
https://mcp.essentiallysports.com/.well-known/oauth-authorization-server
```

It advertises authorization-code + PKCE, dynamic client registration, and `mcp` scope.

Dynamic registration was tested. The server rejected `http://localhost` because it requires HTTPS redirect URIs, which confirms the live setup needs a deployed HTTPS callback URL.

The production site currently runs on Vercel:

```bash
https://essentiallysports-design-tools.vercel.app
```

Vercel adapters live in `api/` and reuse the tested handlers in
`netlify/functions/`, so both hosting environments expose identical routes:

- `/api/es-image-search`
- `/api/es-mcp-oauth-callback`

To register ES Designer after the Vercel callback has deployed:

```bash
npm run es:mcp:register -- https://essentiallysports-design-tools.vercel.app/api/es-mcp-oauth-callback
```

The helper prints:

- the registered `client_id`
- a PKCE `code_verifier`
- the `state`
- the authorization URL to open

After approval, exchange the returned `code` at the OAuth `token_endpoint` with:

```bash
ES_MCP_CLIENT_ID=<printed client id> \
ES_MCP_REDIRECT_URI=<same https redirect uri> \
ES_MCP_CODE_VERIFIER=<printed code verifier> \
npm run es:mcp:token -- <callback code>
```

Then save the returned access token as a Vercel environment variable:

```text
ES_MCP_ACCESS_TOKEN=<returned access token>
```

If the token exchange also returns a refresh token, the helper prints:

```text
ES_MCP_CLIENT_ID=<registered OAuth client id>
ES_MCP_REFRESH_TOKEN=<returned refresh token>
```

Store those in Vercel too if ES access tokens expire quickly.

Until a valid MCP token/client flow is provided, the public ES media fallback remains active.

## Regression test

The repo includes a mocked MCP test that verifies the private branch without needing a real ES token:

```bash
npm test
```

Or run each check separately:

```bash
npm run test:es-images
npm run test:ai-image-query
npm run test:vercel-api
```

`test:es-images` checks that the backend:

- initializes MCP when direct tool calls require a session;
- sends `notifications/initialized`;
- discovers a namespaced `__search_images` tool;
- calls the tool with `type="agency"` and `per_page >= 10`;
- parses live MCP Markdown metadata blocks and uses their full-resolution URLs;
- normalizes returned HTTPS images, `s3://essentiallysports-images-v2prod/...` URLs, and `{ bucket, key }` objects into picker-ready results.

`test:ai-image-query` checks that the frontend query builder prioritizes entity/name fields for cover, stats double entity, double entity quote, and long quote contexts.

For an authenticated schema/response diagnostic without printing the token:

```bash
ES_MCP_TOKEN_FILE=/private/path/to/token.json \
npm run inspect:es-images -- "LeBron James"
```
