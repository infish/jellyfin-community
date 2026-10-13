import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,statSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../src/server.js';

function setup(t,token='test-catalog-token-1234567890',databasePath=':memory:') {
    const libraries={requester:[],trusted:[],admin:[]}; const policies={}; let failure=false; const calls=[];
    const movies={1:{id:1,title:'The Same Name',original_title:'The Same Name',release_date:'1984-01-01',imdb_id:'tt0000001'},2:{id:2,title:'The Same Name',release_date:'2021-01-01',imdb_id:'tt0000002'}};
    const tv={id:10,name:'A Show',first_air_date:'2020-01-01',external_ids:{tvdb_id:100},seasons:[{season_number:1,name:'Season 1',episode_count:2},{season_number:2,name:'Season 2',episode_count:2}]};
    const fetch=async(raw,options={})=> {
        const url=new URL(raw); calls.push({url,options});
        if (url.hostname==='api.themoviedb.org') {
            if (url.pathname==='/3/configuration') return Response.json({images:{}});
            if (url.pathname.includes('/search/')) return Response.json({page:1,total_pages:1,results:url.pathname.endsWith('/movie') ? Object.values(movies) : [tv]});
            if (url.pathname.startsWith('/3/movie/')) return Response.json(movies[Number(url.pathname.split('/').at(-1))]);
            if (url.pathname==='/3/tv/10') return Response.json(tv);
        }
        if(url.pathname==='/Users') return Response.json([{Id:'admin',Policy:{IsAdministrator:true}}]);
        if(url.pathname.startsWith('/Users/')) {const id=url.pathname.split('/').at(-1); return Response.json({Id:id,Name:id,Policy:policies[id] || {EnableAllFolders:true}});}
        if (url.pathname==='/Items') {
            if (failure) return new Response('',{status:503});
            const rows=libraries[url.searchParams.get('UserId')] || [];
            const filtered=url.searchParams.has('ParentId') ? rows.filter(i=>i.SeriesId===url.searchParams.get('ParentId')) : rows.filter(i=>i.Type===(url.searchParams.get('IncludeItemTypes')==='Movie' ? 'Movie':'Series'));
            return Response.json({Items:filtered,TotalRecordCount:filtered.length});
        }
        throw new Error('Unexpected test URL');
    };
    const app=buildServer({config:{databasePath,jellyfinUrl:'http://jellyfin',mockUpstreams:true,requestBoardEnabled:true,requestSyncIntervalMs:0,tmdbReadToken:token},fetch,logger:false});
    t.after(()=>app.close());
    const call=(method,path,user='requester',payload)=>app.inject({method,url:'/api/community'+path,headers:{authorization:`Bearer ${user}-token`},payload});
    return {app,call,libraries,calls,policies,setFailure:(value=true)=> {failure=value;}};
}

test('exact metadata identity prevents requesting an owned movie and checks the requester library',async t=> {
    const {call,libraries,calls}=setup(t);
    libraries.requester=[{Id:'owned',Type:'Movie',Name:'Translated title',ProviderIds:{Tmdb:'1'},LocationType:'FileSystem'}];
    assert.equal((await call('GET','/catalog/movie/1/check')).json().library.state,'available');
    assert.equal((await call('POST','/request-board','requester',{mediaType:'movie',mediaId:1})).statusCode,409);
    assert.equal((await call('POST','/request-board','trusted',{mediaType:'movie',mediaId:1})).statusCode,201);
    assert.ok(calls.filter(c=>c.url.pathname==='/Items').every(c=>['requester','trusted'].includes(c.url.searchParams.get('UserId'))));
    const data=(await call('GET','/catalog/search?type=movie&q=Same')).json();
    assert.deepEqual(data.items.map(i=>i.year),[1984,2021]);
    assert.equal((await call('POST','/request-board','requester',{mediaType:'movie',mediaId:2})).statusCode,201);
});

test('library state is checked again on submission and outages do not create requests',async t=> {
    const {call,libraries,setFailure}=setup(t);
    assert.equal((await call('GET','/catalog/movie/1/check')).json().library.state,'not_found');
    libraries.requester=[{Id:'newly-owned',Type:'Movie',Name:'The Same Name',ProviderIds:{Imdb:'tt0000001'}}];
    assert.equal((await call('POST','/request-board','requester',{mediaType:'movie',mediaId:1})).statusCode,409);
    setFailure(); assert.equal((await call('POST','/request-board','trusted',{mediaType:'movie',mediaId:2})).statusCode,503);
    assert.equal((await call('GET','/request-board')).json().items.length,0);
});

test('only requester or administrator can remove entries; repeated requests are grouped and deduplicated',async t=> {
    const {call}=setup(t);
    const payload={mediaType:'movie',mediaId:1,authorId:'admin'};
    const first=(await call('POST','/request-board','requester',payload)).json();
    assert.equal((await call('POST','/request-board','requester',payload)).json().id,first.id);
    await call('POST','/request-board','trusted',payload);
    let board=(await call('GET','/request-board','trusted')).json();
    assert.equal(board.items.length,1); assert.equal(board.items[0].requests.length,2);
    const someoneElse=board.items[0].requests.find(r=>r.authorId==='requester'); assert.equal(someoneElse.canRemove,false);
    assert.equal((await call('DELETE',`/request-board/${first.id}`,'trusted')).statusCode,403);
    assert.equal((await call('PUT',`/request-board/${first.id}/status`,'trusted',{status:'available'})).statusCode,403);
    assert.equal((await call('PUT',`/request-board/${first.id}/status`,'admin',{status:'in_progress'})).statusCode,200);
    assert.equal((await call('DELETE',`/request-board/${first.id}`,'requester')).statusCode,200);
    board=(await call('GET','/request-board','admin')).json(); assert.equal(board.items[0].requests.length,1);
    assert.equal((await call('DELETE',`/request-board/${board.items[0].requests[0].id}`,'admin')).statusCode,200);
});

test('series checks episode numbers, excludes complete seasons, and rejects invalid seasons',async t=> {
    const {call,libraries}=setup(t);
    libraries.requester=[{Id:'series',Type:'Series',Name:'A Show',ProviderIds:{Tvdb:'100'}},
        {Type:'Episode',SeriesId:'series',ParentIndexNumber:1,IndexNumber:1},{Type:'Episode',SeriesId:'series',ParentIndexNumber:1,IndexNumber:2},
        {Type:'Episode',SeriesId:'series',ParentIndexNumber:2,IndexNumber:1},{Type:'Episode',SeriesId:'series',ParentIndexNumber:2,IndexNumber:1}];
    const check=(await call('GET','/catalog/tv/10/check')).json().library;
    assert.equal(check.state,'partial'); assert.equal(check.seasons[0].state,'available'); assert.equal(check.seasons[1].state,'partial');
    assert.equal((await call('POST','/request-board','requester',{mediaType:'tv',mediaId:10,seasons:[1]})).statusCode,409);
    assert.equal((await call('POST','/request-board','requester',{mediaType:'tv',mediaId:10,seasons:[999]})).statusCode,400);
    assert.equal((await call('POST','/request-board','requester',{mediaType:'tv',mediaId:10,seasons:[1,2]})).statusCode,201);
    assert.deepEqual((await call('GET','/request-board')).json().items[0].requests[0].seasons,[2]);
});

test('uncertain title matches require acknowledgement; restricted discovery and secret setup are protected',async t=> {
    const {call,libraries}=setup(t);
    libraries.requester=[{Id:'unknown-id',Type:'Movie',Name:'The Same Name',ProductionYear:1984}];
    assert.equal((await call('GET','/catalog/movie/1/check')).json().library.state,'needs_check');
    assert.equal((await call('POST','/request-board','requester',{mediaType:'movie',mediaId:1})).statusCode,409);
    assert.equal((await call('POST','/request-board','requester',{mediaType:'movie',mediaId:1,manualChecked:true})).statusCode,201);
    assert.equal((await call('GET','/catalog/search?type=movie&q=Same','restricted')).statusCode,403);
    assert.equal((await call('PUT','/request-board/config','requester',{token:'new-catalog-token-123456789'})).statusCode,403);
    const saved=await call('PUT','/request-board/config','admin',{token:'new-catalog-token-123456789'});
    assert.deepEqual(saved.json(),{catalogReady:true});
    assert.ok(!(await call('GET','/request-board/config','admin')).body.includes('new-catalog-token'));
});

test('missing catalogue setup is explicit and adding arbitrary titles is impossible',async t=> {
    const {call}=setup(t,'');
    assert.equal((await call('GET','/request-board/config','admin')).json().catalogReady,false);
    assert.equal((await call('GET','/catalog/search?type=movie&q=Same')).statusCode,503);
    assert.equal((await call('POST','/request-board','requester',{mediaType:'movie',mediaId:1,title:'Forged'})).statusCode,503);
});

test('completion countdown cancels on disappearance, survives failures and only removes at 72 hours',async t=> {
    const {app,call,libraries,setFailure}=setup(t); let now=10_000_000; app.requestBoard.store.now=()=>now;
    const id=(await call('POST','/request-board','requester',{mediaType:'movie',mediaId:1})).json().id;
    const declined=(await call('POST','/request-board','requester',{mediaType:'movie',mediaId:2})).json().id;
    await call('PUT',`/request-board/${declined}/status`,'admin',{status:'declined'});
    const scan=async()=> {app.requestBoard.lastSync.clear();return (await call('GET','/request-board')).json().items.flatMap(i=>i.requests);};
    const owned={Id:'owned',Type:'Movie',ProviderIds:{Tmdb:'1'}};
    libraries.requester=[owned]; let rows=await scan(); assert.equal(rows.find(r=>r.id===id).status,'available'); const first=rows.find(r=>r.id===id).availableAt;
    now+=1000; libraries.requester=[]; rows=await scan(); assert.equal(rows.find(r=>r.id===id).availableAt,null); assert.equal(rows.find(r=>r.id===id).status,'requested');
    libraries.requester=[owned]; rows=await scan(); const started=rows.find(r=>r.id===id).availableAt; assert.ok(started>first);
    now=started+72*60*60*1000-1; assert.ok((await scan()).some(r=>r.id===id));
    now++; setFailure(); assert.ok((await scan()).some(r=>r.id===id));
    setFailure(false); rows=await scan(); assert.ok(!rows.some(r=>r.id===id)); assert.equal(rows.find(r=>r.id===declined).status,'declined');
    assert.ok(app.requestBoard.db.prepare('SELECT removed_at FROM request_board WHERE id=?').get(id).removed_at);
});

test('only partial requested seasons count as progress; unrelated missing seasons do not block completion',async t=> {
    const {app,call,libraries}=setup(t);
    await call('POST','/request-board','requester',{mediaType:'tv',mediaId:10,seasons:[2]});
    libraries.requester=[{Id:'series',Type:'Series',ProviderIds:{Tmdb:'10'}},{Type:'Episode',SeriesId:'series',ParentIndexNumber:1,IndexNumber:1}];
    const scan=async()=> {app.requestBoard.lastSync.clear();return (await call('GET','/request-board')).json().items[0].requests[0];};
    assert.equal((await scan()).status,'requested');
    libraries.requester.push({Type:'Episode',SeriesId:'series',ParentIndexNumber:2,IndexNumber:1});
    let r=await scan(); assert.equal(r.status,'in_progress'); assert.equal(r.removeAfter,null);
    libraries.requester.push({Type:'Episode',SeriesId:'series',ParentIndexNumber:2,IndexNumber:2});
    r=await scan(); assert.equal(r.status,'available'); assert.ok(r.removeAfter);
});

test('background checks enforce current requester policy and use only that user library',async t=> {
    const {app,call,libraries,calls,policies}=setup(t);
    await call('POST','/request-board','requester',{mediaType:'movie',mediaId:1}); await call('POST','/request-board','trusted',{mediaType:'movie',mediaId:1});
    const key='private-library-key-1234567890';
    assert.equal((await call('PUT','/request-board/library-config','requester',{apiKey:key})).statusCode,403);
    assert.deepEqual((await call('PUT','/request-board/library-config','admin',{apiKey:key})).json(),{backgroundReady:true});
    assert.ok(!(await call('GET','/request-board/config','admin')).body.includes(key));
    assert.ok(!Object.hasOwn((await call('GET','/request-board/config')).json(),'backgroundReady'));
    libraries.requester=[{Id:'owned',Type:'Movie',ProviderIds:{Tmdb:'1'}}]; libraries.trusted=libraries.requester; policies.trusted={EnableAllFolders:false};
    calls.length=0; await app.requestBoard.reconcileBackground();
    const rows=app.requestBoard.db.prepare('SELECT author_id,status FROM request_board').all();
    assert.equal(rows.find(r=>r.author_id==='requester').status,'available'); assert.equal(rows.find(r=>r.author_id==='trusted').status,'requested');
    const checks=calls.filter(c=>c.url.pathname==='/Items'); assert.ok(checks.length); assert.ok(checks.every(c=>c.url.searchParams.get('UserId')==='requester' && c.options.headers.Authorization.includes(key)));
});

test('title identifiers are administrator-only with validated IMDb links and a TMDB fallback',async t=> {
    const {call}=setup(t); const id=(await call('POST','/request-board','requester',{mediaType:'movie',mediaId:1})).json().id;
    assert.equal((await call('GET',`/request-board/${id}/identifiers`)).statusCode,403);
    const ids=(await call('GET',`/request-board/${id}/identifiers`,'admin')).json(); assert.equal(ids.imdb,'tt0000001'); assert.equal(ids.imdbUrl,'https://www.imdb.com/title/tt0000001/');
    const show=(await call('POST','/request-board','requester',{mediaType:'tv',mediaId:10,seasons:[1]})).json().id;
    const fallback=(await call('GET',`/request-board/${show}/identifiers`,'admin')).json(); assert.equal(fallback.imdb,null); assert.equal(fallback.tmdbUrl,'https://www.themoviedb.org/tv/10');
});


test('availability countdown and private library connection survive backend restart',async t=> {
    const folder=mkdtempSync(join(tmpdir(),'request-completion-')),path=join(folder,'community.sqlite');
    const first=setup(t,undefined,path);let now=10_000_000; first.app.requestBoard.store.now=()=>now;
    const id=(await first.call('POST','/request-board','requester',{mediaType:'movie',mediaId:1})).json().id;
    const owned={Id:'owned',Type:'Movie',ProviderIds:{Tmdb:'1'}};first.libraries.requester=[owned];await first.call('GET','/request-board');
    const key='private-library-key-1234567890';await first.call('PUT','/request-board/library-config','admin',{apiKey:key});
    assert.equal(statSync(join(folder,'library-credentials.json')).mode & 0o777,0o600);
    assert.equal(JSON.parse(readFileSync(join(folder,'library-credentials.json'),'utf8')).apiKey,key);
    await first.app.close();
    const second=setup(t,undefined,path);second.app.requestBoard.store.now=()=>now;second.libraries.requester=[owned];
    assert.equal(second.app.requestBoard.libraryApiKey,key);
    assert.equal(second.app.requestBoard.db.prepare('SELECT available_at FROM request_board WHERE id=?').get(id).available_at,now);
    now+=72*60*60*1000;await second.app.requestBoard.reconcileBackground();
    assert.ok(second.app.requestBoard.db.prepare('SELECT removed_at FROM request_board WHERE id=?').get(id).removed_at);
    await second.app.close();rmSync(folder,{recursive:true,force:true});
});
