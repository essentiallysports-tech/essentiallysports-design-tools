// Vercel adapter for netlify/functions/auth-bounce.js (same toNetlifyEvent
// pattern as the other api/*.js files).
const { handler } = require('../netlify/functions/auth-bounce.js');

function toNetlifyEvent(request) {
  const body = request.body == null
    ? null
    : (typeof request.body === 'string'
      ? request.body
      : (Buffer.isBuffer(request.body) ? request.body.toString('utf8') : JSON.stringify(request.body)));

  return {
    httpMethod: request.method,
    headers: request.headers || {},
    queryStringParameters: request.query || {},
    body,
    isBase64Encoded: false,
  };
}

module.exports = async function authBounce(request, response) {
  try {
    const result = await handler(toNetlifyEvent(request));
    Object.entries(result.headers || {}).forEach(([name, value]) => response.setHeader(name, value));
    response.status(result.statusCode || 200).send(result.body || '');
  } catch (error) {
    console.error(error);
    response.status(500).json({ ok: false, error: 'Report failed.' });
  }
};
