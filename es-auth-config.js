(function () {
  'use strict';

  window.ES_AUTH_CONFIG = Object.freeze({
    // Add your Supabase project values here. Once both are present, auth will
    // use Supabase automatically. Until then, local browser accounts remain as
    // a development fallback so the site does not lock everyone out mid-setup.
    supabase: {
      url: 'https://xtdusejokbhtjlmijdca.supabase.co',
      anonKey: 'sb_publishable_1T9d9U0qXD5K-Ay-_43IVA_Qdd1dpHF',
    },

    // Domain-level access. Only emails from these domains can create/login.
    allowedDomains: ['essentiallysports.com'],

    // Optional: add exact approved emails here if we ever need exceptions.
    // Example: allowedEmails: ['name@essentiallysports.com'],
    allowedEmails: [],
  });
})();
