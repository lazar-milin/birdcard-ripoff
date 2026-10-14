import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { start, move, view } from './game.mjs';
const root=fileURLToPath(new URL('./public/',import.meta.url));
const rooms=new Map(), sessions=new Map(), limits=new Map();
const guests=process.env.ALLOW_GUESTS!=='false' && process.env.NODE_ENV!=='production';
const key=()=>randomBytes(24).toString('hex');
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
async function body(req){let str='';for await(const c of req){str+=c;if(str.length>8192)throw new Error('Request too large.');}return JSON.parse(str||'{}');}
function snapshot(room,id){return {code:room.code,host:room.host,version:room.version,players:room.players,game:room.game?view(room.game,id):null};}
function session(req){const token=req.headers.authorization?.replace(/^Bearer /,'');const s=sessions.get(token);if(!s||Date.now()-s.created>86400000)throw new Error('Session expired. Reload to sign in.');return s;}
function roomFor(s){const room=rooms.get(s.room);if(!room||!room.players.some(p=>p.id===s.id))throw new Error('Join a table first.');room.touched=Date.now();return room;}
export const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    if(url.pathname.startsWith('/api/')){
      const ip=req.socket.remoteAddress, now=Date.now(), limit=limits.get(ip)||{time:now,n:0};
      if(now-limit.time>60000){limit.time=now;limit.n=0;}limits.set(ip,limit);
      if(++limit.n>1800)return json(res,429,{error:'Too many requests. Try again shortly.'});
      if(req.method==='GET'&&url.pathname==='/api/config')return json(res,200,{clientId:process.env.DISCORD_CLIENT_ID||'',guests,canResetRooms:guests});
      if(req.method==='POST'&&url.pathname==='/api/reset-rooms'){
        if(!guests)return json(res,403,{error:'Room reset is only available on the playtest server.'});
        if(!req.headers['content-type']?.startsWith('application/json'))return json(res,415,{error:'Expected JSON.'});
        const {password}=await body(req);
        if(password!=='deletor')return json(res,403,{error:'Incorrect password. No rooms were deleted.'});
        const deleted=rooms.size;
        rooms.clear();
        for(const s of sessions.values())s.room=null;
        return json(res,200,{ok:true,deleted});
      }
      if(req.method==='POST'&&url.pathname==='/api/login'){
        const b=await body(req);let id,name,access_token;
        if(b.code){
          if(!process.env.DISCORD_CLIENT_ID||!process.env.DISCORD_CLIENT_SECRET)throw new Error('The host needs to configure Discord credentials.');
          const tokenResponse=await fetch('https://discord.com/api/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:process.env.DISCORD_CLIENT_ID,client_secret:process.env.DISCORD_CLIENT_SECRET,grant_type:'authorization_code',code:b.code}),signal:AbortSignal.timeout(15000)});
          if(!tokenResponse.ok)throw new Error('Discord authorization failed. Please reopen the Activity.');
          ({access_token}=await tokenResponse.json());
          const userResponse=await fetch('https://discord.com/api/v10/users/@me',{headers:{Authorization:`Bearer ${access_token}`},signal:AbortSignal.timeout(15000)});
          if(!userResponse.ok)throw new Error('Could not verify Discord identity.');
          const u=await userResponse.json();id=u.id;name=u.global_name||u.username;
        }else{
          if(!guests)return json(res,403,{error:'Open this game inside Discord.'});
          id=key();name=String(b.name||'Player').trim().slice(0,24)||'Player';
        }
        const token=key();sessions.set(token,{id,name,created:Date.now(),room:null});
        return json(res,200,{token,id,name,...(access_token?{access_token}: {})});
      }
      const s=session(req);
      if(req.method==='GET'&&url.pathname==='/api/me')return json(res,200,{id:s.id,name:s.name});
      if(req.method==='GET'&&url.pathname==='/api/state')return json(res,200,{...snapshot(roomFor(s),s.id),you:s.id});
      if(req.method!=='POST')return json(res,404,{error:'Not found.'});
      const b=await body(req);
      if(url.pathname==='/api/join'){
        let room;
        if(b.create){
          if(s.room)throw new Error('Leave your current room before creating another.');
          if(rooms.size>=500)throw new Error('The server is full. Try again later.');
          let code;do{code=randomBytes(4).toString('hex').toUpperCase();}while(rooms.has(code));
          room={code,host:s.id,players:[],game:null,version:0,touched:Date.now()};rooms.set(code,room);
        }else room=rooms.get(String(b.code||'').trim().toUpperCase());
        if(!room)throw new Error('Table not found. Check the table code.');
        if(s.room&&s.room!==room.code)throw new Error('Leave your current room before joining another.');
        if(!room.players.some(p=>p.id===s.id)){
          if(room.game)throw new Error('This game has already started.');
          if(room.players.length>=5)throw new Error('This table is full.');
          room.players.push({id:s.id,name:s.name});room.version++;
        }
        const returning=room.players.find(p=>p.id===s.id);
        if(returning.away){returning.away=false;room.version++;}
        s.room=room.code;room.touched=Date.now();return json(res,200,{...snapshot(room,s.id),you:s.id});
      }
      const room=roomFor(s);
      if(b.version!==room.version)return json(res,409,{error:'The table changed. Please try again.'});
      if(url.pathname==='/api/start'){
        if(s.id!==room.host)throw new Error('Only the host can start the game.');
        if(room.game&&room.game.phase!=='over')throw new Error('The game is already running.');
        room.game=start(room.players);
      }else if(url.pathname==='/api/move'){
        if(!room.game)throw new Error('Start the game first.');
        room.game=move(room.game,s.id,b.action||{});
      }else if(url.pathname==='/api/leave'){
        const saved=room.game&&room.game.phase!=='over';
        if(saved)room.players.find(p=>p.id===s.id).away=true;
        else {
          room.players=room.players.filter(p=>p.id!==s.id);
          if(room.host===s.id)room.host=room.players[0]?.id;
          room.game=null;
        }
        s.room=null;room.version++;return json(res,200,{ok:true,saved:!!saved,code:room.code});
      }else return json(res,404,{error:'Not found.'});
      room.version++;room.touched=Date.now();return json(res,200,{...snapshot(room,s.id),you:s.id});
    }
    if(req.method!=='GET')return json(res,405,{error:'Method not allowed.'});
    const pathname=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname), path=resolve(root,'.'+pathname);
    if(!path.startsWith(root.endsWith(sep)?root:root+sep))return json(res,403,{error:'Forbidden.'});
    const data=await readFile(path);
    const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg'};
    res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(data);
  }catch(e){json(res,e.code==='ENOENT'?404:400,{error:e.code==='ENOENT'?'Not found.':e.message});}
});
// Memory-only prototype: idle tables and authentication sessions expire after a day.
setInterval(()=>{const cutoff=Date.now()-86400000;for(const [k,v]of rooms)if(v.touched<cutoff)rooms.delete(k);for(const[k,v]of sessions)if(v.created<cutoff)sessions.delete(k);for(const[k,v]of limits)if(v.time<Date.now()-120000)limits.delete(k);},60000).unref();
if(process.argv[1]===fileURLToPath(import.meta.url))server.listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log(`Bird Table running at http://${process.env.HOST||'127.0.0.1'}:${process.env.PORT||3000}`));
