const { handler } = require('../netlify/functions/es-mcp-oauth-callback.js');

module.exports = async function esMcpOauthCallback(request, response) {
  try {
    const result = await handler({
      httpMethod: request.method,
      headers: request.headers || {},
      queryStringParameters: request.query || {},
      body: request.body == null
        ? null
        : (typeof request.body === 'string' ? request.body : JSON.stringify(request.body)),
      isBase64Encoded: false,
    });

    Object.entries(result.headers || {}).forEach(([name, value]) => {
      response.setHeader(name, value);
    });
    response.status(result.statusCode || 200).send(result.body || '');
  } catch (error) {
    response.status(500).send('OAuth callback failed.');
  }
};
