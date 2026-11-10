/* 暗棋象棋 — independent local practice, based on dark-xiangqi/game.js. */
(function () {
  'use strict';
  var canvas = document.getElementById('game');
  if (!canvas) { canvas = document.createElement('canvas'); canvas.id = 'game'; document.body.appendChild(canvas); }
  canvas.style.cssText += ';display:block;width:100vw;height:100vh;height:100dvh;touch-action:none;outline:none;background:#211a16';
  canvas.tabIndex = 0;
  var ctx = canvas.getContext('2d'), W = 700, H = 1200, scale = 1, ox = 0, oy = 0;
  var BACK = ['rook','horse','elephant','advisor','king','advisor','elephant','horse','rook'];
  var names = {red:{rook:'俥',horse:'傌',elephant:'相',advisor:'仕',king:'帥',cannon:'炮',pawn:'兵'},black:{rook:'車',horse:'馬',elephant:'象',advisor:'士',king:'將',cannon:'砲',pawn:'卒'}};
  var descriptionNames = {red:{rook:'车',horse:'马',elephant:'相',advisor:'仕',king:'帅',cannon:'炮',pawn:'兵'},black:{rook:'车',horse:'马',elephant:'象',advisor:'士',king:'将',cannon:'炮',pawn:'卒'}};
  var board, turn, winner, phase = 'title', selected = null, targets = [], lastMove = null, notice = '', captures = [], captureFocus = null, aiAt = 0, fps = 60, prev = 0;
  // The GitHub Pages build has no room API, so it hides the online buttons and
  // offers 同屏双人 (both players on one device) instead.
  var netAvailable = !window.DARK_XIANGQI_STATIC;
  var hotseat = false;
  var pickDifficulty = false;
  // 人机难度：简单随机，中等贪心，困难带前瞻搜索。
  var DIFFICULTY = 'medium';
  var DIFF_LABELS = {easy:'简单', medium:'中等', hard:'困难'};
  var DIFF_ORDER = ['easy','medium','hard'];
  var PIECE_VALUE = {pawn:1, advisor:2, elephant:2, horse:4, cannon:4.5, rook:9, king:100};
  var MATE = 10000;
  try { var savedDiff = localStorage.getItem('dark-xiangqi-difficulty'); if (savedDiff && DIFF_LABELS[savedDiff]) DIFFICULTY = savedDiff; } catch (e) {}
  function setDifficulty(d) { if (!DIFF_LABELS[d]) return; DIFFICULTY = d; try { localStorage.setItem('dark-xiangqi-difficulty', d); } catch (e) {} }
  var blurBuffer = document.createElement('canvas'), blurContext = blurBuffer.getContext('2d');
  var resultEffect=null;
  var online=null, onlineEpoch=0, onlineBusy=false, onlineSelecting=0, pollTimer=null, confirmExit=false, rematchBusy=false;
  var ROOM_SESSION='dark-xiangqi-room-session', inviteFeedback='', inviteFeedbackUntil=0;
  function saveRoomSession(value){try{if(value)sessionStorage.setItem(ROOM_SESSION,JSON.stringify(value));else sessionStorage.removeItem(ROOM_SESSION);}catch(e){}}
  function readRoomSession(){try{return JSON.parse(sessionStorage.getItem(ROOM_SESSION)||'null');}catch(e){return null;}}
  function validRoom(code){return typeof code==='string'&&/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(code);}
  function newJoinKey(){try{var bytes=new Uint8Array(24);window.crypto.getRandomValues(bytes);return Array.from(bytes,function(b){return b.toString(16).padStart(2,'0');}).join('');}catch(e){return null;}}
  function showInviteFeedback(message){inviteFeedback=message;inviteFeedbackUntil=Date.now()+10000;}
  function currentNotice(){return Date.now()<inviteFeedbackUntil?inviteFeedback:notice;}
  function leaveOnline(){onlineEpoch++;online=null;onlineBusy=false;onlineSelecting++;confirmExit=false;flipped=false;rematchBusy=false;inviteFeedbackUntil=0;saveRoomSession(null);if(pollTimer)clearTimeout(pollTimer);pollTimer=null;}
  function leaveRoom(){leaveOnline();pickDifficulty=false;phase='title';board=null;notice='已退出房间';captures=[];selected=null;targets=[];}
  function api(path,options){return fetch(path,options).then(function(r){return r.json().catch(function(){throw new Error('服务响应无效');}).then(function(data){if(!r.ok){var error=new Error(data.error||'请求失败');error.status=r.status;throw error;}return data;});});}
  function post(path,data){return api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),cache:'no-store'});}
  function query(path,extra){var p=new URLSearchParams({room:online.room,token:online.token});if(extra)Object.keys(extra).forEach(function(k){p.set(k,extra[k]);});return api(path+'?'+p.toString(),{cache:'no-store'});}
  function onlineError(e){var msg=e&&e.message||'';return /Room not found/i.test(msg)?'房间不存在或已失效':/Room is full/i.test(msg)?'房间已满':/Illegal move/i.test(msg)?'走法无效，正在同步':/Invalid token/i.test(msg)?'房间身份已失效':'网络不可用：请通过同源服务器页面打开；Studio 预览禁止联网';}
  function applyState(s,initial,meta){
    if(!online||!s||!Array.isArray(s.board))return;
    if(meta&&Array.isArray(meta.rematch))online.rematch=meta.rematch;
    if(meta&&typeof meta.round==='number')online.round=meta.round;
    var newRound=!!online.finished&&s.status==='playing';
    if(newRound){online.finished=false;captures=[];captureFocus=null;resultEffect=null;online.rematch=[];selected=null;targets=[];onlineSelecting++;}
    var oldBoard=board, oldSignature=online.signature, signature=JSON.stringify([s.board,s.turn,s.status,s.lastMove]);
    if(!initial&&oldSignature!==signature&&s.lastMove&&oldBoard){
      var m=s.lastMove, victim=oldBoard[m.to.y]&&oldBoard[m.to.y][m.to.x], attacker=s.board[m.to.y]&&s.board[m.to.y][m.to.x], cap=m.captured, actor=turn;
      soundMove(!!cap);
      if(cap&&attacker){captures.push({actor:actor,color:cap.color,type:cap.type,wasHidden:!!(victim&&victim.hidden)});captureFocus={actor:actor,attacker:attacker,victim:cap,wasHidden:!!(victim&&victim.hidden),started:performance.now(),duration:2400};}
      selected=null;targets=[];onlineSelecting++;
    }
    if(online.status==='waiting'&&s.status!=='waiting')inviteFeedbackUntil=0;
    board=s.board;turn=s.turn;winner=s.winner;lastMove=s.lastMove;online.signature=signature;online.status=s.status;syncFlip();
    phase=s.status==='finished'?(winner===online.side?'won':'lost'):'playing';
    if(s.status==='finished'&&!online.finished){online.finished=true;resultEffect={shown:false,started:0,particles:[]};}
    notice=newRound?'第 '+(online.round||1)+' 局开始':s.status==='waiting'?'等待另一位玩家加入':s.status==='finished'?(rematchAsked()?'已请求再来一局，等待对方同意':opponentAsked()?'对方想再来一局，点「再来一局」开始':'对局结束 · 可再来一局'):turn===online.side?'轮到你行棋':'等待对方行棋';
  }
  function poll(epoch){if(!online||epoch!==onlineEpoch)return;if(onlineBusy){pollTimer=setTimeout(function(){poll(epoch);},700);return;}onlineBusy=true;query('/api/state').then(function(data){if(epoch===onlineEpoch)applyState(data.state,false,data);}).catch(function(e){if(epoch===onlineEpoch)notice=onlineError(e);}).finally(function(){if(epoch!==onlineEpoch)return;onlineBusy=false;pollTimer=setTimeout(function(){poll(epoch);},1000);});}
  function adoptRoom(data){
    if(!data||!validRoom(data.room)||typeof data.token!=='string'||!data.state||!Array.isArray(data.state.board)||(data.side!=='red'&&data.side!=='black'))throw new Error('服务响应无效');
    online={room:data.room,token:data.token,side:data.side,status:data.state.status,signature:null,finished:false,rematch:[],round:data.round||1};
    saveRoomSession({room:online.room,token:online.token,side:online.side});
    rematchBusy=false;captures=[];captureFocus=null;resultEffect=null;aiAt=0;selected=null;targets=[];applyState(data.state,true,data);
  }
  function openRoom(join,inviteCode,retryKey){
    if(onlineBusy)return;var code=join?(inviteCode===undefined?window.prompt('请输入六位房间号'):inviteCode):null;
    if(join&&code===null)return;if(join){code=String(code).trim().toUpperCase();if(!validRoom(code)){notice='请输入有效的六位房间号';return;}}
    leaveOnline();var epoch=onlineEpoch;onlineBusy=true;notice=join?'正在加入房间…':'正在创建房间…';
    var joinKey=join?(retryKey||newJoinKey()):null, body=join?{room:code}:{mode:'room'};
    if(joinKey){body.joinKey=joinKey;saveRoomSession({room:code,joinKey:joinKey,pending:true});}
    post(join?'/api/join':'/api/create',body).then(function(data){if(epoch===onlineEpoch)adoptRoom(data);}).catch(function(e){
      if(epoch!==onlineEpoch)return;
      // Keep an uncertain join for an idempotent retry after refresh; definitive 4xx errors cannot have claimed a seat.
      if(e.status>=400&&e.status<500)saveRoomSession(null);
      notice=onlineError(e)+(joinKey&&!e.status?' · 可刷新页面重试':'');
    }).finally(function(){if(epoch!==onlineEpoch)return;onlineBusy=false;if(online)poll(epoch);});
  }
  function restoreRoom(saved){
    var epoch=onlineEpoch;onlineBusy=true;notice='正在恢复房间…';
    var params=new URLSearchParams({room:saved.room,token:saved.token});
    api('/api/state?'+params.toString(),{cache:'no-store'}).then(function(data){if(epoch===onlineEpoch)adoptRoom({room:saved.room,token:saved.token,side:saved.side,state:data.state,round:data.round,rematch:data.rematch});}).catch(function(e){if(epoch!==onlineEpoch)return;if(e.status===403||e.status===404)saveRoomSession(null);notice=onlineError(e);}).finally(function(){if(epoch!==onlineEpoch)return;onlineBusy=false;if(online)poll(epoch);});
  }
  function startFromInvite(){
    if(!/^https?:$/.test(window.location.protocol))return;
    var url=new URL(window.location.href), raw=url.searchParams.get('room'), saved=readRoomSession(), code;
    if(raw!==null){
      url.searchParams.delete('room');try{history.replaceState(history.state,'',url.href);}catch(e){}
      code=raw.trim().toUpperCase();
      if(!netAvailable){notice='此页面不支持房间对战，请使用邀请方的服务器链接';return;}
      if(!validRoom(code)){notice='邀请链接无效，请让对方重新发送';return;}
      if(!saved||saved.room!==code){openRoom(true,code);return;}
    }
    if(!netAvailable||!saved||!validRoom(saved.room))return;
    if(saved.pending&&/^[a-f0-9]{48}$/.test(saved.joinKey||'')){openRoom(true,saved.room,saved.joinKey);return;}
    if(typeof saved.token==='string'&&(saved.side==='red'||saved.side==='black'))restoreRoom(saved);
  }
  function loopbackAddress(){var host=window.location.hostname.toLowerCase();return host==='localhost'||host.endsWith('.localhost')||host==='[::1]'||host==='::1'||/^127\./.test(host)||host==='0.0.0.0';}
  function copyInviteFallback(url){
    var input=document.createElement('textarea'), copied=false;input.value=url;input.setAttribute('readonly','');
    input.style.cssText='position:fixed;left:-9999px;top:0;opacity:0;user-select:text;-webkit-user-select:text';document.body.appendChild(input);
    try{input.focus();input.select();input.setSelectionRange(0,input.value.length);copied=document.execCommand('copy');}catch(e){}
    input.remove();if(!copied){try{window.prompt('请复制邀请链接，发送给对方：',url);}catch(e){} }return copied;
  }
  function inviteOpponent(){
    if(!online||online.status!=='waiting')return;
    var url=new URL(window.location.href);url.username='';url.password='';url.search='';url.hash='';url.searchParams.set('room',online.room);var link=url.href, epoch=onlineEpoch, loopback=loopbackAddress();
    function report(copied){if(epoch!==onlineEpoch)return;showInviteFeedback(loopback?'本机地址仅自己可用，请用局域网地址打开后再邀请':copied?'邀请链接已复制，发给对方即可':'请手动复制邀请链接');}
    function copy(){
      if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(link).then(function(){report(true);}).catch(function(){report(copyInviteFallback(link));});}
      else report(copyInviteFallback(link));
    }
    // Never suggest a loopback URL in the native share sheet without warning.
    if(!loopback&&navigator.share){navigator.share({title:'邀请你来下暗棋',text:'点击链接加入我的房间',url:link}).then(function(){if(epoch===onlineEpoch)showInviteFeedback('邀请链接已分享');}).catch(function(e){if(e&&e.name==='AbortError')return;copy();});}
    else copy();
  }
  function clickOnline(x,y){
    if(!online||onlineBusy||online.status!=='playing'||turn!==online.side)return;
    var epoch=onlineEpoch;
    if(selected&&targets.some(function(t){return t.x===x&&t.y===y;})){var from=selected;selected=null;targets=[];onlineSelecting++;onlineBusy=true;post('/api/move',{room:online.room,token:online.token,from:from,to:{x:x,y:y}}).then(function(data){if(epoch===onlineEpoch)applyState(data.state,false,data);}).catch(function(e){if(epoch===onlineEpoch)notice=onlineError(e);}).finally(function(){if(epoch===onlineEpoch)onlineBusy=false;});return;}
    selected=null;targets=[];var p=board[y][x];if(!p)return;var seq=++onlineSelecting;query('/api/moves',{x:x,y:y}).then(function(data){if(epoch!==onlineEpoch||seq!==onlineSelecting||!online||turn!==online.side)return;selected={x:x,y:y};targets=data.moves;}).catch(function(e){if(epoch===onlineEpoch)notice=onlineError(e);});
  }
  function rematchAsked(){return !!(online&&online.rematch&&online.rematch.indexOf(online.side)>=0);}
  function opponentAsked(){return !!(online&&online.rematch&&online.rematch.some(function(s){return s!==online.side;}));}
  function requestRematch(){
    if(!online||rematchBusy||online.status!=='finished'||rematchAsked())return;
    var epoch=onlineEpoch;rematchBusy=true;
    post('/api/rematch',{room:online.room,token:online.token}).then(function(data){if(epoch===onlineEpoch)applyState(data.state,false,data);}).catch(function(e){if(epoch===onlineEpoch)notice=onlineError(e);}).finally(function(){if(epoch===onlineEpoch)rematchBusy=false;});
  }
  var bx = 62, by = 100, step = 72, radius = 30;
  var audio=null, musicGain=null, effectsGain=null, musicOn=true, effectsOn=true, nextNote=0, noteIndex=0;
  // Master bus levels; the per-note amplitudes stay quiet so a 2x bus keeps headroom.
  var MUSIC_VOLUME=2, EFFECTS_VOLUME=2;
  // A slow pentatonic melody with overlapping notes and a sustained chord each bar.
  var melody=[293.66,329.63,392,440,392,329.63,293.66,261.63, 293.66,329.63,392,523.25,440,392,329.63,293.66, 261.63,293.66,329.63,392,329.63,293.66,261.63,220, 261.63,293.66,329.63,392,329.63,293.66,261.63,293.66];
  var chords=[[146.83,220,293.66],[130.81,196,261.63],[110,164.81,220],[130.81,196,261.63]];
  function enableAudio(){
    try { var AudioEngine=window.AudioContext||window.webkitAudioContext;if(!audio&&AudioEngine){audio=new AudioEngine();musicGain=audio.createGain();effectsGain=audio.createGain();musicGain.gain.value=musicOn?MUSIC_VOLUME:0;effectsGain.gain.value=effectsOn?EFFECTS_VOLUME:0;musicGain.connect(audio.destination);effectsGain.connect(audio.destination);}if(audio&&audio.state==='suspended')audio.resume().catch(function(){}); }
    catch(e){audio=null;}
  }
  function tone(freq,at,length,volume,kind,bus,attack){
    if(!audio||audio.state!=='running')return;
    var osc=audio.createOscillator(),gain=audio.createGain();osc.type=kind||'sine';osc.frequency.setValueAtTime(freq,at);
    gain.gain.setValueAtTime(.0001,at);gain.gain.exponentialRampToValueAtTime(volume,at+(attack||.015));gain.gain.exponentialRampToValueAtTime(.0001,at+length);
    osc.connect(gain);gain.connect(bus||effectsGain);osc.start(at);osc.stop(at+length+.02);
  }
  function soundMove(capture){if(!audio||!effectsOn)return;var t=audio.currentTime;tone(capture?185:440,t,capture ? .23 : .09,capture ? .12 : .065,'triangle');if(capture){tone(110,t+.035,.32,.09,'sine');tone(660,t+.12,.24,.055,'sine');}}
  function soundResult(win){if(!audio||!effectsOn||audio.state!=='running')return;var t=audio.currentTime,seq=win?[392,493.88,587.33,783.99]:[392,329.63,261.63,196];seq.forEach(function(n,i){tone(n,t+i*.18,win ? .55 : .7,.08,'triangle');});}
  function music(){
    if(!audio||!musicOn||audio.state!=='running')return;
    var now=audio.currentTime;if(nextNote<now-.2)nextNote=now+.03;
    while(nextNote<now+.15){var n=melody[noteIndex%melody.length];tone(n,nextNote,1.35,.022,'sine',musicGain,.18);tone(n*2,nextNote,1.1,.004,'sine',musicGain,.22);if(noteIndex%8===0){var chord=chords[Math.floor(noteIndex/8)%chords.length];chord.forEach(function(f){tone(f,nextNote,5.6,.006,'sine',musicGain,.65);});}noteIndex++;nextNote+=.64;}
  }
  function opposite(c) { return c === 'red' ? 'black' : 'red'; }
  function inside(x,y) { return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < 9 && y >= 0 && y < 10; }
  function randomInt(n) {
    if (window.crypto && window.crypto.getRandomValues) { var a = new Uint32Array(1), limit = Math.floor(4294967296 / n) * n; do { window.crypto.getRandomValues(a); } while (a[0] >= limit); return a[0] % n; }
    return Math.floor(Math.random() * n);
  }
  function start(mode) {
    leaveOnline();
    pickDifficulty = false;
    hotseat = mode === 'hotseat';
    board = Array.from({length:10}, function () { return Array(9).fill(null); });
    var slots = [], identities;
    [['black',0,2,3],['red',9,7,6]].forEach(function (v) {
      BACK.forEach(function (type,x) { slots.push({x:x,y:v[1],type:type,color:v[0]}); });
      [1,7].forEach(function (x) { slots.push({x:x,y:v[2],type:'cannon',color:v[0]}); });
      [0,2,4,6,8].forEach(function (x) { slots.push({x:x,y:v[3],type:'pawn',color:v[0]}); });
    });
    identities = slots.map(function (s) { return {type:s.type,color:s.color}; });
    for (var i=identities.length-1;i>0;i--) { var j=randomInt(i+1), t=identities[i]; identities[i]=identities[j]; identities[j]=t; }
    slots.forEach(function (s,i) { board[s.y][s.x] = {type:identities[i].type,color:identities[i].color,hidden:true,slotType:s.type}; });
    turn='red'; winner=null; phase='playing'; selected=null; targets=[]; lastMove=null; notice=''; captures=[]; captureFocus=null; resultEffect=null; aiAt=0;
  }
  // Hidden identities are removed before move enumeration, including for the AI.
  function publicBoard() { return board.map(function (row) { return row.map(function (p) { return !p ? null : p.hidden ? {hidden:true,slotType:p.slotType} : {hidden:false,color:p.color,type:p.type}; }); }); }
  function legal(b,x,y,side) {
    if (!inside(x,y)) return [];
    var p=b[y][x]; if (!p || (!p.hidden && p.color !== side) || (p.hidden && (side==='red' ? y<5 : y>4))) return [];
    var type=p.hidden?p.slotType:p.type, direction=(p.hidden?side:p.color)==='red'?-1:1, moves=[];
    function add(tx,ty,cap,empty) { if (!inside(tx,ty)) return; var q=b[ty][tx]; if (q ? cap!==false && (q.hidden || q.color!==side) : empty!==false) moves.push({x:tx,y:ty}); }
    var dirs=[[1,0],[-1,0],[0,1],[0,-1]];
    if(type==='rook'||type==='cannon') dirs.forEach(function(d){ var screens=0; for(var tx=x+d[0],ty=y+d[1];inside(tx,ty);tx+=d[0],ty+=d[1]) { var q=b[ty][tx]; if(type==='rook'){add(tx,ty);if(q)break;} else if(!screens){if(q)screens=1;else add(tx,ty,false,true);}else if(q){add(tx,ty,true,false);break;} } });
    else if(type==='horse') dirs.forEach(function(d){var dx=d[0],dy=d[1];if(!inside(x+dx,y+dy)||b[y+dy][x+dx])return;if(dx){add(x+2*dx,y+1);add(x+2*dx,y-1);}else{add(x+1,y+2*dy);add(x-1,y+2*dy);}});
    else if(type==='elephant') [-1,1].forEach(function(dx){[-1,1].forEach(function(dy){if(inside(x+dx,y+dy)&&!b[y+dy][x+dx])add(x+2*dx,y+2*dy);});});
    else if(type==='advisor') [-1,1].forEach(function(dx){[-1,1].forEach(function(dy){add(x+dx,y+dy);});});
    else if(type==='king') dirs.forEach(function(d){add(x+d[0],y+d[1]);});
    else if(type==='pawn'){add(x,y+direction);if(direction===-1?y<=4:y>=5){add(x-1,y);add(x+1,y);}}
    return moves;
  }
  function candidates(side) { var b=publicBoard(), list=[]; for(var y=0;y<10;y++)for(var x=0;x<9;x++) legal(b,x,y,side).forEach(function(to){list.push({from:{x:x,y:y},to:to});}); return list; }
  function play(from,to) {
    if(phase!=='playing'||!legal(publicBoard(),from.x,from.y,turn).some(function(m){return m.x===to.x&&m.y===to.y;})) return false;
    var p=board[from.y][from.x], q=board[to.y][to.x], side=turn;
    soundMove(!!q);
    if(q) {
      captures.push({actor:side, color:q.color, type:q.type, wasHidden:q.hidden});
      captureFocus={actor:side, attacker:{color:p.color,type:p.type,hidden:false}, victim:{color:q.color,type:q.type,hidden:false}, wasHidden:q.hidden, started:performance.now(), duration:2400};
    }
    board[from.y][from.x]=null; p.hidden=false; board[to.y][to.x]=p;
    lastMove={from:from,to:to,captured:q?{type:q.type,color:q.color}:null}; selected=null;targets=[];
    notice=q ? '吃掉 '+(q.color==='red'?'红':'黑')+' '+descriptionNames[q.color][q.type] : '落子翻明 · '+(p.color==='red'?'红':'黑')+' '+descriptionNames[p.color][p.type];
    if(q && q.type==='king'){winner=opposite(q.color);phase=winner==='red'?'won':'lost';resultEffect={shown:false,started:0,particles:[]};}
    else {turn=opposite(side); if(!candidates(turn).length) notice=(turn==='red'?'红方':'黑方')+'无棋可走，请重新开始'; else if(turn==='black'&&!hotseat) aiAt=performance.now()+aiDelay();}
    return true;
  }
  // ---- 人机难度引擎 -------------------------------------------------------
  // 只用公开信息：隐藏棋一律按「未知」处理，不读取任何暗子身份。
  function simClone(b) {
    return b.map(function (row) {
      return row.map(function (p) { return !p ? null : p.hidden ? {hidden:true, slotType:p.slotType} : {hidden:false, color:p.color, type:p.type}; });
    });
  }
  function allMoves(b, side) {
    var list = [];
    for (var y=0; y<10; y++) for (var x=0; x<9; x++) {
      var ms = legal(b, x, y, side);
      for (var i=0; i<ms.length; i++) list.push({from:{x:x,y:y}, to:ms[i]});
    }
    return list;
  }
  // 落子后：明棋保持明面；暗棋在推演里仍视为未知（AI 无从预知翻出什么）。
  function simApply(b, from, to) {
    var p = b[from.y][from.x], q = b[to.y][to.x];
    b[from.y][from.x] = null;
    b[to.y][to.x] = p.hidden ? {hidden:true, slotType:p.slotType} : {hidden:false, color:p.color, type:p.type};
    return {captured:q, kingTaken: !!(q && !q.hidden && q.type==='king')};
  }
  function evalBoard(b, side) {
    var score = 0;
    for (var y=0; y<10; y++) for (var x=0; x<9; x++) {
      var p = b[y][x];
      if (!p || p.hidden) continue;
      var v = PIECE_VALUE[p.type] || 1;
      score += p.color === side ? v : -v;
    }
    return score;
  }
  // 剩余暗子数：总数 32 减去已翻明、已被吃，全部是公开信息。
  function hiddenPool() {
    var revealedRed = 0, revealedBlack = 0, hidden = 0;
    for (var y=0; y<10; y++) for (var x=0; x<9; x++) {
      var p = board[y][x];
      if (!p) continue;
      if (p.hidden) hidden++;
      else if (p.color === 'red') revealedRed++;
      else revealedBlack++;
    }
    var takenRed = 0, takenBlack = 0;
    captures.forEach(function (c) { if (c.color === 'red') takenRed++; else takenBlack++; });
    return {total:hidden, red:Math.max(0, 16 - revealedRed - takenRed), black:Math.max(0, 16 - revealedBlack - takenBlack)};
  }
  // 吃暗子有风险：可能吃掉的正是己方子，甚至是己方将帅。
  function hiddenCaptureCost(pool, side) {
    if (pool.total <= 0) return 0;
    var own = side === 'red' ? pool.red : pool.black;
    var ownKingHidden = !board.some(function (row) { return row.some(function (p) { return p && !p.hidden && p.color === side && p.type === 'king'; }); });
    var pOwn = own / pool.total;
    var pOwnKing = ownKingHidden ? 1 / pool.total : 0;
    return -(pOwn * 3.5 * 0.35) - pOwnKing * 80;
  }
  function moveScore(b, m, side, pool) {
    var q = b[m.to.y][m.to.x], p = b[m.from.y][m.from.x];
    if (!q) return 0;
    if (q.hidden) return hiddenCaptureCost(pool, side);
    return (PIECE_VALUE[q.type] || 1) * (p.hidden ? 0.5 : 1);
  }
  function orderedMoves(b, side, pool) {
    var list = allMoves(b, side);
    list.forEach(function (m) { m.rank = moveScore(b, m, side, pool); });
    list.sort(function (a, c) { return c.rank - a.rank; });
    return list;
  }
  var searchNodes = 0, searchLimit = 0, searchDeadline = 0, searchAborted = false;
  function search(b, side, depth, alpha, beta, rootSide, pool) {
    if (searchAborted) return evalBoard(b, rootSide);
    if ((searchNodes++ & 255) === 0 && searchDeadline && performance.now() > searchDeadline) { searchAborted = true; return evalBoard(b, rootSide); }
    if (searchNodes > searchLimit) { searchAborted = true; return evalBoard(b, rootSide); }
    if (depth === 0) return evalBoard(b, rootSide);
    var moves = orderedMoves(b, side, pool);
    if (!moves.length) return evalBoard(b, rootSide);
    var maximizing = side === rootSide, best = maximizing ? -Infinity : Infinity;
    for (var i=0; i<moves.length; i++) {
      var nb = simClone(b), res = simApply(nb, moves[i].from, moves[i].to), value;
      if (res.kingTaken) value = maximizing ? MATE - (10 - depth) : -MATE + (10 - depth);
      else value = search(nb, opposite(side), depth - 1, alpha, beta, rootSide, pool);
      if (maximizing) { if (value > best) best = value; if (best > alpha) alpha = best; }
      else { if (value < best) best = value; if (best < beta) beta = best; }
      if (beta <= alpha) break;
      if (searchNodes > searchLimit) break;
    }
    return best;
  }
  // 单层搜索：返回该层最好的走法；搜索被时间/节点预算打断时返回 null。
  function searchRoot(b, side, depth, pool) {
    var moves = orderedMoves(b, side, pool);
    if (!moves.length) return null;
    var best = -Infinity, picks = [];
    for (var i=0; i<moves.length; i++) {
      var nb = simClone(b), res = simApply(nb, moves[i].from, moves[i].to), value;
      if (res.kingTaken) value = MATE;
      else value = search(nb, opposite(side), depth - 1, -Infinity, Infinity, side, pool);
      if (searchAborted) return null;
      // 同分时轻微偏好向前推进，避免原地打转。
      value += (moves[i].to.y - moves[i].from.y) * (side === 'black' ? 0.01 : -0.01);
      if (value > best + 1e-9) { best = value; picks = [moves[i]]; }
      else if (Math.abs(value - best) <= 1e-9) picks.push(moves[i]);
    }
    return picks[randomInt(picks.length)];
  }
  // 迭代加深：逐层加深，只保留完整跑完的那一层结果，时间到就收手。
  function chooseMove(side, depth, budgetMs) {
    var b = publicBoard(), pool = hiddenPool();
    var moves = orderedMoves(b, side, pool);
    if (!moves.length) return null;
    if (depth <= 0) return moves[randomInt(moves.length)];
    searchNodes = 0; searchLimit = 200000;
    searchDeadline = performance.now() + (budgetMs || 400); searchAborted = false;
    var bestMove = null;
    for (var d = 1; d <= depth; d++) {
      var candidate = searchRoot(b, side, d, pool);
      if (!candidate || searchAborted) break;
      bestMove = candidate;
      if (performance.now() > searchDeadline) break;
    }
    return bestMove || moves[randomInt(moves.length)];
  }
  function aiDelay() { return DIFFICULTY === 'hard' ? 520 : DIFFICULTY === 'medium' ? 450 : 380; }
  function ai() {
    if (phase !== 'playing' || turn !== 'black') return;
    var move = null;
    if (DIFFICULTY === 'easy') {
      var list = candidates('black');
      move = list.length ? list[randomInt(list.length)] : null;
    } else if (DIFFICULTY === 'medium') {
      // 两层：走完之后再看对手的回应，避免白送子。
      move = chooseMove('black', 2, 120);
      if (!move) { var l2 = candidates('black'); move = l2.length ? l2[randomInt(l2.length)] : null; }
    } else {
      // 困难：迭代加深到四层，单步最多 450ms，保证不会卡住。
      move = chooseMove('black', 4, 450);
      if (!move) { var l3 = candidates('black'); move = l3.length ? l3[randomInt(l3.length)] : null; }
    }
    if (move) play(move.from, move.to); else aiAt = 0;
  }
  function clickBoard(x,y) {
    if(phase!=='playing'||(!hotseat&&turn!=='red'))return;
    if(selected && targets.some(function(t){return t.x===x&&t.y===y;})){play(selected,{x:x,y:y});return;}
    var p=board[y][x], mine=false;
    if(p) mine = hotseat ? (p.hidden ? (turn==='red' ? y>=5 : y<=4) : p.color===turn) : ((p.hidden&&y>=5)||(!p.hidden&&p.color==='red'));
    if(mine){selected={x:x,y:y};targets=legal(publicBoard(),x,y,turn);}else{selected=null;targets=[];}
  }
  var dpr=1, viewW=W, viewH=H;
  // iOS Safari reports the large viewport in 100vh, so a fixed 100vh hides the bottom
  // rows behind the toolbar. The visible viewport is the truth: size the canvas to it,
  // then fit the whole 700x1200 design inside it (height first, so nothing is cut).
  function visibleViewport(){var vv=window.visualViewport;return {w:(vv&&vv.width)||window.innerWidth||W,h:(vv&&vv.height)||window.innerHeight||H};}
  function applyTransform(){ctx.setTransform(dpr*scale,0,0,dpr*scale,dpr*ox,dpr*oy);}
  function resize(){
    var vp=visibleViewport();viewW=Math.max(1,Math.round(vp.w));viewH=Math.max(1,Math.round(vp.h));
    dpr=Math.min(window.devicePixelRatio||1,2);
    canvas.style.width=viewW+'px';canvas.style.height=viewH+'px';
    canvas.width=Math.round(viewW*dpr);canvas.height=Math.round(viewH*dpr);
    scale=Math.min(viewW/W,viewH/H);ox=(viewW-W*scale)/2;oy=(viewH-H*scale)/2;
    applyTransform();
  }
  function rect(x,y,w,h,r,fill,stroke){ctx.beginPath();ctx.roundRect(x,y,w,h,r);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.stroke();}}
  function text(s,x,y,size,color,align){ctx.fillStyle=color;ctx.font=size+'px "Songti SC", "STSong", serif';ctx.textAlign=align||'left';ctx.textBaseline='middle';ctx.fillText(s,x,y);}
  function line(x1,y1,x2,y2){ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();}
  function button(x,y,w,h,label,active){rect(x,y,w,h,7,active?(online?accent():'#963d2e'):'#493a30','#ba9870');text(label,x+w/2,y+h/2,18,'#f4e1bc','center');}
  function drawPiece(p,x,y){
    ctx.save();ctx.shadowColor='rgba(40,22,12,.38)';ctx.shadowBlur=7;ctx.shadowOffsetY=3;
    ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.fillStyle=p.hidden?'#805a39':'#efd5a6';ctx.fill();ctx.restore();
    ctx.beginPath();ctx.arc(x,y,radius-3,0,Math.PI*2);ctx.lineWidth=1.5;ctx.strokeStyle=p.hidden?'#d0ad7a':p.color==='red'?'#a7352b':'#40382e';ctx.stroke();
    ctx.beginPath();ctx.arc(x,y,radius-6,0,Math.PI*2);ctx.lineWidth=.6;ctx.stroke();
    text(p.hidden?'隱':names[p.color][p.type],x,y+1,p.hidden?21:27,p.hidden?'#e7cba0':p.color==='red'?'#a12e25':'#302b28','center');
  }
  // 点「人机对弈」后先选难度；一局结束后也能从这里换。
  function drawDifficultyPicker(){
    ctx.fillStyle='rgba(25,17,12,.72)';ctx.fillRect(0,0,W,H);
    ctx.save();ctx.shadowColor='rgba(0,0,0,.45)';ctx.shadowBlur=26;rect(70,286,560,506,18,'#f1dfbb','#d5ac72');ctx.restore();
    text('选择人机难度',350,344,28,accent(),'center');
    text('简单随手走 · 中等抢子力 · 困难算三步',350,386,15,'#7d6a55','center');
    DIFF_ORDER.forEach(function(d,i){
      var y=414+i*92, on=DIFFICULTY===d;
      rect(140,y,420,72,8,on?'#963d2e':'#e7d3b2',on?'#c8a274':'#c9ad85');
      text(DIFF_LABELS[d],216,y+36,24,on?'#f7e5c2':'#5e4c3c','center');
      text(d==='easy'?'随机走子，适合上手':d==='medium'?'会抢吃子力，偶有失误':'三步搜索，会护子设套',372,y+36,15,on?'#efdcc0':'#8c7962','center');
    });
    button(200,700,300,64,'取消',false);
  }
  function drawExitConfirm(){
    ctx.fillStyle='rgba(25,17,12,.62)';ctx.fillRect(0,0,W,H);
    ctx.save();ctx.shadowColor='rgba(0,0,0,.45)';ctx.shadowBlur=26;rect(70,430,560,300,18,'#f1dfbb','#d5ac72');ctx.restore();
    text('退出房间',350,486,27,accent(),'center');
    text('退出后本局结束，房间号不再保留',350,532,17,'#6b5947','center');
    button(110,600,240,76,'继续对局',true);
    button(350,600,240,76,'确认退出',false);
  }
  var flipped=false;
  // Theme accent follows the player's side: 朱砂 for red, 玄墨 for black,
  // and a warm 花青 for practice/title where there is no room identity.
  var THEME={red:'#a12e25',black:'#2b2a27',base:'#2c4f6b'};
  function accent(){return online?(online.side==='red'?THEME.red:THEME.black):THEME.base;}
  function syncFlip(){flipped=!!(online&&online.side==='black');}
  function px(x){return bx+(flipped?8-x:x)*step;}
  function py(y){return by+(flipped?9-y:y)*step;}
  function drawCaptureFocus(now){
    var f=captureFocus, elapsed=now-f.started, progress=Math.max(0,Math.min(1,elapsed/450)), eased=1-Math.pow(1-progress,3);
    if(blurBuffer.width!==canvas.width||blurBuffer.height!==canvas.height){blurBuffer.width=canvas.width;blurBuffer.height=canvas.height;}
    blurContext.clearRect(0,0,blurBuffer.width,blurBuffer.height);blurContext.drawImage(canvas,0,0);
    ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.filter='blur(7px)';ctx.drawImage(blurBuffer,0,0);ctx.filter='none';ctx.restore();
    ctx.fillStyle='rgba(25,17,12,.63)';ctx.fillRect(0,0,W,H);
    ctx.save();ctx.shadowColor='rgba(0,0,0,.45)';ctx.shadowBlur=28;rect(45,410,610,360,18,'#f1dfbb','#d5ac72');ctx.restore();
    text((f.actor==='red'?'红方':'黑方')+'  ·  吃子',350,452,27,'#805338','center');
    ctx.save();ctx.translate(210+20*eased,575);ctx.scale(2,2);drawPiece(f.attacker,0,0);ctx.restore();
    ctx.save();ctx.translate(490,575);ctx.scale(2,2);drawPiece(f.victim,0,0);ctx.restore();
    text('吃掉',355,575,25,'#9b4936','center');
    text((f.attacker.color==='red'?'红':'黑')+descriptionNames[f.attacker.color][f.attacker.type],230,666,21,f.attacker.color==='red'?'#a12e25':'#302b28','center');
    text((f.victim.color==='red'?'红':'黑')+descriptionNames[f.victim.color][f.victim.type]+(f.wasHidden?' · 暗子揭晓':''),490,666,21,f.victim.color==='red'?'#a12e25':'#302b28','center');
    text('棋局将自动继续 · 点击可关闭',350,726,17,'#9b8060','center');
  }
  function beginResult(now){
    var win=winner===(online?online.side:'red');resultEffect.shown=true;resultEffect.started=now;soundResult(win);
    for(var burst=0;burst<5;burst++){var cx=70+Math.random()*560,cy=250+Math.random()*650,delay=burst*.45;for(var i=0;i<24;i++){var a=i*Math.PI*2/24,s=35+Math.random()*80;resultEffect.particles.push({x:cx,y:cy,vx:Math.cos(a)*s,vy:Math.sin(a)*s,delay:delay,color:['#f5d076','#e27d64','#fff2c9','#daaa58'][i%4]});}}
  }
  function drawResult(now){
    var e=(now-resultEffect.started)/1000,win=winner===(online?online.side:'red');ctx.fillStyle=win?'rgba(23,16,12,.65)':'rgba(15,16,22,.78)';ctx.fillRect(0,0,W,800);
    if(win){ctx.save();ctx.beginPath();ctx.rect(0,0,W,800);ctx.clip();resultEffect.particles.forEach(function(p){var t=e-p.delay;if(t<0||t>1.8)return;ctx.globalAlpha=Math.min(1,(1.8-t)*1.2);ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x+p.vx*t,p.y+p.vy*t+22*t*t,3.4*(1-t/2),0,Math.PI*2);ctx.fill();});ctx.restore();ctx.globalAlpha=1;}
    else {ctx.save();ctx.beginPath();ctx.rect(0,0,W,800);ctx.clip();for(var i=0;i<32;i++){var x=(i*83+17)%W,y=((i*113+e*32)%800);ctx.strokeStyle='rgba(160,173,189,.28)';ctx.lineWidth=1.4;line(x,y,x-8,y+21);}ctx.restore();}
    rect(55,450,590,285,16,win?'#f1dfbb':'#2e3039',win?'#e6bb70':'#777b86');
    text(win?'胜 利':'落 败',350,520,48,win?'#a23e2d':'#d8d7d4','center');
    text((winner==='red'?'红方':'黑方')+'获胜 · '+(win?'妙手成局':'再战一局'),350,562,21,win?'#805338':'#bbc0c6','center');
    if(online&&online.status==='finished'){
      button(190,600,320,74,rematchAsked()?'等待对方同意…':'再来一局',!rematchAsked());
      text('点击其他地方查看棋盘',350,700,16,win?'#9b8060':'#a7abb1','center');
    } else text(hotseat?'点击画面继续':'下方可重新开始或换难度',350,675,17,win?'#9b8060':'#a7abb1','center');
  }
  function draw(){
    // Paint the whole backing store first so the letterboxed side areas on wide
    // screens carry the same backdrop instead of flat black bars.
    ctx.setTransform(1,0,0,1,0,0);
    var full=ctx.createLinearGradient(0,0,canvas.width,canvas.height);full.addColorStop(0,'#31271f');full.addColorStop(1,'#161713');
    ctx.fillStyle=full;ctx.fillRect(0,0,canvas.width,canvas.height);
    applyTransform();
    ctx.clearRect(0,0,W,H);var bg=ctx.createLinearGradient(0,0,W,H);bg.addColorStop(0,'#31271f');bg.addColorStop(1,'#161713');ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);
    rect(14,46,672,746,12,'#735038','#c09b6b');rect(24,56,652,726,5,'#d5ae77','#f1d29c');
    var wood=ctx.createLinearGradient(24,56,676,782);wood.addColorStop(0,'#e9cb98');wood.addColorStop(.5,'#d9b27c');wood.addColorStop(1,'#c69c67');rect(30,62,640,714,2,wood,'#88613e');
    text('弈  ·  暗棋',28,24,24,'#e8d2a8');text('一局藏锋，方寸见心',672,24,15,'#ab997b','right');
    ctx.strokeStyle='#785336';ctx.lineWidth=1.15;
    for(var i=0;i<10;i++)line(bx,by+i*step,bx+8*step,by+i*step);
    for(var j=0;j<9;j++){if(j===0||j===8)line(bx+j*step,by,bx+j*step,by+9*step);else{line(bx+j*step,by,bx+j*step,by+4*step);line(bx+j*step,by+5*step,bx+j*step,by+9*step);}}
    line(bx+3*step,by,bx+5*step,by+2*step);line(bx+5*step,by,bx+3*step,by+2*step);line(bx+3*step,by+7*step,bx+5*step,by+9*step);line(bx+5*step,by+7*step,bx+3*step,by+9*step);
    text(flipped?'漢 界':'楚 河',bx+step*2,by+step*4.5,22,'#8e633f','center');text(flipped?'楚 河':'漢 界',bx+step*6,by+step*4.5,22,'#8e633f','center');
    if(board){if(lastMove){[lastMove.from,lastMove.to].forEach(function(p){ctx.beginPath();ctx.arc(px(p.x),py(p.y),radius+7,0,Math.PI*2);ctx.fillStyle='rgba(150,72,42,.18)';ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='rgba(150,72,42,.45)';ctx.stroke();});}targets.forEach(function(t){ctx.beginPath();ctx.arc(px(t.x),py(t.y),13,0,Math.PI*2);ctx.fillStyle='rgba(55,100,72,.43)';ctx.fill();});
      board.forEach(function(row,y){row.forEach(function(p,x){if(p)drawPiece(p,px(x),py(y));});});
      if(selected){ctx.strokeStyle='#527b53';ctx.lineWidth=3;ctx.beginPath();ctx.arc(px(selected.x),py(selected.y),35,0,Math.PI*2);ctx.stroke();}}
    rect(14,806,672,380,12,'#eee0c4',online?accent():'#b89970');
    text(online?'房间 '+online.room+' · 你执'+(online.side==='red'?'红':'黑'):phase==='title'?'选择对弈':phase==='won'?'红方胜':phase==='lost'?'黑方胜':hotseat?(turn==='red'?'红方行棋':'黑方行棋'):turn==='red'?'红方行棋':'黑方思考中',38,844,online?20:25,accent());
    text(currentNotice()||(phase==='title'?(netAvailable?'人机练习、同屏双人或房间对战':'人机练习或同屏双人'):hotseat?'同屏双人 · 轮流行棋':(online?'选择暗棋或己方明棋':'难度：'+DIFF_LABELS[DIFFICULTY]+' · 选择暗棋或己方明棋')),38,880,16,'#6b5947');
    if(online&&online.status==='waiting'){button(340,823,150,70,'邀请对手',true);button(500,823,162,70,'退出房间',false);}
    else if(online&&online.status==='finished'){button(340,823,150,70,'退出房间',false);button(500,823,162,70,rematchAsked()?'等待中…':'再来一局',!rematchAsked());}
    else if(!online&&!hotseat&&(phase==='won'||phase==='lost')){button(340,823,150,70,'选择难度',false);button(500,823,162,70,'重新开始',true);}
    else if(online||phase!=='title') button(450,823,210,70,online?'退出房间':'重新开始',true);
    ctx.strokeStyle='#c9ad85';line(38,909,662,909);
    text('吃子记录',38,936,20,'#5e4c3c');text(online?'仅记录当前会话观察到的吃子':'最新在左上，按编号倒序',662,936,14,'#8c7962','right');
    if(!captures.length) text('尚无吃子',38,980,16,'#a38d73');
    captures.slice(-4).reverse().forEach(function(c,i){
      var xx=38+(i%2)*310, yy=977+Math.floor(i/2)*48;
      if(i===0) rect(xx-7,yy-20,304,40,6,'#dec8a7',null);
      text('#'+(captures.length-i),xx,yy,14,i===0?accent():'#88735a');
      ctx.beginPath();ctx.arc(xx+57,yy,14,0,Math.PI*2);ctx.fillStyle='#f8e8ca';ctx.fill();ctx.lineWidth=1;ctx.strokeStyle=c.color==='red'?'#a7352b':'#40382e';ctx.stroke();
      text(names[c.color][c.type],xx+57,yy+1,17,c.color==='red'?'#a12e25':'#302b28','center');
      text((c.actor==='red'?'红':'黑')+'吃'+(c.color==='red'?'红':'黑')+descriptionNames[c.color][c.type]+(c.wasHidden?'（暗）':''),xx+78,yy,15,'#554334');
      if(i===0) text('最新',xx+278,yy,14,accent(),'right');
    });
    ctx.strokeStyle='#c9ad85';line(38,1054,662,1054);
    button(38,1075,298,74,musicOn?'♪ 音乐：开':'♪ 音乐：关',false);
    button(364,1075,298,74,effectsOn?'音效：开':'音效：关',false);
    if(phase==='title'){
      ctx.fillStyle='rgba(31,23,18,.68)';ctx.fillRect(30,62,640,714);
      text('暗 棋',350,268,44,'#f9e6c4','center');
      text('一局藏锋 · 方寸见心',350,322,18,'#d8c39c','center');
      button(70,430,260,74,'人机对弈',true);
      button(370,430,260,74,'同屏双人',netAvailable);
      if(netAvailable){
        button(70,528,260,74,'创建房间',false);
        button(370,528,260,74,'加入房间',false);
        text(notice||'联网对战须从同源服务器页面打开',350,646,16,'#f9e6c4','center');
      } else {
        text('同屏双人：两人共用一台设备轮流走棋',350,560,17,'#f9e6c4','center');
        text('联网对战请使用同源服务器版本',350,592,16,'#d8c39c','center');
      }
    }
    if(captureFocus) drawCaptureFocus(performance.now());
    else if(resultEffect&&resultEffect.shown) drawResult(performance.now());
    if(pickDifficulty) drawDifficultyPicker();
    if(confirmExit) drawExitConfirm();
  }
  function pointer(e){e.preventDefault();enableAudio();
    if(pickDifficulty){
      var pr=canvas.getBoundingClientRect(),ppx=(e.clientX-pr.left-ox)/scale,ppy=(e.clientY-pr.top-oy)/scale;
      for(var pi=0;pi<DIFF_ORDER.length;pi++){
        var py0=414+pi*92;
        if(ppx>=140&&ppx<=560&&ppy>=py0&&ppy<=py0+72){setDifficulty(DIFF_ORDER[pi]);pickDifficulty=false;start();return;}
      }
      if(ppx>=200&&ppx<=500&&ppy>=700&&ppy<=764){pickDifficulty=false;return;}
      return;
    }
    if(confirmExit){var rc=canvas.getBoundingClientRect(),cx=(e.clientX-rc.left-ox)/scale,cy=(e.clientY-rc.top-oy)/scale;if(cy>=600&&cy<=676&&cx>=110&&cx<=350){confirmExit=false;return;}if(cy>=600&&cy<=676&&cx>=350&&cx<=590){leaveRoom();return;}if(cy<430||cy>730){confirmExit=false;}return;}if(captureFocus){if(performance.now()-captureFocus.started>400)captureFocus=null;return;}var r=canvas.getBoundingClientRect(),x=(e.clientX-r.left-ox)/scale,y=(e.clientY-r.top-oy)/scale;
    if(resultEffect&&resultEffect.shown){
      if(online&&online.status==='finished'){
        if(x>=190&&x<=510&&y>=600&&y<=674){requestRematch();return;}
        if(y>=823&&y<=893&&x>=340&&x<=490){resultEffect=null;confirmExit=true;return;}
        if(y>=823&&y<=893&&x>=500&&x<=662){requestRematch();return;}
      }
      // 单机局末：结算层挡着时也要能直接点底部两个按钮，否则要连点两次。
      if(!online&&!hotseat&&(phase==='won'||phase==='lost')&&y>=823&&y<=893){
        if(x>=340&&x<=490){resultEffect=null;pickDifficulty=true;return;}
        if(x>=500&&x<=662){resultEffect=null;start();return;}
      }
      resultEffect=null;return;
    }if(y>=1075&&y<=1149&&x>=38&&x<=336){musicOn=!musicOn;if(musicGain)musicGain.gain.setTargetAtTime(musicOn?MUSIC_VOLUME:0,audio.currentTime,.04);nextNote=0;return;}if(y>=1075&&y<=1149&&x>=364&&x<=662){effectsOn=!effectsOn;if(effectsGain)effectsGain.gain.setTargetAtTime(effectsOn?EFFECTS_VOLUME:0,audio.currentTime,.01);return;}if(y>=823&&y<=893){
      if(online&&online.status==='waiting'){
        if(x>=340&&x<=490){inviteOpponent();return;}
        if(x>=500&&x<=662){confirmExit=true;return;}
      } else if(online&&online.status==='finished'){
        if(x>=340&&x<=490){confirmExit=true;return;}
        if(x>=500&&x<=662){requestRematch();return;}
      } else if(!online&&!hotseat&&(phase==='won'||phase==='lost')){
        if(x>=340&&x<=490){pickDifficulty=true;return;}
        if(x>=500&&x<=662){start();return;}
      } else if(x>=450&&x<=660&&(online||phase!=='title')){if(online){confirmExit=true;}else start();return;}
    }if(phase==='title'){
      if(onlineBusy)return;
      if(y>=430&&y<=504){if(x>=70&&x<=330){pickDifficulty=true;return;}if(x>=370&&x<=630){start('hotseat');return;}}
      if(netAvailable&&y>=528&&y<=602){if(x>=70&&x<=330){openRoom(false);return;}if(x>=370&&x<=630){openRoom(true);return;}}
      if(x>=30&&x<=670&&y>=62&&y<=776){start();return;}
      return;
    }var col=Math.round((x-bx)/step),row=Math.round((y-by)/step);if(inside(col,row)&&Math.abs(x-(bx+col*step))<step*.49&&Math.abs(y-(by+row*step))<step*.49){var bc=flipped?8-col:col,br=flipped?9-row:row;if(online)clickOnline(bc,br);else clickBoard(bc,br);}}
  canvas.addEventListener('pointerdown',pointer);window.addEventListener('keydown',function(e){if(!onlineBusy&&e.key==='Enter'&&(phase==='title'||phase==='won'||phase==='lost')){e.preventDefault();enableAudio();start();}});window.addEventListener('resize',resize);window.addEventListener('orientationchange',resize);
  if(window.visualViewport){window.visualViewport.addEventListener('resize',resize);window.visualViewport.addEventListener('scroll',resize);}
  window.addEventListener('pageshow',resize);
  // 测试钩子：仅供自动化验证难度强度，不影响对局。
  window.__aiProbe=function(side,depth){
    var t0=performance.now(), mv=chooseMove(side||'black', depth===undefined?3:depth);
    return {move:mv, nodes:searchNodes, limit:searchLimit, ms:Math.round(performance.now()-t0)};
  };
  window.__aiTest={start:function(mode){start(mode);},setDifficulty:setDifficulty,chooseMove:chooseMove,play:function(f,t){return play(f,t);}};
  window.__gameState=function(){return {phase:phase,score:0,hearts:1,fps:fps,hero:{x:0,y:0},pickups:[],enemies:[],world:{w:W,h:H},turn:turn||null,winner:winner||null,room:online?online.room:null,side:online?online.side:null,notice:currentNotice(),confirmExit:confirmExit,rematch:online?(online.rematch||[]):[],round:online?(online.round||1):1,hotseat:hotseat,net:netAvailable,difficulty:DIFFICULTY,pickDifficulty:pickDifficulty};};
  window.__autoplay=function(){if(online||hotseat||captureFocus||phase!=='playing'||turn!=='red')return;var list=candidates('red');if(list.length){var m=list[randomInt(list.length)];play(m.from,m.to);}};
  function frame(t){if(prev){var dt=t-prev;if(dt>0)fps=fps*.9+1000/dt*.1;}prev=t;if(captureFocus&&t-captureFocus.started>=captureFocus.duration)captureFocus=null;if(!captureFocus&&resultEffect&&!resultEffect.shown)beginResult(t);if(resultEffect&&resultEffect.shown&&t-resultEffect.started>5000&&!(online&&online.status==='finished'))resultEffect=null;if(!captureFocus&&aiAt&&t>=aiAt){aiAt=0;ai();}if(!resultEffect)music();draw();requestAnimationFrame(frame);}
  startFromInvite();resize();requestAnimationFrame(frame);
})();
