'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {server, rooms} = require('./server');

test('room join keys are private, idempotent and isolated per room', async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body) => {
    const response = await fetch(base + path, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
    return {status:response.status, data:await response.json()};
  };
  try {
    const created = await post('/api/create', {mode:'room'});
    const room = created.data.room, joinKey = 'ab'.repeat(24);
    assert.equal((await post('/api/join', {room, joinKey:'short'})).status, 400);
    const [first, retry] = await Promise.all([post('/api/join', {room, joinKey}), post('/api/join', {room, joinKey})]);
    assert.equal(first.status, 200);
    assert.equal(retry.status, 200);
    assert.equal(first.data.side, 'black');
    assert.equal(retry.data.token, first.data.token);
    assert.equal(first.data.state.status, 'playing');
    assert.equal((await post('/api/join', {room, joinKey:'cd'.repeat(24)})).status, 409);
    assert.equal((await post('/api/join', {room})).status, 409);
    assert(!JSON.stringify(first.data).includes(joinKey));
    const other = await post('/api/create', {mode:'room'});
    const otherJoin = await post('/api/join', {room:other.data.room, joinKey});
    assert.equal(otherJoin.status, 200);
    assert.notEqual(otherJoin.data.token, first.data.token);
  } finally {
    rooms.clear();
    await new Promise(resolve => server.close(resolve));
  }
});
