// Release configuration for the consumer Google Drive integration.
// `google-drive-config.generated.js` is created by the build from CI secrets
// and is intentionally gitignored. Environment variables remain useful when
// running `electron .` locally.
let generated = {};
try { generated = require('./google-drive-config.generated'); } catch (_) { /* development checkout */ }

module.exports = {
  clientId: generated.clientId || process.env.BARETEXT_GOOGLE_CLIENT_ID || '',
  clientSecret: generated.clientSecret || process.env.BARETEXT_GOOGLE_CLIENT_SECRET || '',
  pickerApiKey: generated.pickerApiKey || process.env.BARETEXT_GOOGLE_PICKER_API_KEY || '',
};
