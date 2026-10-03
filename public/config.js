// Runtime configuration. Safe to commit: the backend rejects requests without the desk access key.
window.APP_CONFIG = {
  // Google Apps Script Web App URL (ends in /exec). Leave empty to run in demo mode with sample data.
  API_URL: '',

  EVENT_NAME: 'PMI UAE Chapter Annual Gathering Meeting 2026',

  // Options in the "Add guest / speaker" form. The first one is pre-selected.
  GUEST_TYPES: ['Speaker', 'Guest', 'VIP', 'Sponsor', 'Volunteer'],

  // How often each desk pulls other desks' check-ins (ms).
  POLL_MS: 8000,

  // How often the full registration list is reloaded, to pick up late registrations (ms).
  FULL_RELOAD_MS: 180000,
};
