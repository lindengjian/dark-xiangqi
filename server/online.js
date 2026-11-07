'use strict';
// Serve the exported Studio game and its room API from one local origin.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const {server} = require('./server');
const handler = server.listeners('request')[0];
server.removeListener('request', handler);
const gameFile = path.resolve(__dirname, '..', 'online.html');
function allowedHost(host) {
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return true;
  if (net.isIP(host) !== 4) return false;
  const p = host.split('.').map(Number);
  return p[0] === 10 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168);
}
server.on('request', (req, res) => {
  let url, authority;
  try { authority = new URL('http://' + req.headers.host); url = new URL(req.url, authority); }
  catch { res.writeHead(400); return res.end('Invalid request'); }
  if (!allowedHost(authority.hostname)) { res.writeHead(403); return res.end('Host not allowed'); }
  if (url.pathname.startsWith('/api/')) {
    if (req.headers.origin && req.headers.origin !== authority.origin) { res.writeHead(403); return res.end('Origin not allowed'); }
    // The request now comes from the page this process serves: same origin, literal local Host.
    delete req.headers.origin;
    req.headers.host = '127.0.0.1';
  }
  if ((url.pathname === '/' || url.pathname === '/play') && (req.method === 'GET' || req.method === 'HEAD')) {
    return fs.readFile(gameFile, 'utf8', (err, html) => {
      if (err) { res.writeHead(503, {'Content-Type':'text/plain; charset=utf-8'}); return res.end('请先导出 Game Studio 游戏。'); }
      const patched = html.replace("connect-src 'none'", "connect-src 'self'");
      if (patched === html) { res.writeHead(500); return res.end('Unexpected game security policy'); }
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      res.end(req.method === 'HEAD' ? undefined : patched);
    });
  }
  return handler(req, res);
});
const port = Number(process.env.PORT || 3218);
const host = process.env.HOST || '127.0.0.1';
server.listen(port, host, () => console.log(`双人暗棋服务已启动：${host}:${server.address().port}`));
