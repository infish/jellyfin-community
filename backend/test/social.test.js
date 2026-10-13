import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../src/server.js';

async function setup(t) {
    const app = buildServer({config:{databasePath:':memory:',mockUpstreams:true,boardEnabled:true,presenceEnabled:true},logger:false});
    t.after(() => app.close());
    const call = (method,path,user='requester',payload) => app.inject({method,url:'/api/community'+path,headers:{authorization:`Bearer ${user}-token`},payload});
    for (const user of ['requester','trusted','admin','restricted']) await call('GET','/me',user);
    const c = (await call('POST','/conversations','requester',{peerId:'trusted'})).json();
    return {call,c};
}

test('private messages, replies, reactions, avatars and settings reject outsiders including admins',async t => {
    const {call,c} = await setup(t);
    const m = (await call('POST',`/conversations/${c.id}/messages`,'requester',{body:'private',clientId:'aaaaaaaaaaaaaaaa'})).json();
    for (const outsider of ['admin','restricted']) {
        assert.deepEqual((await call('GET','/conversations',outsider)).json().items,[]);
        for (const [method,path,payload] of [
            ['GET',`/conversations/${c.id}/messages`],['GET',`/conversations/${c.id}/avatar`],
            ['GET',`/conversations/${c.id}/messages/${m.id}`],
            ['GET',`/conversations/${c.id}/messages/${m.id}/avatar`],
            ['GET',`/conversations/${c.id}/people/requester/avatar`],
            ['POST',`/conversations/${c.id}/snapshot`,{ids:[m.id]}],
            ['POST',`/conversations/${c.id}/messages`,{body:'intrusion',clientId:'bbbbbbbbbbbbbbbb'}],
            ['PUT',`/reactions/direct/${m.id}`,{emoji:'😀',active:true}],
            ['PUT',`/conversations/${c.id}/settings`,{muted:true,blocked:true}],
            ['PUT',`/conversations/${c.id}/unread`,{throughId:m.id}]
        ]) assert.equal((await call(method,path,outsider,payload)).statusCode,404,`${outsider} ${path}`);
    }
    const other = (await call('POST','/conversations','requester',{peerId:'restricted'})).json();
    assert.equal((await call('POST',`/conversations/${other.id}/messages`,'requester',{body:'bad quote',replyTo:m.id,clientId:'cccccccccccccccc'})).statusCode,404);
    assert.equal((await call('GET',`/conversations/${c.id}/messages`,'trusted')).json().items[0].body,'private');
});

test('private history pages without gaps and invisible users can continue conversations',async t=> {
    const {call,c}=await setup(t);
    await call('PUT','/presence/preference','trusted',{visible:false});
    await call('PUT','/presence/heartbeat','trusted',{sessionId:'bbbbbbbbbbbbbbbb'});
    assert.deepEqual((await call('GET','/presence')).json().users,[]);
    assert.equal((await call('POST',`/conversations/${c.id}/messages`,'trusted',{body:'invisible reply',clientId:'aaaaaaaaaaaaaaaa'})).statusCode,201);
    assert.equal((await call('GET','/conversations','requester')).json().items[0].peer.id,'trusted');
    assert.equal((await call('POST',`/conversations/${c.id}/snapshot`,'requester',{ids:Array(201).fill('a')})).statusCode,400);
    assert.equal((await call('GET',`/conversations/${c.id}/messages?before=-1`)).statusCode,400);
});

test('retries are idempotent, unread markers remain private and blocks apply both ways',async t => {
    const {call,c} = await setup(t);
    const path = `/conversations/${c.id}`;
    const payload = {body:'hello',clientId:'aaaaaaaaaaaaaaaa'};
    const first = (await call('POST',path+'/messages','requester',payload)).json();
    assert.equal((await call('POST',path+'/messages','requester',payload)).json().id,first.id);
    assert.equal((await call('POST',path+'/messages','requester',{...payload,body:'different'})).statusCode,409);
    assert.equal((await call('GET','/conversations','trusted')).json().items[0].unread,1);
    const before = (await call('GET','/conversations','requester')).json();
    await call('PUT',path+'/unread','trusted',{throughId:first.id});
    assert.equal((await call('GET','/conversations','trusted')).json().items[0].unread,0);
    assert.deepEqual((await call('GET','/conversations','requester')).json(),before);
    await call('PUT',path+'/settings','trusted',{muted:true,blocked:true});
    for (const user of ['trusted','requester']) {
        assert.equal((await call('POST',path+'/messages',user,{body:'blocked',clientId:'bbbbbbbbbbbbbbbb'})).statusCode,403);
        assert.equal((await call('PUT',`/reactions/direct/${first.id}`,user,{emoji:'😀',active:true})).statusCode,403);
    }
    assert.equal((await call('GET',path+'/messages','trusted')).statusCode,200);
    await call('PUT',path+'/settings','trusted',{muted:true,blocked:false});
    assert.equal((await call('POST',path+'/messages','trusted',{body:'reply',replyTo:first.id,clientId:'cccccccccccccccc'})).json().reply.body,'hello');
});

test('board replies and reactions preserve text and hide deleted quotes',async t => {
    const {call} = await setup(t);
    const first = (await call('POST','/messages','requester',{body:'<script>plain text</script>'})).json();
    const reply = (await call('POST','/messages','trusted',{body:'reply',replyTo:first.id})).json();
    const path = `/reactions/board/${reply.id}`;
    await call('PUT',path,'requester',{emoji:'🇮🇱',active:true});
    await call('PUT',path,'requester',{emoji:'🇮🇱',active:true});
    await call('PUT',path,'trusted',{emoji:'🇮🇱',active:true});
    let data = (await call('GET',`/messages/${reply.id}`)).json();
    assert.equal(data.reply.body,'<script>plain text</script>');
    assert.equal(data.reactions[0].count,2);
    await call('PUT',path,'requester',{emoji:'😀',active:true});
    data=(await call('GET',`/messages/${reply.id}`)).json();
    assert.equal(data.reactions.filter(r=>r.mine).length,1);
    assert.equal(data.reactions.find(r=>r.emoji==='🇮🇱').count,1);
    assert.equal(data.reactions.find(r=>r.emoji==='😀').count,1);
    await call('PUT',path,'requester',{emoji:'🇮🇱',active:false});
    assert.equal((await call('GET',`/messages/${reply.id}`)).json().reactions.find(r=>r.emoji==='😀').mine,true);
    assert.equal((await call('PUT',path,'requester',{emoji:'<img>',active:true})).statusCode,400);
    await call('DELETE',`/messages/${first.id}`);
    data = (await call('GET',`/messages/${reply.id}`)).json();
    assert.equal(data.reply.deleted,true);
    assert.equal(data.reply.body,'Message deleted');
});
