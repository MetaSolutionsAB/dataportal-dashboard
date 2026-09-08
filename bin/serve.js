#!/usr/bin/env node
/**
 * Minimal statisk webbserver för lokal utveckling: node bin/serve.js [port]
 * I produktion kan public/ serveras av valfri webbserver (nginx, Apache ...).
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const port = Number(process.argv[2] ?? process.env.PORT ?? 8080);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

createServer(async (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const filePath = path.resolve(root, rel);
  if (!filePath.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const s = await stat(filePath);
    if (!s.isFile()) throw new Error('not a file');
    res.writeHead(200, { 'Content-Type': types[path.extname(filePath)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Hittades inte');
  }
}).listen(port, () => console.log(`Dashboard: http://localhost:${port}/`));
