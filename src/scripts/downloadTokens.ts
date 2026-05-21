import https from 'https';
import fs from 'fs';
import path from 'path';

const url = 'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json';
const outputFile = path.join(process.cwd(), 'src', 'data', 'tokens.json');

console.log('Downloading scrip master...');
https.get(url, (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    console.log('Parsing JSON...');
    try {
      const parsed = JSON.parse(data);
      const tokenMap: Record<string, string> = {};
      for (const item of parsed) {
        if (item.exch_seg === 'NSE') {
          tokenMap[item.symbol] = item.token;
        }
      }
      fs.mkdirSync(path.dirname(outputFile), { recursive: true });
      fs.writeFileSync(outputFile, JSON.stringify(tokenMap));
      console.log('Successfully saved tokens.json with', Object.keys(tokenMap).length, 'tokens.');
    } catch (e: any) {
      console.error('Error parsing JSON:', e.message);
    }
  });
}).on('error', (err) => {
  console.error('Failed to download:', err.message);
});
