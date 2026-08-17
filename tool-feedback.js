(() => {
  'use strict';

  const form = document.getElementById('feedback-form');
  const card = document.getElementById('feedback-card');
  const messageField = document.getElementById('feedback-message');
  const charCount = document.getElementById('feedback-charcount');
  const submitButton = document.getElementById('feedback-submit');
  const statusEl = document.getElementById('feedback-status');
  const signedInEl = document.getElementById('feedback-signed-in');
  const resetButton = document.getElementById('feedback-reset');
  const toolSelect = document.getElementById('feedback-tool');

  const MAX_MESSAGE_LENGTH = 4000;

  function setStatus(message, isError) {
    if (!statusEl) return;
    statusEl.textContent = message || '';
    statusEl.classList.toggle('is-error', Boolean(message) && Boolean(isError));
    statusEl.style.display = message ? 'block' : 'none';
  }

  function setLoading(isLoading) {
    if (!submitButton) return;
    submitButton.disabled = isLoading;
    submitButton.classList.toggle('is-loading', isLoading);
  }

  function preselectTool() {
    if (!toolSelect) return;
    const params = new URLSearchParams(window.location.search);
    const requested = (params.get('tool') || '').toLowerCase();
    if (!requested) return;
    const match = Array.from(toolSelect.options).find(option => option.value.toLowerCase() === requested);
    if (match) toolSelect.value = match.value;
  }

  function updateCharCount() {
    if (!messageField || !charCount) return;
    charCount.textContent = `${messageField.value.length} / ${MAX_MESSAGE_LENGTH}`;
  }

  async function showSignedInUser() {
    if (!signedInEl || !window.ESAuth?.getSession) return;
    try {
      const session = await window.ESAuth.getSession();
      const email = session?.user?.email;
      if (email) {
        signedInEl.innerHTML = `Signed in as <strong>${email.replace(/</g, '&lt;')}</strong>`;
      }
    } catch {
      // Leave the default copy in place.
    }
  }

  async function submitFeedback(event) {
    event.preventDefault();
    if (!window.ESAuth?.fetchWithAuth) {
      setStatus('Please log in again to send feedback.', true);
      return;
    }

    const message = messageField.value.trim();
    if (!message) {
      setStatus('Add a quick note before sending.', true);
      messageField.focus();
      return;
    }

    const feedbackType = form.querySelector('input[name="feedbackType"]:checked')?.value || 'Other';
    const tool = toolSelect ? toolSelect.value : 'General';

    setStatus('');
    setLoading(true);

    try {
      const response = await window.ESAuth.fetchWithAuth('/api/tool-feedback-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          feedbackType,
          tool,
          pageUrl: document.referrer || window.location.href,
        }),
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok || result.ok === false) {
        throw new Error(result.error || 'Could not send your feedback. Please try again.');
      }

      card.classList.add('is-submitted');
      setStatus('');
    } catch (error) {
      setStatus(error.message || 'Could not send your feedback. Please try again.', true);
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    form.reset();
    updateCharCount();
    card.classList.remove('is-submitted');
    setStatus('');
    messageField.focus();
  }

  if (messageField) {
    messageField.addEventListener('input', updateCharCount);
    updateCharCount();
  }

  if (form) form.addEventListener('submit', submitFeedback);
  if (resetButton) resetButton.addEventListener('click', resetForm);

  preselectTool();
  showSignedInUser();
})();
