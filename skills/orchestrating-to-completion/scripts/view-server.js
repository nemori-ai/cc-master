#!/usr/bin/env node
// cc-master board view server —— dependency-free local webview for a board's task DAG.
//
// Red line 1 (ADR-006): node/JS only, no jq/python/tsx. Pure stdlib http/fs.
// Red line 5 (ship-anywhere): binds 127.0.0.1 only, serves locally vendored assets —
//   ZERO network access at runtime. Everything under ./vendor/ is self-contained.
//
// Usage:  CC_MASTER_BOARD=/abs/path/to/<ts>-<pid>.board.json node view-server.js
// Prints exactly one line:  cc-master board view: http://127.0.0.1:<port>
// so a launcher can scrape the URL. Bind port 0 => OS picks a free port.

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const BOARD_PATH = process.env.CC_MASTER_BOARD;
if (!BOARD_PATH) {
  console.error('cc-master board view: ERROR — CC_MASTER_BOARD env (absolute board path) is required');
  process.exit(1);
}

// Resolve served files relative to THIS script, never cwd (the launcher may run from anywhere).
const SCRIPT_DIR = __dirname;
const VENDOR_DIR = path.join(SCRIPT_DIR, 'vendor');
const HTML_PATH = path.join(SCRIPT_DIR, 'view.html');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

function contentType(file) {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function sendNotFound(res, body) {
  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body !== undefined ? body : '{}');
}

const server = http.createServer((req, res) => {
  // Only GET is supported (read-only viewer).
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method Not Allowed');
    return;
  }

  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
  } catch (_e) {
    sendNotFound(res);
    return;
  }

  // GET / -> view.html
  if (urlPath === '/' || urlPath === '/index.html') {
    fs.readFile(HTML_PATH, (err, buf) => {
      if (err) {
        sendNotFound(res, 'view.html not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': CONTENT_TYPES['.html'], 'Cache-Control': 'no-store' });
      res.end(buf);
    });
    return;
  }

  // GET /favicon.ico -> 204 No Content. The viewer ships no icon; without this the
  // browser's automatic favicon request logs a lone 404 in the console. Silence it.
  if (urlPath === '/favicon.ico') {
    res.writeHead(204, { 'Cache-Control': 'no-store' });
    res.end();
    return;
  }

  // GET /board.json -> read the board fresh each request (no cache). Board may be
  // mid-write by the orchestrator; on any read/parse failure return 404 + {} so the
  // client just retries on its next poll (no crash, no stale cache).
  if (urlPath === '/board.json') {
    fs.readFile(BOARD_PATH, 'utf8', (err, txt) => {
      if (err) {
        sendNotFound(res);
        return;
      }
      try {
        JSON.parse(txt); // validate; if it's a torn write we 404 and let client retry
      } catch (_e) {
        sendNotFound(res);
        return;
      }
      res.writeHead(200, {
        'Content-Type': CONTENT_TYPES['.json'],
        'Cache-Control': 'no-store',
      });
      res.end(txt);
    });
    return;
  }

  // GET /vendor/* -> serve locally vendored assets, guarded against path traversal.
  if (urlPath.startsWith('/vendor/')) {
    const rel = urlPath.slice('/vendor/'.length);
    const resolved = path.resolve(VENDOR_DIR, rel);
    // Containment check: resolved must stay inside VENDOR_DIR.
    if (resolved !== VENDOR_DIR && !resolved.startsWith(VENDOR_DIR + path.sep)) {
      sendNotFound(res);
      return;
    }
    fs.readFile(resolved, (err, buf) => {
      if (err) {
        sendNotFound(res);
        return;
      }
      res.writeHead(200, {
        'Content-Type': contentType(resolved),
        'Cache-Control': 'no-store',
      });
      res.end(buf);
    });
    return;
  }

  sendNotFound(res);
});

// listen(0) => OS assigns a free port. Bind 127.0.0.1 only (no external exposure).
server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  // Exactly one machine-scrapeable line.
  console.log('cc-master board view: http://127.0.0.1:' + port);
});

server.on('error', (err) => {
  console.error('cc-master board view: ERROR — ' + err.message);
  process.exit(1);
});
