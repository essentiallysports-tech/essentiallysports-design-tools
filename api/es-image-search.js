const { handler } = require('../netlify/functions/es-image-search.js');

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

  const statusCode = result.statusCode || 200;
  if (result.isBase64Encoded) {
    response.status(statusCode).send(Buffer.from(result.body || '', 'base64'));
    return;
  }

  response.status(statusCode).send(result.body || '');
}

module.exports = async function esImageSearch(request, response) {
  try {
    const result = await handler(toNetlifyEvent(request));
    sendNetlifyResult(response, result);
  } catch (error) {
    response.status(500).json({
      error: 'ES image search failed.',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};
