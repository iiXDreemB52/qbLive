const express = require('express');
const path = require('path');
const fs = require('fs');

const originalStatic = express.static;
const livekitDist = path.join(process.cwd(), 'node_modules', 'livekit-client', 'dist');
const livekitCandidates = [
  path.join(livekitDist, 'livekit-client.umd.min.js'),
  path.join(livekitDist, 'livekit-client.umd.js'),
];

function resolveLivekitBundle() {
  return livekitCandidates.find(file => fs.existsSync(file)) || '';
}

express.static = function sawalefStatic(root, options = {}) {
  const previousSetHeaders = options.setHeaders;
  const staticMiddleware = originalStatic(root, {
    ...options,
    maxAge: 0,
    immutable: false,
    etag: true,
    lastModified: true,
    setHeaders(res, filePath, stat) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      if (typeof previousSetHeaders === 'function') previousSetHeaders(res, filePath, stat);
    },
  });

  return function sawalefStaticWithVendor(req, res, next) {
    const pathname = String(req.path || req.url || '').split('?')[0];
    if (pathname === '/vendor/livekit-client.umd.min.js') {
      const livekitBundle = resolveLivekitBundle();
      if (!livekitBundle) {
        console.error('LiveKit browser bundle is missing. Checked:', livekitCandidates.join(', '));
        return res.status(503).type('text/plain').send('LiveKit browser bundle unavailable');
      }
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.sendFile(livekitBundle);
    }
    return staticMiddleware(req, res, next);
  };
};
