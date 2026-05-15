const https = require('https');
const fs = require('fs');
const path = require('path');

const url = 'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json';
const outputFile = path.join(process.cwd(), 'src', 'data', 'tokens.json');

console.log('Downloading scrip master...');
https.get(url, (res) => {
  let chunks = [];
  res.on('data', (chunk) => {
    chunks.push(chunk);
  });
  res.on('end', () => {
    console.log('Parsing JSON...');
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString());
      const tokenMap = {};
      for (const item of parsed) {
        if (item.exch_seg === 'NSE') {
          tokenMap[item.symbol] = item.token;
        }
      }
      fs.mkdirSync(path.dirname(outputFile), { recursive: true });
      fs.writeFileSync(outputFile, JSON.stringify(tokenMap));
      console.log('Successfully saved tokens.json with', Object.keys(tokenMap).length, 'tokens.');
    } catch (err) {
      console.error('Error parsing:', err);
    }
  });
}).on('error', (err) => {
  console.error('Failed to download:', err.message);
});
