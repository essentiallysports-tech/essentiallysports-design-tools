// Vercel adapter for netlify/functions/health.js (same toNetlifyEvent
// pattern as the other api/*.js files).
const { handler } = require('../netlify/functions/health.js');

function toNetlifyEvent(request) {
  return {
    httpMethod: request.method,
    headers: request.headers || {},
    queryStringParameters: request.query || {},
    body: null,
    isBase64Encoded: false,
  };
}

module.exports = async function health(request, response) {
  try {
    const result = await handler(toNetlifyEvent(request));
    Object.entries(result.headers || {}).forEach(([name, value]) => response.setHeader(name, value));
    response.status(result.statusCode || 200).send(result.body || '');
  } catch (error) {
    console.error(error);
    response.status(500).json({ ok: false, error: 'Health check failed.' });
  }
};
