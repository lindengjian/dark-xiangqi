'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const game = require('./game');
const rooms = new Map();
const publicDir = path.join(__dirname,'public');
// Cross-origin Studio access is opt-in. Only exact loopback origins are accepted;
// opaque "null" origins (file: and sandboxed frames) require a separate opt-in.
const studioOrigins = new Set((process.env.STUDIO_ORIGINS || '').split(',').map(s=>s.trim()).filter(Boolean));
for (const origin of studioOrigins) {
  let u; try { u=new URL(origin); } catch { throw new Error('Invalid STUDIO_ORIGINS entry'); }
  if (!['http:','https:'].includes(u.protocol) || !['localhost','127.0.0.1','[::1]'].includes(u.hostname) || u.origin !== origin) throw new Error('STUDIO_ORIGINS entries must be exact loopback HTTP(S) origins');
}
const allowNullOrigin = process.env.STUDIO_ALLOW_NULL_ORIGIN === '1';
const token = () => crypto.randomBytes(24).toString('hex');
function checkHost(req) {
  const raw=req.headers.host;
  let url; try { url=new URL(`http://${raw}`); } catch { fail(403,'Host not allowed'); }
  const configuredHost=process.env.HOST;
  const hostname=url.hostname;
  const trusted=['localhost','127.0.0.1','[::1]'].includes(hostname) || (configuredHost && !['0.0.0.0','::'].includes(configuredHost) && hostname === configuredHost.toLowerCase());
  if (!raw || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !trusted || !/^(?:\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::[0-9]{1,5})?$/i.test(raw)) fail(403,'Host not allowed');
}
function apiOrigin(req,res) {
  const origin=req.headers.origin;
  res.setHeader('Vary','Origin');
  if (!origin) return false;
  const sameOrigin = origin === `http://${req.headers.host}`;
  const allowed = studioOrigins.has(origin) || (origin === 'null' && allowNullOrigin);
  if (!sameOrigin && !allowed) fail(403,'Origin not allowed');
  if (allowed) res.setHeader('Access-Control-Allow-Origin',origin);
  return allowed;
}
function roomCode() { const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let code; do { code=Array.from({length:6},()=>alphabet[crypto.randomInt(alphabet.length)]).join(''); } while(rooms.has(code)); return code; }
function send(res,status,data) { const body=JSON.stringify(data); res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); res.end(body); }
function fail(status,message) { const e=new Error(message); e.status=status; throw e; }
const payload = room => ({state:game.view(room.game), rematch:[...room.rematch], round:room.round});
function authorize(code,key) { const room=rooms.get(typeof code === 'string' ? code.toUpperCase() : ''); if (!room) fail(404,'Room not found'); const side=typeof key === 'string' && room.players.get(key); if (!side) fail(403,'Invalid token'); return {room,side}; }
async function body(req) { let data=''; for await(const chunk of req) { data+=chunk; if (Buffer.byteLength(data)>16384) fail(413,'Request too large'); } try { const parsed=JSON.parse(data || '{}'); if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw Error(); return parsed; } catch { fail(400,'Invalid JSON'); } }
async function handler(req,res) {
  try {
    checkHost(req);
    const url=new URL(req.url,'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      const crossOrigin=apiOrigin(req,res);
      if (req.method === 'OPTIONS') {
        const method=req.headers['access-control-request-method'];
        const headers=(req.headers['access-control-request-headers'] || '').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
        if (!crossOrigin || !['GET','POST'].includes(method) || headers.some(h=>h !== 'content-type')) fail(403,'Preflight not allowed');
        res.setHeader('Vary','Origin, Access-Control-Request-Method, Access-Control-Request-Headers, Access-Control-Request-Private-Network');
        res.setHeader('Access-Control-Allow-Methods','GET, POST');
        res.setHeader('Access-Control-Allow-Headers','Content-Type');
        if (req.headers['access-control-request-private-network'] === 'true') res.setHeader('Access-Control-Allow-Private-Network','true');
        res.writeHead(204); return res.end();
      }
      if (req.method === 'POST' && req.headers.origin && !/^application\/json(?:\s*;|\s*$)/i.test(req.headers['content-type'] || '')) fail(415,'JSON content type required');
      if (req.method === 'POST' && url.pathname === '/api/create') {
        const input=await body(req); if (!['ai','room'].includes(input.mode)) fail(400,'Invalid mode');
        const code=roomCode(), key=token(), room={game:game.initialGame(input.mode),players:new Map([[key,'red']]),joinKeys:new Map(),rematch:new Set(),round:1}; rooms.set(code,room);
        return send(res,200,{room:code,token:key,side:'red',...payload(room)});
      }
      if (req.method === 'POST' && url.pathname === '/api/join') {
        const input=await body(req); const code=typeof input.room === 'string' ? input.room.toUpperCase() : ''; const room=rooms.get(code);
        if (!room) fail(404,'Room not found');
        // A private, high-entropy join key lets a tab safely retry an interrupted join.
        // It is never part of the invitation URL and is optional for older clients.
        const joinKey=input.joinKey;
        if (joinKey !== undefined && (typeof joinKey !== 'string' || !/^[a-f0-9]{48}$/.test(joinKey))) fail(400,'Invalid join key');
        const previous=joinKey && room.joinKeys.get(joinKey);
        if (previous) return send(res,200,{room:code,token:previous,side:'black',...payload(room)});
        if (room.game.mode !== 'room' || room.players.size >= 2) fail(409,'Room is full');
        const key=token(); room.players.set(key,'black'); if (joinKey) room.joinKeys.set(joinKey,key); room.game.status='playing'; return send(res,200,{room:code,token:key,side:'black',...payload(room)});
      }
      if (req.method === 'POST' && url.pathname === '/api/move') {
        const input=await body(req), {room,side}=authorize(input.room,input.token);
        try { game.move(room.game,side,input.from,input.to); } catch { fail(400,'Illegal move'); }
        if (room.game.mode === 'ai' && room.game.status === 'playing') game.aiMove(room.game);
        return send(res,200,payload(room));
      }
      // Both players must ask for a rematch; the second request deals a fresh board.
      if (req.method === 'POST' && url.pathname === '/api/rematch') {
        const input=await body(req), {room,side}=authorize(input.room,input.token);
        if (room.game.status !== 'finished') fail(409,'Game not finished');
        if (room.players.size < 2) fail(409,'Opponent missing');
        room.rematch.add(side);
        if (room.rematch.size >= 2) { room.game=game.initialGame('room'); room.game.status='playing'; room.rematch.clear(); room.round++; }
        return send(res,200,payload(room));
      }
      if (req.method === 'GET' && (url.pathname === '/api/state' || url.pathname === '/api/moves')) {
        const {room,side}=authorize(url.searchParams.get('room'),url.searchParams.get('token'));
        if (url.pathname === '/api/state') return send(res,200,payload(room));
        const x=url.searchParams.get('x'), y=url.searchParams.get('y');
        if (x === null || y === null || !/^\d+$/.test(x) || !/^\d+$/.test(y)) fail(400,'Invalid coordinates');
        return send(res,200,{moves:game.legalMoves(room.game,Number(x),Number(y),side)});
      }
      return send(res,404,{error:'Not found'});
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res,405,{error:'Method not allowed'});
    let name; try { name=decodeURIComponent(url.pathname); } catch { fail(400,'Invalid path'); }
    if (name === '/') name='/index.html';
    const file=path.resolve(publicDir,'.'+name); if (!file.startsWith(publicDir+path.sep)) fail(404,'Not found');
    const ext=path.extname(file).toLowerCase(), types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
    fs.readFile(file,(err,data)=>{ if(err) return send(res,404,{error:'Not found'}); res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','X-Content-Type-Options':'nosniff'}); res.end(req.method === 'HEAD' ? undefined : data); });
  } catch(e) { if (!res.headersSent) send(res,e.status||500,{error:e.status ? e.message : 'Internal server error'}); else res.end(); }
}
const server=http.createServer(handler);
if (require.main === module) { const port=Number(process.env.PORT || 3000); server.listen(port,process.env.HOST || '127.0.0.1',()=>console.log(`Dark Xiangqi listening on port ${server.address().port}`)); }
module.exports={server,rooms};
