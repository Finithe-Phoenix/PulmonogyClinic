import { createServer, request } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
const root = resolve('dist/portal/browser');
const upstream = new URL(process.env.API_UPSTREAM || 'http://127.0.0.1:8181');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
createServer(async (req, res) => {
  if (!['localhost:4180', '127.0.0.1:4180'].includes(req.headers.host) || !req.url.startsWith('/') || req.url.startsWith('//')) { res.writeHead(400).end(); return; }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://localhost:8180; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path.startsWith('/api/')) {
    if (!['GET', 'POST'].includes(req.method)) { res.writeHead(405).end(); return; }
    if (req.headers.origin && req.headers.origin !== 'http://localhost:4180') { res.writeHead(403).end(); return; }
    if (Number(req.headers['content-length']) > 65536) { res.writeHead(413).end(); return; }
    // Forward only explicit Bearer credentials, never browser cookies or user-controlled host headers.
    const headers = {};
    for (const key of ['authorization', 'content-type', 'idempotency-key']) if (req.headers[key]) headers[key] = req.headers[key];
    const proxy = request(new URL(req.url, upstream), { method: req.method, headers, timeout: 15000 }, result => {
      res.writeHead(result.statusCode, { 'Content-Type': result.headers['content-type'] || 'application/json' });
      result.pipe(res);
    });
    let size = 0;
    req.on('data', chunk => { size += chunk.length; if (size > 65536) { res.writeHead(413).end(); proxy.destroy(); } });
    proxy.on('timeout', () => proxy.destroy());
    proxy.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(proxy);
    return;
  }
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
  try {
    const file = resolve(root, path === '/' ? 'index.html' : decodeURIComponent(path).slice(1));
    if (!file.startsWith(root + sep)) { res.writeHead(404).end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(404).end(); }
}).listen(4180, process.env.PORTAL_BIND || '127.0.0.1');
