'use strict';

// Browser integration tests against the same exported page served in production.
// Run: node scripts/test-invite.js  (Node with global WebSocket, e.g. Node 22+).
// Set CHROME_PATH to a Chromium/Chrome executable if it cannot be auto-detected.
// The test starts its own room server and headless browser on ephemeral ports.
// Rebuild/export export/dark-xiangqi.html first after changing game.js.
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {after, before, test} = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const WIDTH = 390, HEIGHT = 844;
const SCALE = Math.min(WIDTH / 700, HEIGHT / 1200);
const OFFSET_X = (WIDTH - 700 * SCALE) / 2;
const OFFSET_Y = (HEIGHT - 1200 * SCALE) / 2;
const STARTUP_TIMEOUT = 15000;
const WAIT_TIMEOUT = 8000;
let server, chrome, cdp, profile, base;

function isExecutable(file) {
  try { fs.accessSync(file, fs.constants.X_OK); return true; } catch { return false; }
}

function browserPath() {
  const configured = process.env.CHROME_PATH || process.env.CHROME;
  if (configured) {
    if (!isExecutable(configured)) throw new Error('CHROME_PATH/CHROME is not executable: ' + configured);
    return configured;
  }
  const cache = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  let versions = [];
  try { versions = fs.readdirSync(cache).filter(n => /^chromium_headless_shell-/.test(n)).sort().reverse(); } catch {}
  const cached = versions.flatMap(n => [
    path.join(cache, n, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'),
    path.join(cache, n, 'chrome-headless-shell-mac-x64', 'chrome-headless-shell'),
  ]);
  const candidates = cached.concat([
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    ...String(process.env.PATH || '').split(path.delimiter).flatMap(dir =>
      ['chromium', 'chromium-browser', 'google-chrome', 'chrome'].map(name => path.join(dir, name))),
  ]);
  const found = candidates.find(isExecutable);
  if (!found) throw new Error('Chrome/Chromium not found; set CHROME_PATH to its executable');
  return found;
}

// Both children announce readiness. No fixed-port guesses or startup sleeps.
function waitForOutput(child, stream, pattern, name) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => finish(new Error(name + ' startup timed out: ' + output.slice(-2000))), STARTUP_TIMEOUT);
    const onData = chunk => {
      output += chunk;
      const match = output.match(pattern);
      if (match) finish(null, match);
    };
    const onError = error => finish(new Error(name + ' failed to start: ' + error.message));
    const onExit = (code, signal) => finish(new Error(name + ' exited before ready (' + (signal || code) + '): ' + output.slice(-2000)));
    function finish(error, match) {
      clearTimeout(timer);
      stream.off('data', onData);
      child.off('error', onError);
      child.off('exit', onExit);
      stream.resume();
      if (error) reject(error); else resolve(match);
    }
    stream.setEncoding('utf8');
    stream.on('data', onData);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result || {});
      } else {
        const callbacks = this.listeners.get((message.sessionId || '') + ':' + message.method);
        if (callbacks) for (const callback of [...callbacks]) callback(message.params || {});
      }
    });
    ws.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Browser debugging connection closed'));
      }
      this.pending.clear();
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { ws.close(); reject(new Error('Browser debugging connection timed out')); }, STARTUP_TIMEOUT);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, {once: true});
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Cannot connect to browser debugging endpoint')); }, {once: true});
    });
    return new CDP(ws);
  }
  send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, STARTUP_TIMEOUT);
      this.pending.set(id, {resolve, reject, timer});
      try { this.ws.send(JSON.stringify({id, method, params, ...(sessionId ? {sessionId} : {})})); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  on(sessionId, method, callback) {
    const key = (sessionId || '') + ':' + method;
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key).add(callback);
    return () => this.listeners.get(key)?.delete(callback);
  }
  close() { this.ws.close(); }
}

class Page {
  static async create(url, options = {}) {
    // Incognito contexts ensure host and guest are genuinely separate clients.
    const {browserContextId} = await cdp.send('Target.createBrowserContext');
    try {
      const {targetId} = await cdp.send('Target.createTarget', {url: 'about:blank', browserContextId});
      const {sessionId} = await cdp.send('Target.attachToTarget', {targetId, flatten: true});
      const page = new Page(browserContextId, sessionId);
      await page.send('Page.enable');
      await page.send('Runtime.enable');
      await page.send('Emulation.setDeviceMetricsOverride', {width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: true});
      // Install before app scripts run. Disable Web Share so clipboard assertions
      // are deterministic even on Chrome versions that expose navigator.share.
      // Record request paths only; never print or persist a room's player token.
      const stubOptions = JSON.stringify({denyClipboard: !!options.denyClipboard, dropFirstJoin: !!options.dropFirstJoin});
      await page.send('Page.addScriptToEvaluateOnNewDocument', {source: `(() => {
        const options = ${stubOptions};
        window.__inviteTest = {clipboard: [], requests: [], prompts: 0, manual: [], copyAttempts: 0};
        Object.defineProperty(navigator, 'share', {configurable: true, value: undefined});
        Object.defineProperty(navigator, 'canShare', {configurable: true, value: undefined});
        Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {
          writeText: async text => {
            if (options.denyClipboard) throw new Error('Simulated clipboard denial');
            window.__inviteTest.clipboard.push(String(text));
          }
        }});
        if (options.denyClipboard) {
          const originalCommand = document.execCommand.bind(document);
          document.execCommand = (command, ...args) => {
            if (command === 'copy') { window.__inviteTest.copyAttempts++; return false; }
            return originalCommand(command, ...args);
          };
        }
        window.prompt = (message, value) => {
          window.__inviteTest.prompts++;
          window.__inviteTest.manual.push({message, value});
          return null;
        };
        const originalFetch = window.fetch;
        window.fetch = function(input, init) {
          let pathname = '';
          try { pathname = new URL(typeof input === 'string' ? input : input.url, location.href).pathname; } catch (_) {}
          const entry = {path: pathname, done: false};
          window.__inviteTest.requests.push(entry);
          const drop = options.dropFirstJoin && pathname === '/api/join' && !sessionStorage.getItem('__inviteTestDropped');
          if (drop) sessionStorage.setItem('__inviteTestDropped', '1');
          return originalFetch.call(this, input, init).then(response => {
            entry.httpStatus = response.status;
            if (drop) { entry.done = true; throw new TypeError('Simulated lost join response'); }
            if (pathname === '/api/state') {
              response.clone().json().then(body => { entry.gameStatus = body.state?.status; entry.done = true; }, () => { entry.done = true; });
            } else entry.done = true;
            return response;
          }, error => { entry.done = true; throw error; });
        };
      })();`});
      await page.navigate(url);
      return page;
    } catch (error) {
      await cdp.send('Target.disposeBrowserContext', {browserContextId}).catch(() => {});
      throw error;
    }
  }
  constructor(browserContextId, sessionId) {
    this.browserContextId = browserContextId;
    this.sessionId = sessionId;
    this.exceptions = [];
    this.offException = cdp.on(sessionId, 'Runtime.exceptionThrown', params => {
      this.exceptions.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || 'Uncaught exception');
    });
  }
  send(method, params = {}) { return cdp.send(method, params, this.sessionId); }
  async navigate(url) {
    let off, timer;
    const loaded = new Promise((resolve, reject) => {
      off = cdp.on(this.sessionId, 'Page.loadEventFired', resolve);
      timer = setTimeout(() => reject(new Error('Page load timed out: ' + url)), STARTUP_TIMEOUT);
    });
    try {
      const result = await this.send('Page.navigate', {url});
      if (result.errorText) throw new Error('Navigation failed: ' + result.errorText);
      await loaded;
    } finally { clearTimeout(timer); off(); }
    await this.waitFor('game initialization', s => !!s);
  }
  async reload() {
    let off, timer;
    const loaded = new Promise((resolve, reject) => {
      off = cdp.on(this.sessionId, 'Page.loadEventFired', resolve);
      timer = setTimeout(() => reject(new Error('Page reload timed out')), STARTUP_TIMEOUT);
    });
    try { await this.send('Page.reload'); await loaded; }
    finally { clearTimeout(timer); off(); }
    await this.waitFor('game initialization after reload', s => !!s);
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
  }
  async waitFor(description, predicate) {
    return this.evaluate(`(async () => {
      const deadline = Date.now() + ${WAIT_TIMEOUT};
      let state;
      while (Date.now() < deadline) {
        state = typeof window.__gameState === 'function' ? window.__gameState() : null;
        if ((${predicate.toString()})(state)) return state;
        await new Promise(resolve => setTimeout(resolve, 40));
      }
      throw new Error(${JSON.stringify(description)} + ' timed out; last game state: ' + JSON.stringify(state));
    })()`);
  }
  async click(x, y) {
    const point = {x: OFFSET_X + x * SCALE, y: OFFSET_Y + y * SCALE};
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', {type, ...point, button: 'left', clickCount: 1});
    }
  }
  assertNoExceptions() { assert.deepEqual(this.exceptions, [], 'uncaught browser exceptions'); }
  async close() {
    this.offException();
    await cdp.send('Target.disposeBrowserContext', {browserContextId: this.browserContextId});
  }
}

async function post(endpoint, data) {
  const response = await fetch(base + endpoint, {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(endpoint + ' returned ' + response.status + ': ' + body.error);
  return body;
}

async function createHost(url, options = {}) {
  const host = await Page.create(url, options);
  try {
    assert.equal((await host.evaluate('__gameState()')).phase, 'title');
    await host.click(200, 565);
    // Wait for the first host poll to settle before clicking. This avoids racing
    // an in-flight room request rather than relying on arbitrary startup sleeps.
    const state = await host.waitFor('host room and initial poll', s => s && s.room && s.side === 'red' &&
      window.__inviteTest.requests.some(r => r.path === '/api/state' && r.done));
    assert.equal(state.phase, 'playing');
    assert.match(state.notice, /等待/);
    assert.equal(state.turnIndicator, null, 'a waiting room must not claim it is your turn');
    return {host, room: state.room};
  } catch (error) { await host.close(); throw error; }
}

async function copiedInvite(host, room) {
  await host.click(415, 858);
  await host.waitFor('copied invitation', () => window.__inviteTest.clipboard.length > 0);
  const values = await host.evaluate('window.__inviteTest.clipboard');
  assert.equal(values.length, 1, 'one click must copy one invitation');
  const url = new URL(values[0]);
  assert.equal(url.origin, new URL(base).origin);
  assert.equal(url.pathname, '/');
  assert.equal(url.searchParams.get('room'), room);
  assert.deepEqual([...url.searchParams.keys()], ['room'], 'invitation must contain only the public room code, not a token');
  assert.equal(url.hash, '');
  assert.equal(url.username + url.password, '');
  return url;
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise(resolve => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, 2000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    if (!child.kill('SIGTERM')) { clearTimeout(timer); resolve(); }
  });
}

before(async () => {
  if (typeof WebSocket !== 'function') throw new Error('This test needs a Node version with global WebSocket (Node 22 or newer)');
  const executable = browserPath();
  const game = path.join(ROOT, 'export', 'dark-xiangqi.html');
  if (!fs.existsSync(game)) throw new Error('Missing export/dark-xiangqi.html; build and export the game first');
  server = spawn(process.execPath, ['server/online.js'], {
    cwd: ROOT, env: {...process.env, PORT: '0', HOST: '127.0.0.1'}, stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.resume();
  const serverReady = await waitForOutput(server, server.stdout, /暗棋服务已启动：[^\n]*:(\d+)\r?\n/, 'Room server');
  base = 'http://127.0.0.1:' + serverReady[1];
  const pageResponse = await fetch(base + '/');
  if (!pageResponse.ok) throw new Error('Game export is not being served: HTTP ' + pageResponse.status + ' ' + await pageResponse.text());
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dark-xiangqi-invite-'));
  chrome = spawn(executable, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
    '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank',
  ], {stdio: ['ignore', 'pipe', 'pipe']});
  chrome.stdout.resume();
  const browserReady = await waitForOutput(chrome, chrome.stderr, /DevTools listening on (ws:\/\/[^\s]+)\s/, 'Chrome');
  cdp = await CDP.connect(browserReady[1]);
});

after(async () => {
  if (cdp) cdp.close();
  await stopChild(chrome);
  await stopChild(server);
  // Only remove the temporary profile this test created, never repository files.
  if (profile && path.dirname(profile) === path.resolve(os.tmpdir()) && path.basename(profile).startsWith('dark-xiangqi-invite-')) {
    fs.rmSync(profile, {recursive: true, force: true});
  }
});

test('static offline page shows the current player turn', {timeout: 20000}, async () => {
  const url = require('node:url').pathToFileURL(path.join(ROOT, 'index.html')).href;
  const page = await Page.create(url);
  try {
    const title = await page.evaluate('__gameState()');
    assert.equal(title.net, false);
    assert.equal(title.turnIndicator, null);
    await page.evaluate("__aiTest.start('hotseat')");
    const state = await page.waitFor('offline red turn', s => s && s.turnIndicator?.label === '轮到红方行棋');
    assert.equal(state.turnIndicator.side, 'red');
    page.assertNoExceptions();
  } finally { await page.close(); }
});

test('turn frame breathes only on active turns and respects reduced motion', {timeout: 20000}, async () => {
  const page = await Page.create(base + '/');
  try {
    await page.send('Page.bringToFront');
    await page.evaluate(`window.__borderSample = () => {
      const canvas = document.getElementById('game');
      const scale = Math.min(canvas.width / 700, canvas.height / 1200);
      const ox = (canvas.width - 700 * scale) / 2, oy = (canvas.height - 1200 * scale) / 2;
      const x = Math.round(ox + 17 * scale), y = Math.round(oy + 400 * scale);
      return Array.from(canvas.getContext('2d').getImageData(x, y, 1, 1).data);
    }; window.__nextDraw = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));`);
    await page.evaluate('__nextDraw()');
    const idle = await page.evaluate('__borderSample()');
    await page.evaluate("__aiTest.start('hotseat')");
    const samples = await page.evaluate(`(async () => {
      const values = [];
      for (let i = 0; i < 8; i++) {
        await new Promise(resolve => setTimeout(resolve, 200));
        values.push(__borderSample()[0]);
      }
      return values;
    })()`);
    assert.ok(Math.max(...samples) - Math.min(...samples) >= 8, 'the actual border pixels must pulse');
    assert.ok(Math.max(...samples) > idle[0], 'active border must be brighter than the idle frame');

    await page.send('Emulation.setEmulatedMedia', {features: [{name: 'prefers-reduced-motion', value: 'reduce'}]});
    await page.evaluate('__nextDraw()');
    const reduced = await page.evaluate('__borderSample()');
    const reducedLater = await page.evaluate('(async () => { await new Promise(r => setTimeout(r, 350)); await __nextDraw(); return __borderSample(); })()');
    assert.deepEqual(reducedLater, reduced, 'reduced motion keeps the active border steady');
    assert.ok(reduced[0] > idle[0], 'reduced motion retains a visible turn cue');

    await page.evaluate("__aiTest.start(); __aiTest.play({x:0,y:6},{x:0,y:5})");
    const waiting = await page.evaluate('(async () => { await __nextDraw(); return {state: __gameState(), pixel: __borderSample()}; })()');
    assert.equal(waiting.state.turnIndicator.active, false);
    assert.deepEqual(waiting.pixel, idle, 'computer turn has no illuminated border');
    page.assertNoExceptions();
  } finally { await page.close(); }
});

test('turn indicator follows local practice and hotseat turns', {timeout: 20000}, async () => {
  const page = await Page.create(base + '/');
  try {
    assert.equal((await page.evaluate('__gameState()')).turnIndicator, null, 'title screen has no turn');
    await page.evaluate("__aiTest.start('hotseat')");
    let state = await page.waitFor('hotseat red turn', s => s && s.turnIndicator?.label === '轮到红方行棋');
    assert.deepEqual(state.turnIndicator, {label: '轮到红方行棋', active: true, side: 'red'});
    await page.evaluate('__aiTest.play({x:0,y:6},{x:0,y:5})');
    state = await page.waitFor('hotseat black turn', s => s && s.turnIndicator?.label === '轮到黑方行棋');
    assert.deepEqual(state.turnIndicator, {label: '轮到黑方行棋', active: true, side: 'black'});
    await page.waitFor('hotseat announcement', () => document.querySelector('[role="status"]')?.textContent === '轮到黑方行棋');

    await page.evaluate('__aiTest.start()');
    state = await page.waitFor('practice red turn', s => s && s.turnIndicator?.label === '轮到你行棋');
    assert.deepEqual(state.turnIndicator, {label: '轮到你行棋', active: true, side: 'red'});
    const afterMove = await page.evaluate('(__aiTest.play({x:0,y:6},{x:0,y:5}), __gameState())');
    assert.deepEqual(afterMove.turnIndicator, {label: '电脑思考中', active: false, side: 'black'});
    state = await page.waitFor('practice turn returns after AI', s => s && s.turnIndicator?.label === '轮到你行棋');
    assert.equal(state.turn, 'red');
    page.assertNoExceptions();
  } finally { await page.close(); }
});

test('copied invitation joins an isolated black client and host observes the join', {timeout: 30000}, async () => {
  const {host, room} = await createHost(base + '/');
  let guest;
  try {
    const url = await copiedInvite(host, room);
    guest = await Page.create(url.href);
    const joined = await guest.waitFor('guest autojoin and URL cleanup', s => s && s.phase === 'playing' &&
      s.side === 'black' && s.room && !new URL(location.href).searchParams.has('room'));
    assert.equal(joined.room, room);
    assert.equal(await guest.evaluate('window.__inviteTest.prompts'), 0, 'invite must not prompt for a room code');
    assert.equal(await guest.evaluate("window.__inviteTest.requests.filter(r => r.path === '/api/join').length"), 1);
    const hostState = await host.waitFor('host polls the joined room', s => s && s.side === 'red' &&
      s.phase === 'playing' && /轮到你|你.*行棋/.test(s.notice) &&
      window.__inviteTest.requests.some(r => r.path === '/api/state' && r.gameStatus === 'playing'));
    assert.equal(hostState.room, room);
    assert.deepEqual(hostState.turnIndicator, {label: '轮到你行棋', active: true, side: 'red'});
    assert.deepEqual(joined.turnIndicator, {label: '等待对方行棋', active: false, side: 'red'});

    // Reloading either player restores that tab's identity, without taking a
    // second seat or reusing the consumed invitation parameter.
    await guest.reload();
    const restoredGuest = await guest.waitFor('guest restored after reload', s => s && s.side === 'black' && s.phase === 'playing');
    assert.equal(restoredGuest.room, room);
    assert.equal(await guest.evaluate("window.__inviteTest.requests.filter(r => r.path === '/api/join').length"), 0);
    assert.equal(await guest.evaluate("new URL(location.href).searchParams.has('room')"), false);
    await host.reload();
    const restoredHost = await host.waitFor('host restored after reload', s => s && s.side === 'red' && s.phase === 'playing' &&
      window.__inviteTest.requests.some(r => r.path === '/api/state' && r.gameStatus === 'playing') &&
      window.__inviteTest.requests.filter(r => r.path === '/api/state').every(r => r.done));
    assert.equal(restoredHost.room, room);
    assert.equal(await host.evaluate("window.__inviteTest.requests.filter(r => r.path === '/api/join').length"), 0);

    // A legal host move must be accepted and then become visible to the guest.
    // This verifies the host actually applied the playing state from polling.
    await host.click(62, 532);
    await host.waitFor('host selects a pawn', () => window.__inviteTest.requests.some(r => r.path === '/api/moves' && r.done));
    await host.click(62, 460);
    const synced = await guest.waitFor('guest sees the host move', s => s && s.side === 'black' && s.turn === 'black');
    assert.equal(synced.room, room);
    assert.deepEqual(synced.turnIndicator, {label: '轮到你行棋', active: true, side: 'black'});
    const hostAfterMove = await host.waitFor('host sees opponent turn', s => s && s.turn === 'black');
    assert.deepEqual(hostAfterMove.turnIndicator, {label: '等待对方行棋', active: false, side: 'black'});
    await guest.waitFor('accessible turn announcement', () => document.querySelector('[role="status"]')?.textContent === '轮到你行棋，你执黑方');

    // Black's view is rotated: logical (0,3) -> (0,4) appears on the right.
    await guest.waitFor('guest polling idle', () => window.__inviteTest.requests.filter(r => r.path === '/api/state').every(r => r.done));
    await guest.click(638, 532);
    await guest.waitFor('guest selects a pawn', () => window.__inviteTest.requests.some(r => r.path === '/api/moves' && r.done));
    await guest.click(638, 460);
    const redAgain = await host.waitFor('red turn returns', s => s && s.turn === 'red');
    assert.deepEqual(redAgain.turnIndicator, {label: '轮到你行棋', active: true, side: 'red'});
    const blackWaiting = await guest.waitFor('black waits for red', s => s && s.turn === 'red');
    assert.deepEqual(blackWaiting.turnIndicator, {label: '等待对方行棋', active: false, side: 'red'});
    host.assertNoExceptions(); guest.assertNoExceptions();
  } finally { if (guest) await guest.close(); await host.close(); }
});

test('a lost successful join response can be retried on reload without taking another seat', {timeout: 20000}, async () => {
  const created = await post('/api/create', {mode: 'room'});
  const guest = await Page.create(base + '/?room=' + encodeURIComponent(created.room), {dropFirstJoin: true});
  try {
    // The actual server accepts the first join, but the browser loses its reply.
    const interrupted = await guest.waitFor('interrupted join notice', s => s && s.phase === 'title' && /刷新.*重试/.test(s.notice));
    assert.equal(interrupted.room, null);
    const firstRequests = await guest.evaluate("window.__inviteTest.requests.filter(r => r.path === '/api/join')");
    assert.equal(firstRequests.length, 1);
    assert.equal(firstRequests[0].httpStatus, 200, 'server must already have allocated the black seat');
    assert.equal(await guest.evaluate("new URL(location.href).searchParams.has('room')"), false);

    await guest.reload();
    const recovered = await guest.waitFor('interrupted join recovery', s => s && s.phase === 'playing' && s.side === 'black');
    assert.equal(recovered.room, created.room);
    const retries = await guest.evaluate("window.__inviteTest.requests.filter(r => r.path === '/api/join')");
    assert.equal(retries.length, 1);
    assert.equal(retries[0].httpStatus, 200, 'retry must reclaim the existing seat');
    const third = await fetch(base + '/api/join', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({room: created.room})});
    assert.equal(third.status, 409, 'a different client must still see a full room');
    guest.assertNoExceptions();
  } finally { await guest.close(); }
});

test('denied clipboard falls back to a manual invitation link', {timeout: 20000}, async () => {
  const {host, room} = await createHost(base + '/', {denyClipboard: true});
  try {
    await host.click(415, 858);
    await host.waitFor('manual invite fallback', () => window.__inviteTest.manual.length > 0);
    const result = await host.evaluate('window.__inviteTest');
    assert.equal(result.copyAttempts, 1, 'fallback attempts the legacy copy command');
    assert.equal(result.prompts, 1, 'failed copies show a manual copy prompt');
    assert.match(result.manual[0].message, /复制/);
    const url = new URL(result.manual[0].value);
    assert.equal(url.origin, new URL(base).origin);
    assert.equal(url.searchParams.get('room'), room);
    assert.deepEqual([...url.searchParams.keys()], ['room']);
    assert.equal(url.hash, '');
    host.assertNoExceptions();
  } finally { await host.close(); }
});

test('malformed room invitation shows a Chinese error and remains at title', {timeout: 20000}, async () => {
  const page = await Page.create(base + '/?room=ROOMZZ');
  try {
    const state = await page.waitFor('invalid invitation error', s => s && s.phase === 'title' && /邀请.*无效|房间.*无效/.test(s.notice));
    assert.equal(state.room, null); assert.equal(state.side, null);
    assert.equal(await page.evaluate('window.__inviteTest.prompts'), 0);
    assert.equal(await page.evaluate("window.__inviteTest.requests.filter(r => r.path === '/api/join').length"), 0);
    page.assertNoExceptions();
  } finally { await page.close(); }
});

test('nonexistent room invitation shows a Chinese error and remains at title', {timeout: 20000}, async () => {
  // Verify the fixture is absent instead of assuming a randomly-created room
  // cannot collide. The test's isolated server owns only this suite's rooms.
  let missing;
  for (const code of ['AAAAAA', 'BBBBBB', 'CCCCCC']) {
    const response = await fetch(base + '/api/join', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({room: code})});
    if (response.status === 404) { missing = code; break; }
  }
  assert.ok(missing, 'could not find an absent valid room code');
  const page = await Page.create(base + '/?room=' + missing);
  try {
    const state = await page.waitFor('unknown room error', s => s && s.phase === 'title' && /房间.*(不存在|失效|无效)/.test(s.notice));
    assert.equal(state.room, null); assert.equal(state.side, null);
    assert.equal(await page.evaluate('window.__inviteTest.prompts'), 0);
    assert.equal(await page.evaluate("window.__inviteTest.requests.filter(r => r.path === '/api/join').length"), 1);
    page.assertNoExceptions();
  } finally { await page.close(); }
});

test('full room invitation shows a Chinese error and remains at title', {timeout: 20000}, async () => {
  const created = await post('/api/create', {mode: 'room'});
  await post('/api/join', {room: created.room});
  const page = await Page.create(base + '/?room=' + encodeURIComponent(created.room));
  try {
    const state = await page.waitFor('full room error', s => s && s.phase === 'title' && /房间.*满/.test(s.notice));
    assert.equal(state.room, null); assert.equal(state.side, null);
    assert.equal(await page.evaluate('window.__inviteTest.prompts'), 0);
    assert.equal(await page.evaluate("window.__inviteTest.requests.filter(r => r.path === '/api/join').length"), 1);
    page.assertNoExceptions();
  } finally { await page.close(); }
});

test('unrelated query parameters do not trigger a join', {timeout: 20000}, async () => {
  const created = await post('/api/create', {mode: 'room'});
  const page = await Page.create(base + '/?ref=' + encodeURIComponent(created.room) + '&mode=room&token=not-a-token');
  try {
    // A bounded observation window is needed to assert the absence of a request;
    // all positive state transitions elsewhere use predicate-driven waits.
    await page.evaluate('new Promise(resolve => setTimeout(resolve, 500))');
    const result = await page.evaluate('({state: __gameState(), requests: window.__inviteTest.requests, prompts: window.__inviteTest.prompts})');
    assert.equal(result.state.phase, 'title');
    assert.equal(result.state.room, null); assert.equal(result.state.side, null);
    assert.equal(result.requests.filter(r => r.path === '/api/join').length, 0);
    assert.equal(result.prompts, 0);
    const joined = await post('/api/join', {room: created.room});
    assert.equal(joined.side, 'black', 'unrelated parameters must not consume the guest seat');
    page.assertNoExceptions();
  } finally { await page.close(); }
});

test('localhost invitation warns it cannot be used by another machine', {timeout: 20000}, async () => {
  const localBase = base.replace('127.0.0.1', 'localhost');
  const {host, room} = await createHost(localBase + '/');
  try {
    await host.click(415, 858);
    const warned = await host.waitFor('localhost invitation warning', s => s &&
      /localhost|127\.0\.0\.1|本机|本地/i.test(s.notice) && /仅|只能|无法|不能|不可|其他|对方|局域网/.test(s.notice));
    assert.equal(warned.room, room);
    assert.equal(warned.side, 'red');
    host.assertNoExceptions();
  } finally { await host.close(); }
});
