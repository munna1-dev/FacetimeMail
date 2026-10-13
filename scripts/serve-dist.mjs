import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const root = resolve('apps/web/dist');
const port = Number(process.env.WEB_PORT || 4173);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8'
};

createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end('Method not allowed');
  }

  try {
    const pathname = new URL(
      req.url || '/',
      'http://127.0.0.1'
    ).pathname;

    let requestedPath = resolve(
      root,
      '.' + decodeURIComponent(pathname)
    );

    if (
      requestedPath !== root &&
      !requestedPath.startsWith(root + sep)
    ) {
      res.writeHead(403);
      return res.end('Forbidden');
    }

    let content;

    try {
      content = await readFile(requestedPath);
    } catch {
      // Serve the app entry point for client-side routes.
      requestedPath = resolve(root, 'index.html');
      content = await readFile(requestedPath);
    }

    res.writeHead(200, {
      'Content-Type':
        types[extname(requestedPath)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache'
    });

    res.end(req.method === 'HEAD' ? undefined : content);
  } catch {
    res.writeHead(500);
    res.end('Unable to serve the requested file');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`FactorMailService frontend: http://127.0.0.1:${port}`);
});
