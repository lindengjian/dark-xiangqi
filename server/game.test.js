'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const G=require('./game');
const blank=()=>({board:Array.from({length:10},()=>Array(9).fill(null)),turn:'red',winner:null,status:'playing',lastMove:null,mode:'room'});
const put=(g,x,y,type,color='red',hidden=false,slotType=type)=>g.board[y][x]={type,color,hidden,slotType};
const has=(moves,x,y)=>moves.some(p=>p.x===x&&p.y===y);
test('initial identities and public view',()=>{const g=G.initialGame('ai'); const all=g.board.flat().filter(Boolean); assert.equal(all.length,32); assert.equal(all.filter(p=>p.type==='king').length,2); const s=JSON.stringify(G.view(g)); assert.equal((s.match(/"hidden":true/g)||[]).length,32); assert(!s.includes('slotType')); assert(!s.includes('king'));});
test('hidden selection is restricted to the current player half, regardless of identity',()=>{
  for (const [side, ownY, enemyY, forward] of [['red',5,4,4],['black',4,5,5]]) {
    for (const identity of ['red','black']) {
      const g=blank(); g.turn=side;
      put(g,4,ownY,'rook',identity,true,'pawn');
      assert(has(G.legalMoves(g,4,ownY),4,forward));
      g.board[ownY][4]=null;
      put(g,4,enemyY,'rook',identity,true,'pawn');
      assert.deepEqual(G.legalMoves(g,4,enemyY),[]);
      assert.throws(()=>G.move(g,side,{x:4,y:enemyY},{x:4,y:enemyY+(side==='red'?-1:1)}),/Illegal move/);
    }
  }
});
test('revealed pieces can be selected on either half by their owner',()=>{
  for (const [side,y] of [['red',4],['black',5]]) {
    const g=blank(); g.turn=side; put(g,4,y,'rook',side);
    assert(has(G.legalMoves(g,4,y),4,y+1));
  }
});
test('hidden piece uses original slot and current player direction',()=>{const g=blank(); put(g,4,6,'rook','black',true,'pawn'); assert(has(G.legalMoves(g,4,6),4,5)); assert(!has(G.legalMoves(g,4,6),4,7)); G.move(g,'red',{x:4,y:6},{x:4,y:5}); assert.deepEqual(G.view(g).board[5][4],{hidden:false,color:'black',type:'rook'});});
test('horse leg, elephant eye and unrestricted advisor and elephant',()=>{const g=blank(); put(g,4,4,'horse'); put(g,5,4,'pawn'); assert(!has(G.legalMoves(g,4,4),6,3)); assert(has(G.legalMoves(g,4,4),3,2)); g.board[4][4]=null; put(g,4,4,'elephant'); put(g,5,5,'pawn'); assert(!has(G.legalMoves(g,4,4),6,6)); assert(has(G.legalMoves(g,4,4),2,2)); put(g,0,0,'advisor'); assert(has(G.legalMoves(g,0,0),1,1));});
test('cannon screens and hidden captures',()=>{const g=blank(); put(g,0,0,'cannon'); put(g,0,2,'pawn'); put(g,0,4,'rook','red',true); assert(has(G.legalMoves(g,0,0),0,1)); assert(!has(G.legalMoves(g,0,0),0,2)); assert(has(G.legalMoves(g,0,0),0,4)); assert(!has(G.legalMoves(g,0,0),0,3)); G.move(g,'red',{x:0,y:0},{x:0,y:4}); assert.deepEqual(g.lastMove.captured,{hidden:false,color:'red',type:'rook'});});
test('revealed friendly pieces cannot be captured, hidden king can end game for opposing color',()=>{const g=blank(); put(g,0,0,'rook'); put(g,0,1,'pawn'); assert(!has(G.legalMoves(g,0,0),0,1)); put(g,0,1,'king','red',true); G.move(g,'red',{x:0,y:0},{x:0,y:1}); assert.equal(g.status,'finished'); assert.equal(g.winner,'black'); assert.deepEqual(g.lastMove.captured,{hidden:false,color:'red',type:'king'});});
test('pawn crossing and unrestricted king movement',()=>{const g=blank(); put(g,4,5,'pawn'); assert(!has(G.legalMoves(g,4,5),3,5)); put(g,4,4,'pawn'); assert(has(G.legalMoves(g,4,4),3,4)); put(g,3,0,'king'); assert(has(G.legalMoves(g,3,0),2,0)); assert(has(G.legalMoves(g,3,0),4,0)); assert(!has(G.legalMoves(g,3,0),2,1)); put(g,0,9,'pawn','black',true,'king'); assert(has(G.legalMoves(g,0,9),1,9)); assert(has(G.legalMoves(g,0,9),0,8)); assert.equal(G.legalMoves(g,0,9).length,2);});
test('AI choices independent of hidden identities',()=>{const a=G.initialGame('ai',()=>0); a.turn='black'; const b=structuredClone(a); for(const p of b.board.flat().filter(p=>p?.hidden)) {p.type='pawn';p.color='red';} G.aiMove(a,()=>0); G.aiMove(b,()=>0); assert.deepEqual(a.lastMove.from,b.lastMove.from); assert.deepEqual(a.lastMove.to,b.lastMove.to);});
test('HTTP rejects untrusted Host even without Origin',async()=>{const {server,rooms}=require('./server'); await new Promise(r=>server.listen(0,'127.0.0.1',r)); try { const status=await new Promise((resolve,reject)=>{const req=require('node:http').request({host:'127.0.0.1',port:server.address().port,path:'/api/create',method:'POST',headers:{host:'attacker.example','content-type':'application/json'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end(JSON.stringify({mode:'room'}));}); assert.equal(status,403); } finally {rooms.clear(); await new Promise(r=>server.close(r));}});
test('HTTP create join auth and move isolation',async()=>{const {server,rooms}=require('./server'); await new Promise(r=>server.listen(0,'127.0.0.1',r)); const base=`http://127.0.0.1:${server.address().port}`; const post=async(p,obj)=>{const r=await fetch(base+p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(obj)});return [r.status,await r.json()];}; try { const [,a]=await post('/api/create',{mode:'room'}); assert.equal(a.state.status,'waiting'); assert.equal((await post('/api/move',{room:a.room,token:a.token,from:{x:0,y:6},to:{x:0,y:5}}))[0],400); const [,b]=await post('/api/join',{room:a.room}); assert.equal(b.side,'black'); assert.equal((await post('/api/join',{room:a.room}))[0],409); assert.equal((await fetch(`${base}/api/state?room=${a.room}&token=bad`)).status,403); const [status,result]=await post('/api/move',{room:a.room,token:a.token,from:{x:0,y:6},to:{x:0,y:5}}); assert.equal(status,200); assert.equal(result.state.turn,'black'); assert(!JSON.stringify(result).includes('slotType')); assert.equal((await post('/api/move',{room:a.room,token:a.token,from:{x:2,y:6},to:{x:2,y:5}}))[0],400); } finally {rooms.clear(); await new Promise(r=>server.close(r));}});
