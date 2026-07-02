(function () {
  'use strict';

  // No webhook is hardcoded here on purpose: this file ships to every visitor's
  // browser, so a Slack webhook baked in here would be public. Slack delivery is
  // handled server-side by api/design-request-submit.js using the
  // SLACK_DESIGN_REQUEST_WEBHOOK_URL environment variable instead.
  const WEBHOOK_URL = '';

  function text(value, fallback = 'Not provided') {
    const result = String(value ?? '').trim();
    if (!result) return fallback;
    return result
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .slice(0, 2800);
  }

  function date(value) {
    if (!value) return 'Not provided';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return text(value);
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'America/New_York',
    }).format(parsed) + ' ET';
  }

  function requestType(value) {
    return {
      newsletter: 'Newsletter Graphic',
      'web-feature': 'Web Feature Image',
      social: 'Social Media Graphic',
    }[value] || text(value);
  }

  function priority(value) {
    const normalized = String(value || 'Normal').toLowerCase();
    if (normalized === 'urgent') return { label: '🔴 Urgent', color: '#D92D20' };
    if (normalized === 'high') return { label: '🟠 High', color: '#F79009' };
    return { label: '🔵 Normal', color: '#0A7DFA' };
  }

  function links(values) {
    if (!Array.isArray(values) || !values.length) return 'None';
    return values
      .slice(0, 8)
      .map((value, index) => {
        const url = String(value || '').trim();
        return url ? `<${url.replace(/>/g, '%3E')}|Reference ${index + 1}>` : '';
      })
      .filter(Boolean)
      .join('  •  ') || 'None';
  }

  function fileNames(values) {
    if (!Array.isArray(values) || !values.length) return 'None';
    return values.map(file => text(file?.name || '')).filter(Boolean).join(', ') || 'None';
  }

  function payload(record) {
    const requestPriority = priority(record.priority);
    const requesterName = text(record.requester?.name);
    const requesterEmail = String(record.requester?.email || '').trim();
    const requester = requesterEmail
      ? `${requesterName}\n<mailto:${requesterEmail.replace(/>/g, '')}|${text(requesterEmail)}>`
      : requesterName;
    const title = record.title || record.entities || requestType(record.requestType);
    const location = [
      record.publication,
      record.socialChannel,
      record.sport,
      record.teamOrLeague,
    ].filter(Boolean).map(value => text(value)).join(' • ') || 'Not provided';

    return {
      text: `New design request ${record.id}: ${text(title)}`,
      attachments: [{
        color: requestPriority.color,
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: '🎨 New Design Request', emoji: true },
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Request ID*\n\`${text(record.id)}\`` },
              { type: 'mrkdwn', text: `*Priority*\n${requestPriority.label}` },
              { type: 'mrkdwn', text: `*Request Type*\n${requestType(record.requestType)}` },
              { type: 'mrkdwn', text: `*Requester*\n${requester}` },
              { type: 'mrkdwn', text: `*Publication / Channel*\n${location}` },
              { type: 'mrkdwn', text: `*Status*\n${text(record.status || 'New')}` },
            ],
          },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `*Title / Entities*\n${text(title)}` },
          },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `*Creative Brief*\n${text(record.brief)}` },
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Design Copy*\n${text(record.designCopy)}` },
              { type: 'mrkdwn', text: `*Additional Notes*\n${text(record.additionalNotes)}` },
            ],
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Design Needed By*\n${date(record.designDueAt)}` },
              { type: 'mrkdwn', text: `*Publish At*\n${date(record.publishAt)}` },
            ],
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*References*\n${links(record.referenceLinks)}\n*Files:* ${fileNames(record.referenceFiles)}`,
            },
          },
          {
            type: 'context',
            elements: [{
              type: 'mrkdwn',
              text: `Submitted ${date(record.createdAt)} via ${text(record.source || 'ES Designer')}`,
            }],
          },
        ],
      }],
    };
  }

  async function send(record) {
    if (!WEBHOOK_URL) return { ok: false, skipped: true, reason: 'not_configured' };
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      mode: 'no-cors',
      keepalive: true,
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(payload(record)),
    });
    return { ok: true, direct: true, responseOpaque: true };
  }

  window.ESDesignRequestSlack = Object.freeze({ send, payload });
})();
