const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const MAX_ROUNDS = 5;
const DRAW_MIN_MS = 1200;
const DRAW_MAX_MS = 3000;
const REACTION_TIMEOUT_MS = 4500;
const RESULT_DELAY_MS = 1800;
const BETWEEN_ROUNDS_MS = 1400;
const rooms = new Map();
const clients = new Map();
const publicDir = path.join(__dirname, '..', 'public');

const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8' };

function sendHttp(req, res) {
  if (req.url === '/health') return res.writeHead(200, {'content-type':'application/json'}).end(JSON.stringify({ok:true,rooms:rooms.size,clients:clients.size}));
  let pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  if (pathname === '/') pathname = '/index.html';
  const safe = path.normalize(pathname).replace(/^([.][.][\\/])+/, '');
  const file = path.join(publicDir, safe);
  if (!file.startsWith(publicDir)) return res.writeHead(403).end();
  fs.readFile(file, (err, data) => {
    if (err) return res.writeHead(404, {'content-type':'text/plain'}).end('Not found');
    res.writeHead(200, {'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control':'no-cache'}).end(data);
  });
}

function wsAccept(key) { return crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64'); }
function frame(text) {
  const payload = Buffer.from(text);
  const len = payload.length;
  let header;
  if (len < 126) header = Buffer.from([0x81, len]);
  else if (len < 65536) { header = Buffer.alloc(4); header[0]=0x81; header[1]=126; header.writeUInt16BE(len,2); }
  else { header = Buffer.alloc(10); header[0]=0x81; header[1]=127; header.writeBigUInt64BE(BigInt(len),2); }
  return Buffer.concat([header, payload]);
}
function closeFrame() { return Buffer.from([0x88, 0]); }
function parseFrames(buffer) {
  const out=[]; let offset=0;
  while (offset+2 <= buffer.length) {
    const b0=buffer[offset], b1=buffer[offset+1]; const fin=(b0&0x80)!==0; const opcode=b0&0x0f; const masked=(b1&0x80)!==0; let len=b1&0x7f; let pos=offset+2;
    if (len===126) { if(pos+2>buffer.length) break; len=buffer.readUInt16BE(pos); pos+=2; }
    else if(len===127){ if(pos+8>buffer.length) break; const big=buffer.readBigUInt64BE(pos); if(big>BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('frame too large'); len=Number(big); pos+=8; }
    if(masked) { if(pos+4>buffer.length) break; }
    const mask=masked?buffer.subarray(pos,pos+4):null; pos+=masked?4:0;
    if(pos+len>buffer.length) break;
    let payload=buffer.subarray(pos,pos+len); pos+=len;
    if(masked){ payload=Buffer.from(payload); for(let i=0;i<payload.length;i++) payload[i]^=mask[i%4]; }
    out.push({fin,opcode,payload}); offset=pos;
  }
  return {frames:out, rest:buffer.subarray(offset)};
}

function safeName(v){const n=String(v||'').trim().replace(/\s+/g,' ').slice(0,20);return n||'Player';}
function makeCode(){const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let code;do{code=Array.from({length:4},()=>chars[crypto.randomInt(chars.length)]).join('')}while(rooms.has(code));return code;}
function roomFor(client){return client.roomCode?rooms.get(client.roomCode):null;}
function send(client,event,data={}){if(client.socket.destroyed)return;client.socket.write(frame(JSON.stringify({event,data})));}
function broadcast(room,event,data={}){for(const p of room.players){const c=clients.get(p.id);if(c)send(c,event,data);}}
function publicRoom(room){return {code:room.code,status:room.status,round:room.round,players:room.players.map(p=>({id:p.id,name:p.name,score:p.score}))};}
function state(room){broadcast(room,'state',publicRoom(room));}
function clearTimers(room){for(const k of ['drawTimer','reactionTimer','resultTimer','roundTimer']){if(room[k])clearTimeout(room[k]);room[k]=null;}}
function error(client,message){send(client,'error_message',{message});}
function cleanup(room){clearTimers(room);rooms.delete(room.code);}

function startRound(room){
  if(!rooms.has(room.code)||room.players.length!==2)return;
  clearTimers(room); room.round++; room.status='countdown'; room.reactions=new Map(); room.falseStarts=new Set(); room.drawAt=null; room.result=null;
  state(room); broadcast(room,'round_countdown',{round:room.round,totalRounds:MAX_ROUNDS});
  room.drawTimer=setTimeout(()=>{
    if(!rooms.has(room.code)||room.players.length!==2||room.status!=='countdown')return;
    room.status='draw'; room.drawAt=Date.now(); broadcast(room,'draw'); state(room);
    room.reactionTimer=setTimeout(()=>finishRound(room),REACTION_TIMEOUT_MS);
  },crypto.randomInt(DRAW_MIN_MS,DRAW_MAX_MS+1));
}

function finishRound(room){
  if(!rooms.has(room.code)||!['draw'].includes(room.status))return;
  clearTimeout(room.reactionTimer); room.reactionTimer=null; room.status='result';
  const valid=room.players.filter(p=>room.reactions.has(p.id)&&!room.falseStarts.has(p.id)).map(p=>({playerId:p.id,timeMs:room.reactions.get(p.id)})).sort((a,b)=>a.timeMs-b.timeMs);
  let winnerId=null,winnerTime=null,resultType='draw';
  if(room.falseStarts.size===1){const fs=[...room.falseStarts][0];const other=room.players.find(p=>p.id!==fs);if(other&&!room.falseStarts.has(other.id)){winnerId=other.id;resultType='false_start';}}
  else if(room.falseStarts.size===2){resultType='double_false_start';}
  else if(valid.length){winnerId=valid[0].playerId;winnerTime=valid[0].timeMs;resultType=valid.length===1?'timeout':'reaction';}
  if(winnerId){const w=room.players.find(p=>p.id===winnerId);w.score++;}
  room.result={round:room.round,winnerId,winnerTime,resultType,reactions:room.players.map(p=>({playerId:p.id,timeMs:room.reactions.has(p.id)?room.reactions.get(p.id):null,falseStart:room.falseStarts.has(p.id)})),scores:room.players.map(p=>({playerId:p.id,score:p.score}))};
  broadcast(room,'round_result',room.result);state(room);
  room.resultTimer=setTimeout(()=>{
    if(!rooms.has(room.code))return;
    if(room.round>=MAX_ROUNDS){room.status='finished';const max=Math.max(...room.players.map(p=>p.score));const wins=room.players.filter(p=>p.score===max);room.finalWinnerId=wins.length===1?wins[0].id:null;broadcast(room,'game_over',{winnerId:room.finalWinnerId,scores:room.players.map(p=>({playerId:p.id,score:p.score}))});state(room);}
    else room.roundTimer=setTimeout(()=>startRound(room),BETWEEN_ROUNDS_MS);
  },RESULT_DELAY_MS);
}

function removePlayer(client){
  const room=roomFor(client); if(!room)return;
  client.roomCode=null; room.players=room.players.filter(p=>p.id!==client.id); clearTimers(room);
  if(!room.players.length){cleanup(room);return;}
  room.status='waiting';room.round=0;room.result=null;room.finalWinnerId=null;room.players[0].score=0;broadcast(room,'opponent_left');state(room);
}

function handle(client,msg){
  let body;try{body=JSON.parse(msg)}catch{return error(client,'Invalid message.');}
  const {event,data={}}=body;
  if(event==='create_room'){
    if(roomFor(client))return error(client,'You are already in a room.');
    const code=makeCode();const room={code,status:'waiting',round:0,players:[{id:client.id,name:safeName(data.name),score:0}],reactions:new Map(),falseStarts:new Set(),drawAt:null,result:null,finalWinnerId:null,drawTimer:null,reactionTimer:null,resultTimer:null,roundTimer:null};
    rooms.set(code,room);client.roomCode=code;send(client,'room_created',{code});state(room);return;
  }
  if(event==='join_room'){
    if(roomFor(client))return error(client,'You are already in a room.');
    const code=String(data.code||'').trim().toUpperCase();const room=rooms.get(code);
    if(!room)return error(client,'Room not found. Check the 4-character code.');
    if(room.players.length>=2)return error(client,'That room is full.');
    if(room.status!=='waiting')return error(client,'That game has already started.');
    room.players.push({id:client.id,name:safeName(data.name),score:0});client.roomCode=code;send(client,'joined_room',{code});broadcast(room,'player_joined');state(room);return;
  }
  const room=roomFor(client);
  if(event==='start_game'){if(!room)return error(client,'Join a room first.');if(room.players.length!==2)return error(client,'Waiting for a second player.');if(room.status!=='waiting')return;startRound(room);return;}
  if(event==='reaction'){
    if(!room||room.status!=='draw'||!room.drawAt)return;
    if(room.reactions.has(client.id)||room.falseStarts.has(client.id))return;
    room.reactions.set(client.id,Date.now()-room.drawAt);if(room.reactions.size+room.falseStarts.size===room.players.length)finishRound(room);return;
  }
  if(event==='false_start'){
    if(!room||room.status!=='countdown')return;if(room.falseStarts.has(client.id))return;room.falseStarts.add(client.id);send(client,'false_start_ack');
    if(room.falseStarts.size===2){room.status='draw';room.drawAt=Date.now();finishRound(room);}return;
  }
  if(event==='play_again'){
    if(!room||room.status!=='finished'||room.players.length!==2)return;room.players.forEach(p=>p.score=0);room.round=0;room.finalWinnerId=null;startRound(room);return;
  }
  if(event==='leave_room'){removePlayer(client);return;}
}

const server=http.createServer(sendHttp);
server.on('upgrade',(req,socket)=>{
  if(req.headers.upgrade?.toLowerCase()!=='websocket')return socket.destroy();
  const key=req.headers['sec-websocket-key'];if(!key)return socket.destroy();
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+wsAccept(key)+'\r\n\r\n');
  const client={id:crypto.randomUUID(),socket,roomCode:null,buffer:Buffer.alloc(0)};clients.set(client.id,client);send(client,'connected',{id:client.id});
  socket.on('data',chunk=>{try{client.buffer=Buffer.concat([client.buffer,chunk]);const parsed=parseFrames(client.buffer);client.buffer=parsed.rest;for(const f of parsed.frames){if(f.opcode===0x1&&f.fin)handle(client,f.payload.toString('utf8'));else if(f.opcode===0x8){socket.write(closeFrame());socket.end();}else if(f.opcode===0x9)socket.write(Buffer.concat([Buffer.from([0x8A,f.payload.length]),f.payload]));}}catch{socket.destroy();}});
  socket.on('close',()=>{removePlayer(client);clients.delete(client.id);});socket.on('error',()=>{removePlayer(client);clients.delete(client.id);});
});
server.listen(PORT,'0.0.0.0',()=>console.log(`QuickDraw running at http://localhost:${PORT}`));
