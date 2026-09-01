const express = require('express');
const path = require('path');
const fs = require('fs');

const originalStatic = express.static;
const livekitBundle = path.join(process.cwd(), 'node_modules', 'livekit-client', 'dist', 'livekit-client.umd.min.js');

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
      if (!fs.existsSync(livekitBundle)) return next(new Error('LiveKit browser bundle is missing'));
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.sendFile(livekitBundle);
    }
    return staticMiddleware(req, res, next);
  };
};
