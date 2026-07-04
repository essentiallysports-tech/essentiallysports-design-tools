function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

exports.handler = async function handler(event) {
  const params = event.queryStringParameters || {};
  const code = params.code || '';
  const state = params.state || '';
  const error = params.error || '';
  const errorDescription = params.error_description || '';

  const body = error
    ? `
      <h1>ES MCP authorization failed</h1>
      <p><strong>Error:</strong> ${escapeHtml(error)}</p>
      <p>${escapeHtml(errorDescription)}</p>
    `
    : `
      <h1>ES MCP authorization code received</h1>
      <p>Copy this code and run the token exchange helper from the repo.</p>
      <label>Authorization code</label>
      <textarea readonly>${escapeHtml(code)}</textarea>
      <label>State</label>
      <textarea readonly>${escapeHtml(state)}</textarea>
      <pre>ES_MCP_CLIENT_ID=&lt;printed client id&gt; \\
ES_MCP_REDIRECT_URI=&lt;this callback URL&gt; \\
ES_MCP_CODE_VERIFIER=&lt;printed code verifier&gt; \\
npm run es:mcp:token -- ${escapeHtml(code || '<callback code>')}</pre>
    `;

  return {
    statusCode: error ? 400 : 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
    body: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ES MCP OAuth Callback</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #F5FAFF;
      color: #033162;
      font-family: Arial, sans-serif;
    }
    main {
      width: min(760px, calc(100vw - 40px));
      padding: 28px;
      border: 1px solid #B5D8FD;
      border-radius: 16px;
      background: #FFFFFF;
      box-shadow: 0 24px 70px rgba(3, 49, 98, 0.14);
    }
    h1 {
      margin: 0 0 10px;
      font-size: 28px;
    }
    p {
      color: #607F9E;
      line-height: 1.5;
    }
    label {
      display: block;
      margin: 18px 0 6px;
      font-weight: 700;
    }
    textarea,
    pre {
      width: 100%;
      box-sizing: border-box;
      padding: 12px;
      border: 1px solid #B5D8FD;
      border-radius: 10px;
      background: #F7FBFF;
      color: #033162;
      font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      white-space: pre-wrap;
      word-break: break-all;
    }
    textarea {
      min-height: 86px;
      resize: vertical;
    }
  </style>
</head>
<body>
  <main>${body}</main>
</body>
</html>`,
  };
};
