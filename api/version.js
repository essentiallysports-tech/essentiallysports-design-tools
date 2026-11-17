// Vercel adapter for netlify/functions/version.js (same pattern as the other
// api/*.js files). Default function settings are enough; no vercel.json entry.
const { handler } = require('../netlify/functions/version.js');

function toNetlifyEvent(request) {
  return {
    httpMethod: request.method,
    headers: request.headers || {},
    queryStringParameters: request.query || {},
    body: null,
    isBase64Encoded: false,
  };
}

module.exports = async function version(request, response) {
  try {
    const result = await handler(toNetlifyEvent(request));
    Object.entries(result.headers || {}).forEach(([name, value]) => response.setHeader(name, value));
    response.status(result.statusCode || 200).send(result.body || '');
  } catch (error) {
    console.error(error);
    response.status(500).json({ ok: false, error: 'Version lookup failed.' });
  }
};
