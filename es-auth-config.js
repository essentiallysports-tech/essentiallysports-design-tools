(function () {
  'use strict';

  window.ES_AUTH_CONFIG = Object.freeze({
    // Public browser credentials for the ES Designer Supabase project.
    supabase: {
      url: 'https://xtdusejokbhtjlmijdca.supabase.co',
      anonKey: 'sb_publishable_1T9d9U0qXD5K-Ay-_43IVA_Qdd1dpHF',
    },

    // Domain-level access. Only emails from these domains can create/login.
    allowedDomains: ['essentiallysports.com'],

    // Exact approved accounts and exceptions that should remain authorized
    // even if the domain-level policy changes later.
    allowedEmails: [
      'bu8945@gmail.com',
      'designteam@essentiallysports.com',
    ],
  });
})();
