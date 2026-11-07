'use strict';
const crypto = require('node:crypto');
const BACK = ['rook','horse','elephant','advisor','king','advisor','elephant','horse','rook'];
const opposite = color => color === 'red' ? 'black' : 'red';
const inside = (x,y) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < 9 && y >= 0 && y < 10;
function initialGame(mode, randomInt = crypto.randomInt) {
  const board = Array.from({length:10}, () => Array(9).fill(null));
  const slots = [];
  for (const [color, back, cannon, pawn] of [['black',0,2,3],['red',9,7,6]]) {
    BACK.forEach((type,x) => slots.push({x,y:back,type,color}));
    for (const x of [1,7]) slots.push({x,y:cannon,type:'cannon',color});
    for (const x of [0,2,4,6,8]) slots.push({x,y:pawn,type:'pawn',color});
  }
  const identities = slots.map(({type,color}) => ({type,color}));
  for (let i = identities.length - 1; i > 0; i--) { const j = randomInt(i + 1); [identities[i], identities[j]] = [identities[j], identities[i]]; }
  slots.forEach((slot,i) => { board[slot.y][slot.x] = {...identities[i], hidden:true, slotType:slot.type}; });
  return {board,turn:'red',winner:null,status:mode === 'room' ? 'waiting':'playing',lastMove:null,mode};
}
function visible(piece) { return !piece ? null : piece.hidden ? {hidden:true} : {hidden:false,color:piece.color,type:piece.type}; }
function view(game) { return {board:game.board.map(row => row.map(visible)),turn:game.turn,winner:game.winner,status:game.status,lastMove:game.lastMove && {from:{...game.lastMove.from},to:{...game.lastMove.to},...(game.lastMove.captured ? {captured:{...game.lastMove.captured}} : {})},mode:game.mode}; }
function legalMoves(game,x,y,side = game.turn) {
  if (game.status !== 'playing' || side !== game.turn || !inside(x,y)) return [];
  const p = game.board[y][x];
  if (!p || (p.hidden ? (side === 'red' ? y < 5 : y > 4) : p.color !== side)) return [];
  const type = p.hidden ? p.slotType : p.type;
  const direction = (p.hidden ? side : p.color) === 'red' ? -1 : 1;
  const moves = [];
  function add(tx,ty, captureAllowed = true, emptyAllowed = true) {
    if (!inside(tx,ty)) return;
    const target = game.board[ty][tx];
    if (target ? captureAllowed && (target.hidden || target.color !== side) : emptyAllowed) moves.push({x:tx,y:ty});
  }
  if (type === 'rook' || type === 'cannon') {
    for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      let screens = 0;
      for (let tx=x+dx,ty=y+dy; inside(tx,ty); tx+=dx,ty+=dy) {
        const target=game.board[ty][tx];
        if (type === 'rook') { add(tx,ty); if (target) break; }
        else if (!screens) { if (target) screens=1; else add(tx,ty,false,true); }
        else if (target) { add(tx,ty,true,false); break; }
      }
    }
  } else if (type === 'horse') {
    for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      if (!inside(x+dx,y+dy) || game.board[y+dy][x+dx]) continue;
      if (dx) { add(x+2*dx,y+1); add(x+2*dx,y-1); }
      else { add(x+1,y+2*dy); add(x-1,y+2*dy); }
    }
  } else if (type === 'elephant') {
    for (const dx of [-1,1]) for (const dy of [-1,1]) if (inside(x+dx,y+dy) && !game.board[y+dy][x+dx]) add(x+2*dx,y+2*dy);
  } else if (type === 'advisor') {
    for (const dx of [-1,1]) for (const dy of [-1,1]) add(x+dx,y+dy);
  } else if (type === 'king') {
    for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      add(x+dx,y+dy);
    }
  } else if (type === 'pawn') {
    add(x,y+direction);
    if (direction === -1 ? y <= 4 : y >= 5) { add(x-1,y); add(x+1,y); }
  }
  return moves;
}
function move(game,side,from,to) {
  if (!from || !to || !inside(from.x,from.y) || !inside(to.x,to.y) || !legalMoves(game,from.x,from.y,side).some(p => p.x === to.x && p.y === to.y)) throw new Error('Illegal move');
  const piece=game.board[from.y][from.x], target=game.board[to.y][to.x];
  // A captured piece is removed from play; reveal its identity for both players.
  const captured=target ? {hidden:false,color:target.color,type:target.type} : null;
  game.board[from.y][from.x]=null;
  piece.hidden=false;
  game.board[to.y][to.x]=piece;
  game.lastMove={from:{x:from.x,y:from.y},to:{x:to.x,y:to.y},...(captured ? {captured}: {})};
  if (target && target.type === 'king') { game.winner=opposite(target.color); game.status='finished'; }
  else game.turn=opposite(side);
}
// The AI is given a separate public-position copy; hidden pieces carry only their public slot movement.
function aiMove(game, randomInt = crypto.randomInt) {
  if (game.status !== 'playing' || game.turn !== 'black') return false;
  const publicGame={...game,board:game.board.map(row => row.map(p => p && (p.hidden ? {hidden:true,slotType:p.slotType} : {hidden:false,color:p.color,type:p.type})))};
  const candidates=[];
  for(let y=0;y<10;y++) for(let x=0;x<9;x++) for(const to of legalMoves(publicGame,x,y,'black')) candidates.push({from:{x,y},to});
  if (!candidates.length) return false;
  const chosen=candidates[randomInt(candidates.length)]; move(game,'black',chosen.from,chosen.to); return true;
}
module.exports={initialGame,legalMoves,move,view,aiMove,inside};
