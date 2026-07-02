(function () {
  'use strict';

  const EMAIL_ENDPOINT = 'https://vb3elvdtp5vl3wjbjvhp6hc4im0fioif.lambda-url.us-east-1.on.aws';

  function cleanString(value) {
    const result = String(value ?? '').trim();
    return result || undefined;
  }

  function cleanArray(values) {
    if (!Array.isArray(values)) return undefined;
    const result = values.map(cleanString).filter(Boolean);
    return result.length ? result : undefined;
  }

  function cleanRequester(requester = {}) {
    const result = {
      name: cleanString(requester.name),
      email: cleanString(requester.email),
    };
    return Object.values(result).some(Boolean) ? result : undefined;
  }

  function withoutEmptyValues(value) {
    return Object.fromEntries(
      Object.entries(value).filter(([, item]) => {
        if (item === undefined || item === null || item === '') return false;
        if (Array.isArray(item)) return item.length > 0;
        if (typeof item === 'object') return Object.values(item).some(Boolean);
        return true;
      })
    );
  }

  function payload(record = {}) {
    return withoutEmptyValues({
      id: cleanString(record.id),
      priority: cleanString(record.priority),
      requestType: cleanString(record.requestType),
      status: cleanString(record.status),
      publication: cleanString(record.publication),
      socialChannel: cleanString(record.socialChannel),
      sport: cleanString(record.sport),
      teamOrLeague: cleanString(record.teamOrLeague),
      requester: cleanRequester(record.requester),
      title: cleanString(record.title),
      entities: cleanString(record.entities),
      brief: cleanString(record.brief),
      designCopy: cleanString(record.designCopy),
      additionalNotes: cleanString(record.additionalNotes),
      designDueAt: cleanString(record.designDueAt),
      publishAt: cleanString(record.publishAt),
      referenceLinks: cleanArray(record.referenceLinks),
      createdAt: cleanString(record.createdAt),
    });
  }

  async function sendWithJson(body) {
    const response = await fetch(EMAIL_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const responseBody = await response.text().catch(() => '');
    if (!response.ok) {
      throw new Error(responseBody || `Email request failed with status ${response.status}`);
    }
    return { ok: true, direct: true, responseBody };
  }

  async function sendFireAndForget(body) {
    await fetch(EMAIL_ENDPOINT, {
      method: 'POST',
      mode: 'no-cors',
      keepalive: true,
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(body),
    });
    return { ok: true, direct: true, responseOpaque: true };
  }

  async function send(record) {
    const body = payload(record);
    try {
      return await sendWithJson(body);
    } catch (error) {
      if (error instanceof TypeError) return sendFireAndForget(body);
      throw error;
    }
  }

  window.ESDesignRequestEmail = Object.freeze({ send, payload });
})();
