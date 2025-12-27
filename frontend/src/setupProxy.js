const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  app.use(
    '/api',
    createProxyMiddleware({
      target: 'http://127.0.0.1:8010',
      changeOrigin: true,
      logLevel: 'debug',
      timeout: 360000, // 6 minutes for long-running requests like transcription (5+ min recordings)
      proxyTimeout: 360000, // Backend timeout (6 minutes)
    })
  );
};


