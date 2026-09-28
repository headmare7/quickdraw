const app=document.getElementById('app'),connection=document.getElementById('connection');
const state={screen:'home',name:'',code:'',room:null,phase:'idle',round:0,result:null,winnerId:null,message:''};
const socket=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}`);
const pendingMessages=[];
function emit(event,data={}){
 const message=JSON.stringify({event,data});
 if(socket.readyState===WebSocket.OPEN) socket.send(message);
 else if(socket.readyState===WebSocket.CONNECTING) pendingMessages.push(message);
 else { state.message='Connection is offline. Refresh and try again.'; paint(); }
}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function me(){return state.room?.players.find(p=>p.id===socket._id)}
function render(){
 const room=state.room;const self=room?.players[0];
 if(state.screen==='home')return app.innerHTML=`<section class="card home-card"><div class="eyebrow">2-PLAYER REACTION BATTLE</div><h1>QuickDraw</h1><p class="lead">Wait for the signal. Tap first. Win the round.</p><div class="field"><label>Your name</label><input id="name" maxlength="20" placeholder="Enter your name" value="${esc(state.name)}"></div><button class="primary" id="create">Create Room</button><div class="divider"><span>OR JOIN A ROOM</span></div><div class="join-row"><input id="code" maxlength="4" placeholder="4-digit code" value="${esc(state.code)}"><button class="secondary" id="join">Join</button></div><div class="rules"><strong>How to play</strong><ul><li>Two players, five rounds.</li><li>Wait until <b>DRAW!</b> appears.</li><li>Tap as fast as you can.</li><li>Tap early and you lose the round.</li><li>Most round wins takes the game.</li></ul></div>${state.message?`<p class="message">${esc(state.message)}</p>`:''}</section>`;
 if(state.screen==='lobby')return app.innerHTML=`<section class="card lobby-card"><div class="eyebrow">ROOM LOBBY</div><div class="room-code">${esc(room?.code)}</div><p class="muted">Share this 4-character code with your opponent.</p><div class="players">${(room?.players||[]).map((p,i)=>`<div class="player-row"><span class="avatar">${esc(p.name.slice(0,1).toUpperCase())}</span><span>${esc(p.name)} ${i===0?'<small>(you)</small>':''}</span></div>`).join('')}${(room?.players.length||0)<2?'<div class="player-row"><span class="avatar">?</span><span>Waiting for opponent…</span></div>':''}</div>${room?.players.length===2?'<button class="primary" id="start">Start Game</button>':'<div class="waiting"><span class="pulse"></span>Waiting for a second player…</div>'}<button class="text-button" id="leave">Leave room</button>${state.message?`<p class="message">${esc(state.message)}</p>`:''}</section>`;
 if(state.screen==='game')return app.innerHTML=`<section class="game-screen"><div class="score-strip">${room.players.map(p=>`<div class="score"><span>${esc(p.name)}</span><strong>${p.score}</strong></div>`).join('')}</div><div class="round-label">ROUND ${state.round} / 5</div><button id="draw" class="draw-zone ${state.phase==='draw'?'go':'wait'}"><span class="draw-word">${state.phase==='draw'?'DRAW!':'GET READY'}</span><span class="draw-help">${state.phase==='draw'?'TAP NOW':'Wait for the signal'}</span></button><p class="game-message">${esc(state.message||'Your opponent is playing too.')}</p></section>`;
 if(state.screen==='result'){const winner=state.result?.winnerId?room.players.find(p=>p.id===state.result.winnerId)?.name:null;return app.innerHTML=`<section class="card result-card"><div class="eyebrow">ROUND ${state.result?.round} RESULT</div><h2>${winner?esc(winner)+' wins!':state.result?.resultType==='double_false_start'?'Both players jumped early':'Round draw'}</h2><div class="reaction-list">${state.result?.reactions.map(r=>{const p=room.players.find(x=>x.id===r.playerId);return `<div class="reaction-row"><span>${esc(p?.name)}</span><strong>${r.falseStart?'False start':r.timeMs!=null?r.timeMs+' ms':'No tap'}</strong></div>`}).join('')}</div><div class="score-strip">${room.players.map(p=>`<div class="score"><span>${esc(p.name)}</span><strong>${p.score}</strong></div>`).join('')}</div><p class="muted">Next round starts automatically.</p></section>`}
 const winner=state.winnerId?room.players.find(p=>p.id===state.winnerId)?.name:null;return app.innerHTML=`<section class="card result-card"><div class="eyebrow">GAME OVER</div><h1>${winner?esc(winner)+' wins!':'It’s a draw'}</h1><p class="lead">Final score</p><div class="score-strip">${room.players.map(p=>`<div class="score"><span>${esc(p.name)}</span><strong>${p.score}</strong></div>`).join('')}</div><button class="primary" id="again">Play Again</button><button class="text-button" id="leave">Exit room</button></section>`;
}
function bind(){
 document.getElementById('create')?.addEventListener('click',()=>{state.name=document.getElementById('name').value;if(!state.name.trim())return state.message='Enter your name first.',render();emit('create_room',{name:state.name});});
 document.getElementById('join')?.addEventListener('click',()=>{state.name=document.getElementById('name').value;state.code=document.getElementById('code').value.toUpperCase();if(!state.name.trim())return state.message='Enter your name first.',render();if(!state.code)return state.message='Enter a room code.',render();emit('join_room',{name:state.name,code:state.code});});
 document.getElementById('start')?.addEventListener('click',()=>emit('start_game'));document.getElementById('leave')?.addEventListener('click',()=>{emit('leave_room');state.room=null;state.screen='home';state.message='';render();});
 document.getElementById('again')?.addEventListener('click',()=>{state.result=null;state.winnerId=null;emit('play_again');});
 document.getElementById('draw')?.addEventListener('pointerdown',()=>emit(state.phase==='draw'?'reaction':'false_start'));
}
function paint(){render();bind();}
socket.addEventListener('open',()=>{
 connection.textContent='● Online';
 connection.classList.add('online');
 while(pendingMessages.length) socket.send(pendingMessages.shift());
});
socket.addEventListener('error',()=>{
 connection.textContent='○ Connection error';
 connection.classList.remove('online');
 state.message='Could not connect to the game server. Check the Wi-Fi address and firewall.';
 paint();
});
socket.addEventListener('close',()=>{connection.textContent='○ Offline';connection.classList.remove('online');state.message='Connection lost. Refresh to reconnect.';if(state.screen!=='home')paint();});
socket.addEventListener('message',e=>{const {event,data}=JSON.parse(e.data);if(event==='connected'){socket._id=data.id||null;}if(event==='state'){state.room=data;state.round=data.round;if(data.status==='waiting')state.screen='lobby';if(data.status==='countdown'||data.status==='draw')state.screen='game';if(data.status==='result')state.screen='result';if(data.status==='finished')state.screen='finished';}if(event==='room_created'||event==='joined_room'){state.code=data.code;state.screen='lobby';state.message=event==='room_created'?'Share this code with your opponent.':'Joined the room.';}if(event==='round_countdown'){state.round=data.round;state.phase='countdown';state.screen='game';state.message='Wait for DRAW!';}if(event==='draw'){state.phase='draw';state.message='DRAW! TAP NOW!';}if(event==='round_result'){state.result=data;state.phase='result';state.screen='result';}if(event==='game_over'){state.winnerId=data.winnerId;state.screen='finished';}if(event==='error_message'){state.message=data.message;}if(event==='false_start_ack'){state.message='Too early! Your opponent can still win this round.';}if(event==='opponent_left'){state.message='Your opponent disconnected. You can wait for another player or leave.';state.screen='lobby';state.phase='idle';}paint();});
paint();
