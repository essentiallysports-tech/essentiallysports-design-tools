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
  const toolDropdownHost = document.getElementById('feedback-tool-dropdown');
  const typeHelper = document.getElementById('feedback-type-helper');

  const MAX_MESSAGE_LENGTH = 4000;
  const TYPE_HELPERS = {
    Bug: 'Include what you expected, what happened instead, and steps we can use to reproduce it.',
    Idea: 'Describe the workflow you want and the outcome it should help you achieve.',
    Praise: 'Tell us what is working well and what should remain unchanged.',
    Other: 'Share the context, page, or exact detail that will help us understand your note.',
  };

  function closeToolDropdown() {
    toolSelect?._toolDropdown?.classList.remove('is-open');
    toolSelect?._toolDropdown?.querySelector('.feedback-dropdown-trigger')?.setAttribute('aria-expanded', 'false');
  }

  function syncToolDropdown() {
    const dropdown = toolSelect?._toolDropdown;
    if (!dropdown) return;
    const selected = toolSelect.options[toolSelect.selectedIndex];
    const trigger = dropdown.querySelector('.feedback-dropdown-trigger');
    trigger.textContent = selected?.textContent || 'Select an option';
    dropdown.querySelectorAll('.feedback-dropdown-option').forEach(option => {
      const isSelected = option.dataset.value === toolSelect.value;
      option.classList.toggle('is-selected', isSelected);
      option.setAttribute('aria-selected', String(isSelected));
    });
  }

  function buildToolDropdown() {
    if (!toolSelect || !toolDropdownHost) return;

    const trigger = document.createElement('button');
    trigger.className = 'feedback-dropdown-trigger';
    trigger.type = 'button';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    const menu = document.createElement('div');
    menu.className = 'feedback-dropdown-menu';
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', 'Which tool is this about');

    Array.from(toolSelect.options).forEach(nativeOption => {
      const option = document.createElement('button');
      option.className = 'feedback-dropdown-option';
      option.type = 'button';
      option.dataset.value = nativeOption.value;
      option.textContent = nativeOption.textContent;
      option.setAttribute('role', 'option');
      option.addEventListener('click', () => {
        toolSelect.value = nativeOption.value;
        toolSelect.dispatchEvent(new Event('change', { bubbles: true }));
        syncToolDropdown();
        closeToolDropdown();
        trigger.focus();
      });
      menu.appendChild(option);
    });

    const options = Array.from(menu.querySelectorAll('.feedback-dropdown-option'));
    const selectedIndex = () => Math.max(0, options.findIndex(option => option.dataset.value === toolSelect.value));
    const focusOption = index => options[(index + options.length) % options.length]?.focus();
    const openDropdown = focusIndex => {
      toolDropdownHost.classList.add('is-open');
      trigger.setAttribute('aria-expanded', 'true');
      if (Number.isInteger(focusIndex)) focusOption(focusIndex);
    };

    trigger.addEventListener('click', () => {
      const willOpen = !toolDropdownHost.classList.contains('is-open');
      closeToolDropdown();
      if (willOpen) openDropdown();
    });
    trigger.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        closeToolDropdown();
        trigger.focus();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        openDropdown(selectedIndex());
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        openDropdown(selectedIndex() - 1);
      }
    });

    options.forEach((option, index) => {
      option.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          focusOption(index + 1);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          focusOption(index - 1);
        } else if (event.key === 'Home') {
          event.preventDefault();
          focusOption(0);
        } else if (event.key === 'End') {
          event.preventDefault();
          focusOption(options.length - 1);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          closeToolDropdown();
          trigger.focus();
        }
      });
    });

    toolDropdownHost.append(trigger, menu);
    toolSelect._toolDropdown = toolDropdownHost;
    syncToolDropdown();

    document.addEventListener('click', event => {
      if (!event.target.closest('.feedback-dropdown')) closeToolDropdown();
    });
  }

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

  function updateTypeHelper() {
    if (!typeHelper || !form) return;
    const selectedType = form.querySelector('input[name="feedbackType"]:checked')?.value || 'Other';
    typeHelper.textContent = TYPE_HELPERS[selectedType] || TYPE_HELPERS.Other;
  }

  async function showSignedInUser() {
    if (!signedInEl || !window.ESAuth?.getSession) return;
    try {
      const session = await window.ESAuth.getSession();
      const email = session?.user?.email;
      if (email) {
        const copy = signedInEl.querySelector('span') || signedInEl;
        copy.textContent = 'Signed in as ';
        const emailNode = document.createElement('strong');
        emailNode.textContent = email;
        copy.appendChild(emailNode);
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
    updateTypeHelper();
    syncToolDropdown();
    card.classList.remove('is-submitted');
    setStatus('');
    messageField.focus();
  }

  if (messageField) {
    messageField.addEventListener('input', updateCharCount);
    updateCharCount();
  }

  form?.querySelectorAll('input[name="feedbackType"]').forEach(input => {
    input.addEventListener('change', updateTypeHelper);
  });

  if (form) form.addEventListener('submit', submitFeedback);
  if (resetButton) resetButton.addEventListener('click', resetForm);

  preselectTool();
  buildToolDropdown();
  updateTypeHelper();
  showSignedInUser();
})();
