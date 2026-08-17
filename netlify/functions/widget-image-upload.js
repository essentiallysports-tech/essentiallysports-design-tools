'use strict';

const { getStore } = require('@netlify/blobs');
const crypto = require('crypto');
const { verifyEsUser } = require('./_supabase-auth.js');

const STORE_NAME = 'widget-uploads';
// Netlify Functions have a hard 6MB request/response payload limit. Base64
// inflates size by ~4/3, so the raw image is capped well under that so the
// base64 JSON body never comes close to the ceiling.
const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      Vary: 'Origin',
    },
    body: JSON.stringify(body),
  };
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed.' });
  }

  // Only logged-in ES Designer users can write to the media store — this is
  // the one thing standing between this endpoint and being a public,
  // unauthenticated upload point.
  const auth = await verifyEsUser(event);
  if (!auth.ok) {
    return json(auth.statusCode, { error: auth.error });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (error) {
    return json(400, { error: 'Invalid request body.' });
  }

  const contentType = String(payload.contentType || '').toLowerCase().split(';')[0].trim();
  const ext = ALLOWED_TYPES[contentType];
  if (!ext) {
    return json(415, { error: 'Only PNG, JPEG, WebP, or GIF images are allowed.' });
  }

  const dataBase64 = String(payload.dataBase64 || '');
  if (!dataBase64) {
    return json(400, { error: 'Missing image data.' });
  }

  let buffer;
  try {
    buffer = Buffer.from(dataBase64, 'base64');
  } catch (error) {
    return json(400, { error: 'Image data could not be decoded.' });
  }

  if (!buffer.length) {
    return json(400, { error: 'Image data is empty.' });
  }
  if (buffer.length > MAX_BYTES) {
    return json(413, { error: `Image is larger than the ${Math.floor(MAX_BYTES / (1024 * 1024))}MB limit.` });
  }

  const key = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${ext}`;

  try {
    const store = getStore({ name: STORE_NAME, consistency: 'strong' });
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    await store.set(key, arrayBuffer, {
      metadata: {
        contentType,
        uploadedBy: auth.user.email,
        uploadedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    return json(502, { error: 'Could not save the image. Please try again, or paste a link manually.' });
  }

  return json(200, {
    url: `/api/widget-image?key=${encodeURIComponent(key)}`,
  });
};
