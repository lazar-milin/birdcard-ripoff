import test from 'node:test';
import assert from 'node:assert/strict';
import {server} from './server.mjs';
test('two clients share a game, keep hands private, reject stale and unauthorized moves, reconnect',async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api/`;
 async function api(path,data,token){const res=await fetch(base+path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(data?{body:JSON.stringify(data)}:{})});return {status:res.status,data:await res.json()};}
 try{
 const a=(await api('login',{name:'Alice'})).data,b=(await api('login',{name:'Bob'})).data;
 let room=(await api('join',{create:true},a.token)).data;room=(await api('join',{code:room.code},b.token)).data;
 assert.equal((await api('start',{version:room.version},b.token)).status,400);
 room=(await api('start',{version:room.version},a.token)).data;
 const bv=(await api('state',null,b.token)).data;
 assert.equal(room.game.players[1].hand,undefined);assert.equal(bv.game.players[0].hand,undefined);assert.equal(bv.game.players[1].hand.length,8);
 const turn=room.game.turn, t=turn===0?a:b, own=turn===0?room:bv;
 const action={type:'lay',bird:own.game.players[turn].hand[0],row:0,side:'left'};
 assert.equal((await api('move',{version:room.version,action},turn===0?b.token:a.token)).status,400);
 assert.equal((await api('move',{version:room.version,action},t.token)).status,200);
 assert.equal((await api('move',{version:room.version,action},t.token)).status,409);
 assert.equal((await api('state',null,a.token)).status,200);
 assert.equal((await api('state')).status,400);
 const beforeLeave=(await api('state',null,a.token)).data;
 const savedHand=beforeLeave.game.players.find(p=>p.id===a.id).hand;
 const left=await api('leave',{version:beforeLeave.version},a.token);
 assert.equal(left.status,200);assert.equal(left.data.saved,true);
 assert.equal((await api('state',null,a.token)).status,400);
 assert.equal((await api('me',null,a.token)).data.id,a.id);
 const other=(await api('join',{create:true},a.token)).data;
 assert.notEqual(other.code,beforeLeave.code);
 assert.equal((await api('join',{code:beforeLeave.code},a.token)).status,400);
 await api('leave',{version:other.version},a.token);
 const returned=(await api('join',{code:beforeLeave.code.toLowerCase()},a.token)).data;
 assert.deepEqual(returned.game.players.find(p=>p.id===a.id).hand,savedHand);
 assert.equal(returned.players.find(p=>p.id===a.id).away,false);
 assert.equal((await api('reset-rooms',{})).status,403);
 assert.equal((await api('reset-rooms',{password:'wrong'})).status,403);
 assert.equal((await api('state',null,b.token)).status,200);
 const reset=await api('reset-rooms',{password:'deletor'});
 assert.equal(reset.status,200);assert.ok(reset.data.deleted>=2);
 assert.equal((await api('state',null,b.token)).status,400);
 assert.equal((await api('join',{code:beforeLeave.code},a.token)).status,400);
 assert.equal((await api('join',{code:other.code},a.token)).status,400);
 assert.equal((await api('join',{create:true},a.token)).status,200);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
