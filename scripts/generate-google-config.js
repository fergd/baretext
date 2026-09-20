const fs = require('fs');
const path = require('path');

const config = {
  clientId: process.env.BARETEXT_GOOGLE_CLIENT_ID || '',
  clientSecret: process.env.BARETEXT_GOOGLE_CLIENT_SECRET || '',
  pickerApiKey: process.env.BARETEXT_GOOGLE_PICKER_API_KEY || '',
};

const target = path.join(__dirname, '..', 'src', 'google-drive-config.generated.js');
fs.writeFileSync(target, `// Generated at build time. Do not commit.\nmodule.exports = ${JSON.stringify(config, null, 2)};\n`, 'utf8');
