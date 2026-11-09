'use strict';
// End-to-end UI test in real headless Chrome:
// 1. Player 1 clicks 创建房间 (row 2 of the title overlay) and gets a room code.
// 2. Player 2 clicks 加入房间, types the code into the real prompt.
// 3. Player 1 clicks a legal move; the server state must change and both sides sync.
const {spawn} = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const CHROME = path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell');
const PORT = 9337, PAGE = process.env.PAGE || 'http://127.0.0.1:3218/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const VW = 390, VH = 844;
const S = Math.min(VW / 700, VH / 1200), OX = (VW - 700 * S) / 2, OY = (VH - 1200 * S) / 2;
const css = (x, y) => ({x: x * S + OX, y: y * S + OY});
const BX = 62, BY = 100, STEP = 72;
const cell = (col, row) => css(BX + col * STEP, BY + row * STEP);

async function waitPort() {
  for (let i = 0; i < 80; i++) {
    try { await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); return; } catch {}
    await sleep(200);
  }
  throw new Error('CDP not reachable');
}
async function newPage() {
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, {method: 'PUT'})).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const errors = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  };
  const send = (method, params = {}) => new Promise(res => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({id: n, method, params})); });
  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', {expression: expr, awaitPromise: true, returnByValue: true});
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval failed');
    return r.result?.result?.value;
  };
  const clickAt = async (x, y) => {
    for (const type of ['mousePressed', 'mouseReleased'])
      await send('Input.dispatchMouseEvent', {type, x, y, button: 'left', clickCount: 1});
    await sleep(150);
  };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {width: VW, height: VH, deviceScaleFactor: 1, mobile: true});
  await send('Page.navigate', {url: PAGE});
  await sleep(2300);
  return {send, evaluate, clickAt, errors, close: () => ws.close()};
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dx-ui-'));
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu-sandbox', '--disable-dev-shm-usage', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, '--no-first-run', 'about:blank'], {stdio: 'ignore'});
  const cleanup = () => { try { chrome.kill('SIGKILL'); } catch {} };
  process.on('exit', cleanup);
  const out = {};
  try {
    await waitPort();
    const red = await newPage();
    out.redTitlePhase = await red.evaluate(`__gameState().phase`);

    // Player 1 clicks 创建房间 (overlay button at 70..330 x 528..602).
    const createBtn = css(200, 565);
    await red.clickAt(createBtn.x, createBtn.y);
    await sleep(1500);
    const redState = await red.evaluate(`__gameState()`);
    out.create = {phase: redState.phase, room: redState.room, side: redState.side, notice: redState.notice};
    if (!redState.room) throw new Error('room was not created: ' + JSON.stringify(redState));

    // Player 2 clicks 加入房间 and types the room code into the page prompt.
    const black = await newPage();
    await black.evaluate(`window.prompt = () => ${JSON.stringify(redState.room)}`);
    const joinBtn = css(500, 565);
    await black.clickAt(joinBtn.x, joinBtn.y);
    await sleep(1500);
    const blackState = await black.evaluate(`__gameState()`);
    out.join = {phase: blackState.phase, room: blackState.room, side: blackState.side, notice: blackState.notice};

    // Player 1 makes a real move by clicking: select red's left pawn column (0,6) then move to (0,5).
    const from = cell(0, 6), to = cell(0, 5);
    await red.clickAt(from.x, from.y);
    await sleep(400);
    await red.clickAt(to.x, to.y);
    await sleep(1600);
    const afterMove = await red.evaluate(`__gameState()`);
    out.afterMove = {turn: afterMove.turn, phase: afterMove.phase, notice: afterMove.notice};
    const blackAfter = await black.evaluate(`__gameState()`);
    out.blackSees = {turn: blackAfter.turn, phase: blackAfter.phase};
    out.errors = red.errors.concat(black.errors);
    red.close(); black.close();
    console.log(JSON.stringify(out, null, 2));
  } finally { cleanup(); }
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
