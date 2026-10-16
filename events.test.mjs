// Before editing, read CLAUDE.md at the repo root, especially "Client".
// Tests public/js/events.js from Node.
import test from 'node:test';
import assert from 'node:assert/strict';
import { changedEvents } from './public/js/events.js';
const room = (seq, events, id=1, code='ROOM') => ({code, game:{id,seq,events}});
test('sound/motion diff ignores refresh, duplicates, room switches and missing history',()=>{
 const a=room(3,[]), b=room(4,[{seq:4,type:'lay'}]);
 assert.deepEqual(changedEvents(null,b),[]);
 assert.deepEqual(changedEvents(b,b),[]);
 assert.deepEqual(changedEvents(a,{...b,code:'OTHER'}),[]);
 assert.deepEqual(changedEvents(a,room(8,[{seq:8,type:'lay'}])),[]);
 assert.deepEqual(changedEvents(a,b),b.game.events);
});
test('new games announce first turn without replaying other events',()=>{
 const next=room(2,[{seq:1,type:'start'},{seq:2,type:'turn',player:'a'}],2);
 assert.deepEqual(changedEvents(room(30,[]),next),[next.game.events[1]]);
 assert.deepEqual(changedEvents({code:'ROOM',game:null},next),[next.game.events[1]]);
});
