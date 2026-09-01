const express = require('express');

const originalStatic = express.static;

express.static = function sawalefStatic(root, options = {}) {
  const previousSetHeaders = options.setHeaders;
  return originalStatic(root, {
    ...options,
    maxAge: 0,
    immutable: false,
    etag: true,
    lastModified: true,
    setHeaders(res, filePath, stat) {
      // Sawalef changes frequently while voice is being tuned. Never let a browser
      // or service worker sit on an old JS/HTML response for an hour.
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      if (typeof previousSetHeaders === 'function') previousSetHeaders(res, filePath, stat);
    },
  });
};
