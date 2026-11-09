'use strict';
// Two-client integration check against the real HTTP service (no browser needed).
const BASE = process.env.BASE || 'http://127.0.0.1:3218';
async function post(p, data) {
  const r = await fetch(BASE + p, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)});
  const j = await r.json(); if (!r.ok) throw Object.assign(new Error(j.error), {status:r.status}); return j;
}
async function get(p) {
  const r = await fetch(BASE + p); const j = await r.json();
  if (!r.ok) throw Object.assign(new Error(j.error), {status:r.status}); return j;
}
(async () => {
  const a = await post('/api/create', {mode:'room'});
  const b = await post('/api/join', {room:a.room});
  const ctx = {red:{token:a.token, side:'red'}, black:{token:b.token, side:'black'}};
  let state = b.state, moves = 0, captures = 0;
  // A room must not accept a third player.
  let thirdRejected = false;
  try { await post('/api/join', {room:a.room}); } catch (e) { thirdRejected = e.status === 409; }
  while (state.status === 'playing' && moves < 400) {
    const me = ctx[state.turn], other = ctx[state.turn === 'red' ? 'black' : 'red'];
    const cells = [];
    for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) {
      const p = state.board[y][x];
      if (!p) continue;
      const ownHalf = state.turn === 'red' ? y >= 5 : y <= 4;
      if (p.hidden ? !ownHalf : p.color !== state.turn) continue;
      const {moves: ms} = await get(`/api/moves?room=${a.room}&token=${me.token}&x=${x}&y=${y}`);
      if (ms.length) cells.push({x, y, ms});
    }
    if (!cells.length) break;
    const c = cells[Math.floor(Math.random() * cells.length)];
    const t = c.ms[Math.floor(Math.random() * c.ms.length)];
    if (moves === 0) {
      // Out-of-turn move must be refused by the authoritative server.
      try { await post('/api/move', {room:a.room, token:other.token, from:{x:c.x,y:c.y}, to:t}); throw new Error('out-of-turn move accepted'); }
      catch (e) { if (e.message === 'out-of-turn move accepted') throw e; }
    }
    const r = await post('/api/move', {room:a.room, token:me.token, from:{x:c.x,y:c.y}, to:t});
    if (r.state.lastMove && r.state.lastMove.captured) captures++;
    state = r.state; moves++;
  }
  const redView = (await get(`/api/state?room=${a.room}&token=${a.token}`)).state;
  console.log(JSON.stringify({room:a.room, thirdRejected, moves, captures, status:state.status, winner:state.winner, redSeesSameTurn:redView.turn === state.turn}, null, 0));
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
