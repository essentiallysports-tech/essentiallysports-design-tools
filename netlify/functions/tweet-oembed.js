const OEMBED_ENDPOINT = 'https://publish.twitter.com/oembed';
const SYNDICATION_ENDPOINT = 'https://cdn.syndication.twimg.com/tweet-result';
const FXTWITTER_ENDPOINT = 'https://api.fxtwitter.com';

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      Vary: 'Origin',
    },
    body: JSON.stringify(body),
  };
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)));
}

function cleanHtmlText(value) {
  return decodeEntities(String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<a\b[^>]*>(.*?)<\/a>/gis, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n'))
    .trim();
}

function extractTweetId(url) {
  return String(url || '').match(/\/status(?:es)?\/(\d+)/i)?.[1] || '';
}

function normalizeTweetUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch (error) {
    throw new Error('Enter a valid X/Twitter post URL.');
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (!['x.com', 'twitter.com', 'mobile.twitter.com'].includes(host)) {
    throw new Error('Use a public x.com or twitter.com post URL.');
  }

  if (!/\/status(?:es)?\/\d+/i.test(parsed.pathname)) {
    throw new Error('That link does not look like a tweet status URL.');
  }

  parsed.hostname = 'x.com';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

function formatCompactNumber(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return '0';
  if (number >= 1000000) return `${(number / 1000000).toFixed(number >= 10000000 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (number >= 1000) return `${(number / 1000).toFixed(number >= 10000 ? 0 : 1).replace(/\.0$/, '')}K`;
  return String(number);
}

function formatTweetDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC',
  }).format(date);
  const day = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
  return `${time} · ${day}`;
}

function replaceTweetUrls(text, entities = {}) {
  let output = String(text || '');
  (entities.urls || []).forEach(entity => {
    if (entity?.url) output = output.replace(entity.url, entity.display_url || entity.expanded_url || entity.url);
  });
  (entities.media || []).forEach(entity => {
    if (entity?.url) output = output.replace(entity.url, '').trim();
  });
  return output.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function avatarOriginalUrl(value) {
  return String(value || '').replace(/_normal(\.[a-z]+)$/i, '_400x400$1');
}

async function imageToDataUrl(url) {
  if (!url) return '';
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'User-Agent': 'FrameUp Tweet Quote Renderer',
      },
    });
    if (!response.ok) return '';
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    return `data:${contentType};base64,${base64}`;
  } catch (error) {
    return '';
  }
}

function parseOembed(payload, canonicalUrl) {
  const html = String(payload?.html || '');
  const paragraph = html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] || '';
  const signature = html.match(/&mdash;\s*([^<]+?)\s*<a\b[^>]*>([^<]+)<\/a>/i);
  const authorLine = decodeEntities(signature?.[1] || '').trim();
  const dateLabel = decodeEntities(signature?.[2] || '').trim();
  const handle = authorLine.match(/\(@([^)]+)\)/)?.[1] || '';
  const authorName = String(payload?.author_name || authorLine.replace(/\s*\(@[^)]+\)\s*$/, '') || 'X User').trim();

  const cleanedText = cleanHtmlText(paragraph);
  return {
    ok: true,
    source: 'x-oembed',
    url: canonicalUrl,
    authorName,
    handle,
    text: cleanedText,
    dateLabel,
    metrics: '',
    avatarUrl: '',
    avatarDataUrl: '',
    verified: false,
    provider: payload?.provider_name || 'X',
    // The oEmbed widget marks a truncated "long post" preview with a
    // trailing ellipsis in its HTML -- same underlying limitation as the
    // note_tweet check in parseSyndication (see the comment there).
    truncated: /[…]\s*$/.test(cleanedText),
  };
}

async function parseFxTwitter(tweetId, canonicalUrl) {
  // fxtwitter (api.fxtwitter.com, the open-source "FixTweet" project) is the
  // only public, unauthenticated source found that actually resolves the
  // full body of an X "long post" (>280 chars) -- both the syndication and
  // oEmbed endpoints only ever return the ~280-char legacy preview for
  // those (see parseSyndication/parseOembed below, kept as fallbacks).
  const response = await fetch(`${FXTWITTER_ENDPOINT}/i/status/${encodeURIComponent(tweetId)}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  const tweet = payload?.tweet;
  if (!tweet || payload?.code !== 200) return null;

  const author = tweet.author || {};
  const avatarUrl = avatarOriginalUrl(author.avatar_url);
  const text = String(tweet.text || '').trim();
  if (!text) return null;

  return {
    ok: true,
    source: 'fx-twitter',
    url: tweet.url || canonicalUrl,
    authorName: String(author.name || 'X User').trim(),
    handle: String(author.screen_name || '').trim(),
    text,
    dateLabel: formatTweetDate(tweet.created_at),
    metrics: `${formatCompactNumber(tweet.replies)} replies · ${formatCompactNumber(tweet.retweets)} reposts · ${formatCompactNumber(tweet.likes)} likes`,
    avatarUrl,
    avatarDataUrl: await imageToDataUrl(avatarUrl),
    verified: Boolean(author.verification?.verified),
    provider: 'X',
    truncated: false,
  };
}

async function parseSyndication(payload, canonicalUrl) {
  const user = payload?.user || {};
  const favoriteCount = Number(payload?.favorite_count || 0);
  const retweetCount = Number(payload?.retweet_count || 0);
  const replyCount = Number(payload?.conversation_count || payload?.reply_count || 0);
  const avatarUrl = avatarOriginalUrl(user.profile_image_url_https);

  return {
    ok: true,
    source: 'x-syndication',
    url: canonicalUrl,
    authorName: String(user.name || 'X User').trim(),
    handle: String(user.screen_name || '').trim(),
    text: replaceTweetUrls(payload?.text, payload?.entities),
    dateLabel: formatTweetDate(payload?.created_at),
    metrics: `${formatCompactNumber(replyCount)} replies · ${formatCompactNumber(retweetCount)} reposts · ${formatCompactNumber(favoriteCount)} likes`,
    avatarUrl,
    avatarDataUrl: await imageToDataUrl(avatarUrl),
    verified: Boolean(user.verified || user.is_blue_verified),
    provider: 'X',
    // "Long posts" (X Premium note tweets, >280 chars) only expose this
    // preview text through the public syndication/oEmbed APIs -- the full
    // extended body lives behind `note_tweet`, which resolves to nothing
    // more than an opaque GraphQL id without authenticated API access.
    // There is no public, unauthenticated way to fetch the rest.
    truncated: Boolean(payload?.note_tweet),
  };
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'Method not allowed.' });

  try {
    const url = normalizeTweetUrl(event.queryStringParameters?.url);
    const tweetId = extractTweetId(url);
    if (tweetId) {
      try {
        const fxResult = await parseFxTwitter(tweetId, url);
        if (fxResult) return json(200, fxResult);
      } catch (error) {
        // fall through to the other sources below
      }

      const syndicationResponse = await fetch(`${SYNDICATION_ENDPOINT}?id=${encodeURIComponent(tweetId)}&token=1`, {
        headers: { Accept: 'application/json' },
      });
      if (syndicationResponse.ok) {
        const syndicationPayload = await syndicationResponse.json();
        return json(200, await parseSyndication(syndicationPayload, url));
      }
    }

    const endpoint = `${OEMBED_ENDPOINT}?url=${encodeURIComponent(url)}&omit_script=1&dnt=1`;
    const response = await fetch(endpoint, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      return json(response.status, {
        ok: false,
        error: 'Could not fetch that tweet. Make sure the post is public.',
      });
    }

    const payload = await response.json();
    return json(200, parseOembed(payload, url));
  } catch (error) {
    return json(400, {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not read that tweet URL.',
    });
  }
};
