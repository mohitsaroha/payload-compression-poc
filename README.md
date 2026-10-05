# Payload Compression POC

A small Node.js + Express proof of concept that shows how much network traffic HTTP response compression (gzip, deflate, Brotli) saves on JSON APIs, and how the server picks an encoding based on the client's `Accept-Encoding` header.

## Results

These are the total bytes read from the network (status line + headers + body) for each endpoint, by compression method:

| Endpoint      | JSON size | none      | gzip                | deflate             | br (Brotli)         |
| ------------- | --------- | --------- | ------------------- | ------------------- | ------------------- |
| `/api/tiny`   | 0.77 KB   | 1.00 KB   | 1.00 KB *(not compressed)* | 1.00 KB *(not compressed)* | 1.00 KB *(not compressed)* |
| `/api/small`  | 1.54 KB   | 1.77 KB   | 0.69 KB (−60.8%)    | 0.68 KB (−61.3%)    | 0.63 KB (−64.4%)    |
| `/api/medium` | 12.91 KB  | 13.14 KB  | 1.90 KB (−85.6%)    | 1.89 KB (−85.6%)    | 1.60 KB (−87.8%)    |
| `/api/large`  | 261.17 KB | 261.40 KB | 27.31 KB (−89.6%)   | 27.30 KB (−89.6%)   | 20.67 KB (−92.1%)   |
| **Total**     |           | 277.30 KB | 30.90 KB (−88.9%)   | 30.87 KB (−88.9%)   | 23.90 KB (−91.4%)   |

What the numbers show:

- Compression cuts JSON payloads by roughly **85–92%** once they are a few KB or larger.
- **Brotli (`br`)** compresses best. gzip and deflate are almost identical.
- Responses under the **1 KB threshold** (`/api/tiny`) are sent uncompressed. At that size the CPU cost isn't worth the few bytes saved.
- If the client sends no `Accept-Encoding` header, the server always responds uncompressed.

## How it works

- [server.js](server.js) is an Express server that uses the [`compression`](https://www.npmjs.com/package/compression) middleware with a 1 KB threshold. It serves generated JSON user records at four sizes and logs the negotiated `Content-Encoding` for each request.
- [client.js](client.js) requests every endpoint twice, once **without** and once **with** `Accept-Encoding`, and reports the savings.
- [compare.js](compare.js) requests every endpoint once per method (`none`, `gzip`, `deflate`, `br`) and prints a side-by-side comparison.

The clients use Node's raw `http` module on purpose. Unlike `fetch` or axios, it doesn't send `Accept-Encoding` by default and doesn't decompress automatically, so the true size on the wire can be measured. Each request opens a fresh TCP connection (`agent: false`), so `socket.bytesRead` counts exactly one response. Every body is decompressed and parsed as JSON to confirm it is valid.

## Endpoints

| Endpoint          | Records | Approx. size | Compressed? |
| ----------------- | ------- | ------------ | ----------- |
| `GET /api/tiny`   | 3       | ~0.8 KB      | No (below threshold) |
| `GET /api/small`  | 6       | ~1.5 KB      | Yes         |
| `GET /api/medium` | 50      | ~13 KB       | Yes         |
| `GET /api/large`  | 1000    | ~260 KB      | Yes         |

## Getting started

Requirements: Node.js 18 or later.

```bash
npm install
npm start            # starts the server on http://localhost:3000
```

In a second terminal:

```bash
npm run compare      # side-by-side: none vs gzip vs deflate vs br
npm run test-client  # with vs without Accept-Encoding
```

To try a specific encoding with the test client:

```bash
node client.js "br"
node client.js "gzip"
```

You can also check it with curl:

```bash
curl -s -o /dev/null -w "%{size_download} bytes\n" http://localhost:3000/api/large
curl -s -o /dev/null -w "%{size_download} bytes\n" -H "Accept-Encoding: br" http://localhost:3000/api/large
```

### Configuration

| Variable   | Default                 | Used by           |
| ---------- | ----------------------- | ----------------- |
| `PORT`     | `3000`                  | server            |
| `BASE_URL` | `http://localhost:3000` | client / compare  |

## Project structure

```
.
├── server.js      # Express server with compression middleware
├── client.js      # with vs without Accept-Encoding test
├── compare.js     # gzip vs deflate vs br comparison
└── package.json
```

## Takeaways

- Turn on response compression for JSON APIs. It costs almost nothing to set up and saves around 90% of bandwidth on medium and large payloads.
- Prefer Brotli where clients support it. All modern browsers do.
- Keep a minimum size threshold so tiny responses aren't compressed.
- In production, compression is often done at the reverse proxy or CDN (Nginx, Cloudflare, etc.) instead of in the Node process.
