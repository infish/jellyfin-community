import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../src/server.js';

function setup(t,token='test-catalog-token-1234567890') {
    const libraries={requester:[],trusted:[],admin:[]}; let failure=false; const calls=[];
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
        if (url.pathname==='/Items') {
            if (failure) return new Response('',{status:503});
            const rows=libraries[url.searchParams.get('UserId')] || [];
            const filtered=url.searchParams.has('ParentId') ? rows.filter(i=>i.SeriesId===url.searchParams.get('ParentId')) : rows.filter(i=>i.Type===(url.searchParams.get('IncludeItemTypes')==='Movie' ? 'Movie':'Series'));
            return Response.json({Items:filtered,TotalRecordCount:filtered.length});
        }
        throw new Error('Unexpected test URL');
    };
    const app=buildServer({config:{databasePath:':memory:',jellyfinUrl:'http://jellyfin',mockUpstreams:true,requestBoardEnabled:true,tmdbReadToken:token},fetch,logger:false});
    t.after(()=>app.close());
    const call=(method,path,user='requester',payload)=>app.inject({method,url:'/api/community'+path,headers:{authorization:`Bearer ${user}-token`},payload});
    return {app,call,libraries,calls,setFailure:()=> {failure=true;}};
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
