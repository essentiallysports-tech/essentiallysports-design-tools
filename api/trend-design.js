const { handler } = require('../netlify/functions/trend-design.js');

function toNetlifyEvent(request) {
  return {
    httpMethod: request.method,
    headers: request.headers || {},
    queryStringParameters: request.query || {},
    body: null,
    isBase64Encoded: false,
  };
}

module.exports = async function trendDesign(request, response) {
  try {
    const result = await handler(toNetlifyEvent(request));
    Object.entries(result.headers || {}).forEach(([name, value]) => response.setHeader(name, value));
    response.status(result.statusCode || 200).send(result.body || '');
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: 'Trends are unavailable right now.',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};
