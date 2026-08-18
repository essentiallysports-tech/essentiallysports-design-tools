const { handler } = require('../netlify/functions/tweet-oembed.js');

function toNetlifyEvent(request) {
  return {
    httpMethod: request.method,
    headers: request.headers || {},
    queryStringParameters: request.query || {},
    body: null,
    isBase64Encoded: false,
  };
}

function sendNetlifyResult(response, result) {
  Object.entries(result.headers || {}).forEach(([name, value]) => {
    response.setHeader(name, value);
  });

  response.status(result.statusCode || 200).send(result.body || '');
}

module.exports = async function tweetOembed(request, response) {
  try {
    const result = await handler(toNetlifyEvent(request));
    sendNetlifyResult(response, result);
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: 'Tweet lookup failed.',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};
