// Side-by-side comparison of every compression method.
// For each endpoint, requests it once per Accept-Encoding value and reports
// the total bytes read from the network (status line + headers + body).
//
// Usage: node compare.js   (server must be running: npm start)
const http = require('http');
const zlib = require('zlib');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const ENDPOINTS = ['tiny', 'small', 'medium', 'large'];
const METHODS = [
  { label: 'none', acceptEncoding: null },
  { label: 'gzip', acceptEncoding: 'gzip' },
  { label: 'deflate', acceptEncoding: 'deflate' },
  { label: 'br', acceptEncoding: 'br' },
];

const decoders = { gzip: zlib.gunzipSync, deflate: zlib.inflateSync, br: zlib.brotliDecompressSync };

function fetchRaw(path, acceptEncoding) {
  return new Promise((resolve, reject) => {
    const headers = { Accept: 'application/json' };
    if (acceptEncoding) headers['Accept-Encoding'] = acceptEncoding;
    // agent: false -> fresh connection, so socket.bytesRead is exactly this response.
    const req = http.get(BASE + path, { headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const encoding = res.headers['content-encoding'] || 'none';
        const body = Buffer.concat(chunks);
        const decoded = decoders[encoding] ? decoders[encoding](body) : body;
        JSON.parse(decoded.toString('utf8'));
        resolve({ encoding, wire: req.socket.bytesRead, decoded: decoded.length });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}

const kb = (n) => (n / 1024).toFixed(2) + ' KB';
const pct = (part, base) => ((1 - part / base) * 100).toFixed(1) + '%';

async function main() {
  const sizeRows = [];
  const savedRows = [];
  const totals = Object.fromEntries(METHODS.map((m) => [m.label, 0]));

  for (const name of ENDPOINTS) {
    const sizeRow = { endpoint: `/api/${name}` };
    const savedRow = { endpoint: `/api/${name}` };
    let baseline;
    for (const m of METHODS) {
      const r = await fetchRaw(`/api/${name}`, m.acceptEncoding);
      if (m.label === 'none') {
        baseline = r.wire;
        sizeRow['JSON size'] = kb(r.decoded);
      }
      totals[m.label] += r.wire;
      // Mark when the server did not apply the requested method (e.g. under 1 KB threshold).
      const note = m.label !== 'none' && r.encoding !== m.label ? ' (not compressed)' : '';
      sizeRow[m.label] = kb(r.wire) + note;
      if (m.label !== 'none') savedRow[m.label] = `${kb(baseline - r.wire)} (${pct(r.wire, baseline)})`;
    }
    sizeRows.push(sizeRow);
    savedRows.push(savedRow);
  }

  const totalSize = { endpoint: 'TOTAL', 'JSON size': '' };
  const totalSaved = { endpoint: 'TOTAL' };
  for (const m of METHODS) {
    totalSize[m.label] = kb(totals[m.label]);
    if (m.label !== 'none') {
      totalSaved[m.label] = `${kb(totals.none - totals[m.label])} (${pct(totals[m.label], totals.none)})`;
    }
  }
  sizeRows.push(totalSize);
  savedRows.push(totalSaved);

  console.log('\n=== Total bytes on the wire per method (headers + body) ===');
  console.table(sizeRows);
  console.log('\n=== Saved vs no compression ===');
  console.table(savedRows);
}

main().catch((err) => {
  console.error('Request failed. Is the server running? (npm start)\n', err.message);
  process.exit(1);
});
