import https from 'https';
import fs from 'fs';
import path from 'path';

const url = 'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json';
const outputFile = path.join(process.cwd(), 'data', 'tokens.json'); // We have a /data directory based on ls

console.log('Downloading scrip master...');
https.get(url, (res) => {
  if (res.statusCode !== 200) {
    console.error('Failed to download, status:', res.statusCode);
    return;
  }
  let chunks: Buffer[] = [];
  res.on('data', (chunk) => {
    chunks.push(chunk);
  });
  res.on('end', () => {
    console.log('Parsing JSON...');
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString());
      const tokenMap: Record<string, string> = {};
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
