import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';

test('an existing board database migrates without losing messages or visibility preferences',t=> {
    const dir=mkdtempSync(join(tmpdir(),'community-migration-')); const path=join(dir,'board.sqlite');
    t.after(()=>rmSync(dir,{recursive:true}));
    const old=new DatabaseSync(path);
    old.exec("CREATE TABLE messages(id TEXT PRIMARY KEY,author_id TEXT NOT NULL,display_name TEXT NOT NULL,body TEXT NOT NULL,created_at INTEGER NOT NULL,deleted_at INTEGER); INSERT INTO messages VALUES('old','alice','Alice','Preserve this',1,NULL); CREATE TABLE preferences(user_id TEXT PRIMARY KEY,presence_visible INTEGER NOT NULL,updated_at INTEGER NOT NULL); INSERT INTO preferences VALUES('alice',0,1);");
    old.close(); const store=new Store(path); t.after(()=>store.close());
    assert.equal(store.listMessages().items[0].body,'Preserve this');
    assert.equal(store.presenceVisible('alice'),false);
    assert.equal(store.social.user('alice').name,'Alice');
    assert.equal(store.createMessage({id:'alice',name:'Alice'},'Reply','old').body,'Reply');
});

test('private history paginates with no duplicate or missing messages',t=> {
    let now=1700000000000; const store=new Store(':memory:',()=>now); t.after(()=>store.close());
    const alice={id:'alice',name:'Alice'},bob={id:'bob',name:'Bob'};
    store.social.remember(alice); store.social.remember(bob); const c=store.social.open(alice,bob.id);
    for (let i=0;i<85;i++) {now+=3000; store.social.send(alice,c.id,`Message ${i}`,null,`message_${String(i).padStart(16,'0')}`);}
    const seen=[]; let cursor=null;
    do {const data=store.social.messages(bob,c.id,cursor); seen.push(...data.items.map(m=>m.id)); cursor=data.nextCursor;} while(cursor);
    assert.equal(seen.length,85); assert.equal(new Set(seen).size,85);
});

test('old stacked reactions migrate to the latest single reaction per person',t=> {
    const dir=mkdtempSync(join(tmpdir(),'community-reactions-'));const path=join(dir,'board.sqlite');
    t.after(()=>rmSync(dir,{recursive:true}));
    let store=new Store(path);
    store.db.exec("DROP INDEX reaction_per_person; DELETE FROM migrations WHERE version=3; INSERT INTO reactions VALUES('board','message','alice','😀'); INSERT INTO reactions VALUES('board','message','alice','😎'); INSERT INTO reactions VALUES('direct','message','alice','🧃');");
    store.close(); store=new Store(path);t.after(()=>store.close());
    assert.deepEqual(store.db.prepare('SELECT emoji FROM reactions WHERE scope=\'board\'').all().map(r=>r.emoji),['😎']);
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM reactions').get().n,2);
});
