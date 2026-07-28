const { handler } = require('../netlify/functions/es-video-intelligence.js');

function toNetlifyEvent(request) {
  const body = request.body == null
    ? null
    : (typeof request.body === 'string' ? request.body : JSON.stringify(request.body));

  return {
    httpMethod: request.method,
    headers: request.headers || {},
    queryStringParameters: request.query || {},
    body,
    isBase64Encoded: false,
  };
}

function sendNetlifyResult(response, result) {
  Object.entries(result.headers || {}).forEach(([name, value]) => {
    response.setHeader(name, value);
  });

  response.status(result.statusCode || 200).send(result.body || '');
}

module.exports = async function esVideoIntelligence(request, response) {
  try {
    const result = await handler(toNetlifyEvent(request));
    sendNetlifyResult(response, result);
  } catch (error) {
    response.status(500).json({
      error: 'ES video intelligence failed.',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};
