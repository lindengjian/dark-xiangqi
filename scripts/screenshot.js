'use strict';
// Screenshot of a live two-player room: player 1 view mid-game.
const {spawn} = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const CHROME = path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell');
const PORT = 9338, PAGE = process.env.PAGE || 'http://127.0.0.1:3218/';
const OUT = process.env.OUT || '/tmp/dx-shot.png';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const VW = 390, VH = 844, S = Math.min(VW / 700, VH / 1200), OX = (VW - 700 * S) / 2, OY = (VH - 1200 * S) / 2;
const css = (x, y) => ({x: x * S + OX, y: y * S + OY});
const cell = (c, r) => css(62 + c * 72, 100 + r * 72);

async function newPage() {
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, {method: 'PUT'})).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise(res => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({id: n, method, params})); });
  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', {expression: expr, awaitPromise: true, returnByValue: true});
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval failed');
    return r.result?.result?.value;
  };
  const clickAt = async (x, y) => {
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', {type, x, y, button: 'left', clickCount: 1});
    await sleep(140);
  };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {width: VW, height: VH, deviceScaleFactor: 2, mobile: true});
  await send('Page.navigate', {url: PAGE});
  await sleep(2300);
  return {send, evaluate, clickAt, close: () => ws.close()};
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dx-shot-'));
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu-sandbox', '--disable-dev-shm-usage', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, '--no-first-run', 'about:blank'], {stdio: 'ignore'});
  const cleanup = () => { try { chrome.kill('SIGKILL'); } catch {} };
  process.on('exit', cleanup);
  try {
    for (let i = 0; i < 80; i++) { try { await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
    const red = await newPage();
    let p = css(200, 492); await red.clickAt(p.x, p.y); await sleep(1400);
    const g = await red.evaluate(`__gameState()`);
    const black = await newPage();
    await black.evaluate(`window.prompt = () => ${JSON.stringify(g.room)}`);
    p = css(500, 492); await black.clickAt(p.x, p.y); await sleep(1500);

    // A few alternating moves so the board looks like a real game.
    const moves = [[[0, 6], [0, 5]], [[0, 3], [0, 4]], [[1, 7], [1, 6]], [[1, 2], [1, 3]]];
    for (let i = 0; i < moves.length; i++) {
      const page = i % 2 === 0 ? red : black;
      const [f, t] = moves[i];
      const a = cell(f[0], f[1]), b = cell(t[0], t[1]);
      await page.clickAt(a.x, a.y); await sleep(350);
      await page.clickAt(b.x, b.y); await sleep(900);
    }
    await sleep(600);
    const shot = await red.send('Page.captureScreenshot', {format: 'png'});
    fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
    const st = await red.evaluate(`__gameState()`);
    console.log(JSON.stringify({out: OUT, room: st.room, turn: st.turn, notice: st.notice}));
    red.close(); black.close();
  } finally { cleanup(); }
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
