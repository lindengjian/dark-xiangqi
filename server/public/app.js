'use strict';

const $ = id => document.getElementById(id);
const ui = { board: $('squares'), status: $('statusText'), hint: $('boardHint'), feedback: $('feedback'), room: $('roomValue'), mode: $('modeValue'), side: $('sideValue'), turn: $('turnValue'), copy: $('copyButton'), restart: $('restartButton'), ai: $('aiButton'), roomButton: $('roomButton'), form: $('joinForm'), input: $('roomInput') };
const names = { red: { king: '帅', advisor: '仕', elephant: '相', horse: '傌', rook: '俥', cannon: '炮', pawn: '兵' }, black: { king: '将', advisor: '士', elephant: '象', horse: '馬', rook: '車', cannon: '砲', pawn: '卒' } };
let session = null, state = null, selected = null, moves = [], busy = false, selectionVersion = 0, sessionVersion = 0, polling = false;

async function request(path, options) {
  const response = await fetch(path, options);
  let data;
  try { data = await response.json(); } catch (_) { throw new Error('服务器返回了无法识别的内容，请稍后重试。'); }
  if (!response.ok || data.error) throw new Error(typeof data.error === 'string' ? data.error : (data.message || `请求失败（${response.status}），请重试。`));
  return data;
}
function post(path, body) { return request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
function query(path, extra = {}) { return `${path}?${new URLSearchParams({ room: session.room, token: session.token, ...extra })}`; }
function say(text, error = false) { ui.feedback.textContent = text; ui.feedback.classList.toggle('error', error); }
function setBusy(value) { busy = value; ui.ai.disabled = value; ui.roomButton.disabled = value; ui.form.querySelector('button').disabled = value; ui.restart.disabled = value; }
function clearSelection() { selected = null; moves = []; selectionVersion++; }
function sideName(side) { return side === 'red' ? '红方' : side === 'black' ? '黑方' : '—'; }
function render() {
  ui.room.textContent = session?.room || '—'; ui.copy.hidden = !session;
  ui.mode.textContent = state ? (state.mode === 'ai' ? '人机对弈' : '双人对弈') : '尚未开局';
  ui.side.textContent = session ? sideName(session.side) : '—';
  ui.turn.textContent = state?.status === 'playing' ? sideName(state.turn) : '—';
  ui.status.textContent = !state ? '等待开局' : state.status === 'waiting' ? '等待对手加入' : state.status === 'finished' ? (state.winner ? `${sideName(state.winner)}获胜` : '棋局结束') : (state.turn === session.side ? '轮到你行棋' : '对方行棋中');
  ui.restart.hidden = state?.status !== 'finished';
  ui.hint.textContent = !state ? '创建或加入房间，开始对弈' : state.status === 'waiting' ? '分享房间号，邀请对手入座' : state.status === 'finished' ? '胜负已分，可再开一局' : selected ? '选择棋盘上的标记位置' : state.turn === session.side ? '选择一枚暗子或己方明子' : '请等待对方行棋';
  ui.board.replaceChildren();
  for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) {
    const piece = state?.board?.[y]?.[x] || null;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'square'; button.style.left = `${x * 12.5}%`; button.style.top = `${y * 100 / 9}%`;
    button.setAttribute('role', 'gridcell');
    const last = state?.lastMove; if (last && ((last.from.x === x && last.from.y === y) || (last.to.x === x && last.to.y === y))) button.classList.add('last');
    if (selected?.x === x && selected?.y === y) button.classList.add('selected');
    if (moves.some(move => move.x === x && move.y === y)) button.classList.add('legal');
    const label = piece ? (piece.hidden ? '暗子' : `${sideName(piece.color)}${names[piece.color]?.[piece.type] || '棋子'}`) : '空位';
    button.setAttribute('aria-label', `第${y + 1}行第${x + 1}列，${label}`);
    if (piece) { const disk = document.createElement('span'); disk.className = `piece ${piece.hidden ? 'hidden-piece' : piece.color}`; disk.textContent = piece.hidden ? '棋' : (names[piece.color]?.[piece.type] || '？'); button.append(disk); }
    button.addEventListener('click', () => onSquare(x, y)); ui.board.append(button);
  }
}
async function begin(mode) {
  setBusy(true); try { const data = await post('/api/create', { mode }); adopt(data); say(mode === 'room' ? '房间已创建，分享房间号邀请对手。' : '棋局已备好，请落子。'); } catch (error) { say(error.message, true); } finally { setBusy(false); }
}
function adopt(data) {
  if (!data.room || !data.token || !data.state) throw new Error('房间信息不完整，请重试。');
  sessionVersion++; session = { room: data.room, token: data.token, side: data.side }; state = data.state; clearSelection(); render();
}
async function onSquare(x, y) {
  if (!session || !state || busy || state.status !== 'playing' || state.turn !== session.side) return;
  if (selected && moves.some(move => move.x === x && move.y === y)) {
    const from = selected, version = sessionVersion; setBusy(true);
    try { const data = await post('/api/move', { room: session.room, token: session.token, from, to: { x, y } }); if (version !== sessionVersion) return; sessionVersion++; state = data.state; clearSelection(); render(); say(state.status === 'finished' ? (state.winner ? `${sideName(state.winner)}获胜，棋局结束。` : '棋局结束。') : '落子成功。'); }
    catch (error) { if (version === sessionVersion) { clearSelection(); render(); say(error.message, true); } } finally { setBusy(false); } return;
  }
  const piece = state.board?.[y]?.[x];
  if (!piece || (!piece.hidden && piece.color !== session.side)) { clearSelection(); render(); return; }
  if (selected?.x === x && selected?.y === y) { clearSelection(); render(); return; }
  clearSelection(); selected = { x, y }; const version = selectionVersion, currentSession = sessionVersion; render();
  try { const data = await request(query('/api/moves', { x, y })); if (version !== selectionVersion || currentSession !== sessionVersion) return; moves = Array.isArray(data.moves) ? data.moves : []; render(); say(moves.length ? '请选择标记的位置。' : '这枚棋子暂无可走位置。'); }
  catch (error) { if (version === selectionVersion && currentSession === sessionVersion) { clearSelection(); render(); say(error.message, true); } }
}
async function refresh() {
  if (!session || polling || busy) return; polling = true; const version = sessionVersion;
  try { const data = await request(query('/api/state')); if (version !== sessionVersion || busy || !data.state) return; const changed = JSON.stringify(data.state) !== JSON.stringify(state); if (changed) { state = data.state; clearSelection(); render(); if (state.status === 'finished') say(state.winner ? `${sideName(state.winner)}获胜，棋局结束。` : '棋局结束。'); else if (state.status === 'playing') say(state.turn === session.side ? '轮到你行棋。' : '等待对方行棋。'); } }
  catch (error) { if (version === sessionVersion) say(`同步失败：${error.message}`, true); } finally { polling = false; }
}
ui.ai.addEventListener('click', () => begin('ai')); ui.roomButton.addEventListener('click', () => begin('room'));
ui.form.addEventListener('submit', async event => { event.preventDefault(); const room = ui.input.value.trim(); if (!room) return; setBusy(true); try { adopt(await post('/api/join', { room })); say('已加入房间，棋局状态自动同步。'); } catch (error) { say(error.message, true); } finally { setBusy(false); } });
ui.copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(session.room); say('房间号已复制。'); } catch (_) { say('复制失败，请手动复制房间号。', true); } });
ui.restart.addEventListener('click', () => begin(state?.mode === 'ai' ? 'ai' : 'room'));
setInterval(refresh, 2000); render();
