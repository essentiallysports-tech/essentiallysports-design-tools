const { handler } = require("../netlify/functions/reel-maker.js");

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

module.exports = async function reelMaker(request, response) {
  try {
    const result = await handler(toNetlifyEvent(request));
    sendNetlifyResult(response, result);
  } catch (error) {
    console.error(error);
    response.status(500).json({
      error: 'Reels Studio is unavailable right now.',
    });
  }
};
