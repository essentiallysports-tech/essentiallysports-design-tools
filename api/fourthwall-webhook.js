const { handler } = require('../netlify/functions/fourthwall-webhook.js');

// Fourthwall signs the exact bytes it sent (HMAC-SHA256), so this adapter must
// hand the handler the raw body. Vercel only parses request.body when it is
// read, so the stream is read here first, as bytes. A body Vercel already
// parsed into an object is NOT re-encoded (it would not match the signature):
// the handler then refuses it.
async function readRawBody(request) {
  if (Buffer.isBuffer(request.rawBody)) return request.rawBody;
  if (typeof request.rawBody === 'string') return Buffer.from(request.rawBody, 'utf8');
  if (request && typeof request[Symbol.asyncIterator] === 'function' && !request.readableEnded) {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    if (chunks.length) return Buffer.concat(chunks);
  }
  const body = request.body;
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  return Buffer.alloc(0);
}

module.exports = async function fourthwallWebhook(request, response) {
  try {
    const raw = await readRawBody(request);
    const result = await handler({
      httpMethod: request.method,
      headers: request.headers || {},
      queryStringParameters: request.query || {},
      body: raw.toString('base64'),
      isBase64Encoded: true,
    });
    Object.entries(result.headers || {}).forEach(([name, value]) => response.setHeader(name, value));
    response.status(result.statusCode || 200).send(result.body || '');
  } catch (error) {
    console.error('fourthwall webhook adapter failed:', error?.message || error);
    response.status(500).json({ ok: false, error: 'The Fourthwall webhook is unavailable right now.' });
  }
};

module.exports.config = { api: { bodyParser: false } };
module.exports.readRawBody = readRawBody;
