const { handler } = require('../netlify/functions/slack-command.js');

// Slack signs the exact bytes it sent, so this adapter must hand the handler
// the raw form body. Vercel only parses request.body when it is read, so the
// stream is read here first; parsed fallbacks are last resorts (a re-encoded
// body that differs from Slack's bytes simply fails verification).
async function readRawBody(request) {
  if (typeof request.rawBody === 'string') return request.rawBody;
  if (Buffer.isBuffer(request.rawBody)) return request.rawBody.toString('utf8');
  if (request && typeof request[Symbol.asyncIterator] === 'function' && !request.readableEnded) {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    if (chunks.length) return Buffer.concat(chunks).toString('utf8');
  }
  const body = request.body;
  if (typeof body === 'string') return body;
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  if (body && typeof body === 'object') return new URLSearchParams(body).toString();
  return '';
}

module.exports = async function slackCommand(request, response) {
  try {
    const result = await handler({
      httpMethod: request.method,
      headers: request.headers || {},
      queryStringParameters: request.query || {},
      body: await readRawBody(request),
      isBase64Encoded: false,
    });
    Object.entries(result.headers || {}).forEach(([name, value]) => response.setHeader(name, value));
    response.status(result.statusCode || 200).send(result.body || '');
  } catch (error) {
    response.status(500).send('Slack command failed.');
  }
};

module.exports.config = { api: { bodyParser: false } };
module.exports.readRawBody = readRawBody;
