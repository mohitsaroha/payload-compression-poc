// Test client: measures the bytes actually received over the network (wire)
// versus the JSON size after decompression.
//
// Uses Node's raw `http` module on purpose: it does NOT send Accept-Encoding by
// default and does NOT auto-decompress, so we can see the true wire size.
//
// Usage:
//   node client.js                      # runs both tests on all endpoints
//   node client.js "br"                 # second test uses a custom Accept-Encoding value
const http = require('http');
const zlib = require('zlib');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const ENDPOINTS = ['tiny', 'small', 'medium', 'large'];

const TESTS = [
  { label: 'WITHOUT Accept-Encoding', acceptEncoding: null },
  { label: 'WITH Accept-Encoding', acceptEncoding: process.argv[2] || 'gzip, deflate, br' },
];

function decompress(buf, encoding) {
  switch (encoding) {
    case 'gzip': return zlib.gunzipSync(buf);
    case 'deflate': return zlib.inflateSync(buf);
    case 'br': return zlib.brotliDecompressSync(buf);
    default: return buf;
  }
}

function fetchRaw(path, acceptEncoding) {
  return new Promise((resolve, reject) => {
    const headers = { Accept: 'application/json' };
    if (acceptEncoding) headers['Accept-Encoding'] = acceptEncoding;

    // agent: false -> a fresh TCP connection per request, so socket.bytesRead
    // counts exactly this one response (status line + headers + body).
    const req = http.get(BASE + path, { headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const wireBody = Buffer.concat(chunks);
        const encoding = res.headers['content-encoding'] || 'none';
        const decoded = decompress(wireBody, encoding);
        JSON.parse(decoded.toString('utf8')); // make sure it is valid JSON
        resolve({
          status: res.statusCode,
          encoding,
          totalOnWire: req.socket.bytesRead, // everything read from the network
          bodyOnWire: wireBody.length, // body bytes as transmitted (compressed or not)
          bodyDecoded: decoded.length, // JSON size after decompression
        });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}

const kb = (n) => (n / 1024).toFixed(2) + ' KB';
const pct = (saved, base) => (base ? ((saved / base) * 100).toFixed(1) + '%' : '-');

async function main() {
  const results = {};

  for (const test of TESTS) {
    console.log(`\n=== ${test.label}${test.acceptEncoding ? `: "${test.acceptEncoding}"` : ''} ===`);
    const rows = [];
    for (const name of ENDPOINTS) {
      const r = await fetchRaw(`/api/${name}`, test.acceptEncoding);
      (results[name] ||= []).push(r);
      rows.push({
        endpoint: `/api/${name}`,
        encoding: r.encoding,
        'JSON size (decoded)': kb(r.bodyDecoded),
        'body on wire': kb(r.bodyOnWire),
        'total on wire (incl. headers)': kb(r.totalOnWire),
        'body saved': pct(r.bodyDecoded - r.bodyOnWire, r.bodyDecoded),
      });
    }
    console.table(rows);
  }

  // Compare the two tests per endpoint, using total bytes on the wire.
  console.log('\n=== Network savings: WITH vs WITHOUT Accept-Encoding (total bytes on wire) ===');
  let sumWithout = 0;
  let sumWith = 0;
  const cmp = ENDPOINTS.map((name) => {
    const [without, withEnc] = results[name];
    sumWithout += without.totalOnWire;
    sumWith += withEnc.totalOnWire;
    return {
      endpoint: `/api/${name}`,
      'without header': kb(without.totalOnWire),
      'with header': kb(withEnc.totalOnWire),
      encoding: withEnc.encoding,
      saved: kb(without.totalOnWire - withEnc.totalOnWire),
      'saved %': pct(without.totalOnWire - withEnc.totalOnWire, without.totalOnWire),
    };
  });
  cmp.push({
    endpoint: 'TOTAL',
    'without header': kb(sumWithout),
    'with header': kb(sumWith),
    encoding: '',
    saved: kb(sumWithout - sumWith),
    'saved %': pct(sumWithout - sumWith, sumWithout),
  });
  console.table(cmp);
  console.log('Responses under 1 KB are not compressed (server threshold), so they show ~0% savings.');
}

main().catch((err) => {
  console.error('Request failed. Is the server running? (npm start)\n', err.message);
  process.exit(1);
});
