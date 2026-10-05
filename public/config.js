// Runtime configuration. Safe to commit: the backend rejects requests without the desk access key.
window.APP_CONFIG = {
  // Google Apps Script Web App URL (ends in /exec). Leave empty to run in demo mode with sample data.
  API_URL: 'https://script.google.com/macros/s/AKfycbxLRngFTLFM8CqBCwJkVHV6phxu_GDKL7iLTuYOHtr-vXqUcW8JtoIiCr3l9gtvcYzp/exec',

  EVENT_NAME: 'PMI UAE Chapter Annual Gathering Meeting 2026',

  // Options in the "Add guest / speaker" form. The first one is pre-selected.
  GUEST_TYPES: ['Speaker', 'Board Member', 'VIP', 'Partner', 'Volunteer', 'Guest', 'Delegate - AI', 'Delegate - Sustainability'],

  // Card colour per walk-in type. Any type not listed gets DEFAULT_GUEST_LANYARD.
  // Registered delegates from the sheet: AI = BLUE, Sustainability = GREEN.
  // Colours: WHITE, BLUE, GREEN, RED, YELLOW.
  GUEST_LANYARDS: { 'Delegate - AI': 'BLUE', 'Delegate - Sustainability': 'GREEN' },
  DEFAULT_GUEST_LANYARD: 'WHITE',

  // How often each desk pulls other desks' check-ins (ms).
  POLL_MS: 8000,

  // How often the full registration list is reloaded, to pick up late registrations (ms).
  FULL_RELOAD_MS: 180000,
};
