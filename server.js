const express = require('express');
const compression = require('compression');

const PORT = process.env.PORT || 3000;
const THRESHOLD = 1024; // only compress responses >= 1 KB

const app = express();

// Compression is negotiated per request from the client's Accept-Encoding header.
// No header (or "identity") -> response is sent uncompressed.
app.use(compression({ threshold: THRESHOLD }));

// Log what was negotiated for each request.
app.use((req, res, next) => {
  res.on('finish', () => {
    console.log(
      `${req.method} ${req.originalUrl}  accept-encoding="${req.headers['accept-encoding'] || '(none)'}"` +
        `  -> content-encoding="${res.getHeader('content-encoding') || 'none'}"`
    );
  });
  next();
});

// Builds a realistic-looking JSON list of `count` records.
function makeRecords(count) {
  const statuses = ['ACTIVE', 'INACTIVE', 'PENDING', 'SUSPENDED'];
  const cities = ['Delhi', 'Mumbai', 'Bengaluru', 'Gurugram', 'Pune', 'Hyderabad'];
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    uuid: `a1b2c3d4-${String(i).padStart(4, '0')}-4e5f-9a8b-${String(i * 7919).padStart(12, '0')}`,
    name: `User ${i + 1}`,
    email: `user${i + 1}@example.com`,
    status: statuses[i % statuses.length],
    address: { city: cities[i % cities.length], country: 'IN', pincode: String(110000 + i) },
    createdAt: new Date(Date.UTC(2026, 0, 1) + i * 3600_000).toISOString(),
    tags: ['customer', i % 2 ? 'premium' : 'standard'],
    score: Math.round(((i * 37) % 1000) / 10),
  }));
}

// Endpoints of different sizes so you can see the 1 KB threshold in action.
const payloads = {
  tiny: { data: makeRecords(3) }, // ~0.8 KB, under the 1 KB threshold -> never compressed
  small: { data: makeRecords(6) }, // ~1.5 KB, just over the threshold -> compressed
  medium: { data: makeRecords(50) }, // around 15 KB
  large: { data: makeRecords(1000) }, // around 300 KB
};

app.get('/api/:size', (req, res) => {
  const payload = payloads[req.params.size];
  if (!payload) return res.status(404).json({ error: 'use one of: ' + Object.keys(payloads).join(', ') });
  res.json(payload);
});

app.listen(PORT, () => {
  console.log(`Server on http://localhost:${PORT}  (compression threshold ${THRESHOLD} bytes)`);
  console.log('Endpoints: ' + Object.keys(payloads).map((k) => `/api/${k}`).join(', '));
});
