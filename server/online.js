'use strict';
// Serve the game page and its room API from one origin.
// Behind a reverse proxy (Caddy/nginx/Traefik) this is plain HTTP on a private port.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const {server} = require('./server');
const handler = server.listeners('request')[0];
server.removeListener('request', handler);
// 页面直接取 Game Studio 的导出产物，合并后只有一份页面源文件。
const gameFile = path.resolve(__dirname, '..', 'export', 'dark-xiangqi.html');

// Hosts this process answers for. Loopback and RFC1918 are always allowed so the
// same image works for LAN play; set ALLOWED_HOSTS=xiangqi.example.com for a
// public deployment (comma separated, no scheme or port).
const extraHosts = new Set((process.env.ALLOWED_HOSTS || '').split(',')
  .map(s => s.trim().toLowerCase()).filter(Boolean));
const trustAnyHost = process.env.TRUST_ANY_HOST === '1';
function allowedHost(host) {
  const name = host.toLowerCase();
  if (trustAnyHost || extraHosts.has(name)) return true;
  if (name === 'localhost' || name === '127.0.0.1' || name === '[::1]') return true;
  if (net.isIP(name) !== 4) return false;
  const p = name.split('.').map(Number);
  return p[0] === 10 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168);
}
// A reverse proxy terminates TLS, so the browser's Origin is https:// while the
// upstream connection is plain http. Trust the forwarded scheme only when the
// proxy is the one we expect; otherwise keep the literal connection scheme.
const trustProto = process.env.TRUST_PROXY === '1';
function requestOrigin(req, authority) {
  if (!trustProto) return authority.origin;
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return proto === 'https' || proto === 'http' ? `${proto}://${authority.host}` : authority.origin;
}

server.on('request', (req, res) => {
  let url, authority;
  try { authority = new URL('http://' + req.headers.host); url = new URL(req.url, authority); }
  catch { res.writeHead(400); return res.end('Invalid request'); }
  if (!allowedHost(authority.hostname)) { res.writeHead(403); return res.end('Host not allowed'); }
  // Container probes must not depend on the public Host header.
  if (url.pathname === '/healthz') {
    res.writeHead(200, {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store'});
    return res.end('ok\n');
  }
  if (url.pathname.startsWith('/api/')) {
    if (req.headers.origin && req.headers.origin !== requestOrigin(req, authority)) {
      res.writeHead(403); return res.end('Origin not allowed');
    }
    // The request now comes from the page this process serves: same origin, literal local Host.
    delete req.headers.origin;
    req.headers.host = '127.0.0.1';
  }
  if ((url.pathname === '/' || url.pathname === '/play') && (req.method === 'GET' || req.method === 'HEAD')) {
    return fs.readFile(gameFile, 'utf8', (err, html) => {
      if (err) { res.writeHead(503, {'Content-Type':'text/plain; charset=utf-8'}); return res.end('缺少 export/dark-xiangqi.html，请先在 Game Studio 里构建并导出。'); }
      // The exported page ships with connect-src 'none'; the room API lives on this origin.
      const patched = html.replace("connect-src 'none'", "connect-src 'self'");
      if (patched === html) { res.writeHead(500); return res.end('Unexpected game security policy'); }
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      res.end(req.method === 'HEAD' ? undefined : patched);
    });
  }
  return handler(req, res);
});
const port = Number(process.env.PORT || 3218);
const host = process.env.HOST || '0.0.0.0';
server.listen(port, host, () => console.log(`暗棋服务已启动：${host}:${server.address().port}`));
process.on('SIGTERM', () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); });
