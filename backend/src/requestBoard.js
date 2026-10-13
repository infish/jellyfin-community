import { randomUUID } from 'node:crypto';
import { readFileSync,writeFileSync,renameSync,unlinkSync } from 'node:fs';
import { dirname,join } from 'node:path';

const fail=(message,statusCode=400)=> {throw Object.assign(new Error(message),{statusCode});};
const TYPES=['movie','tv'];
export const COMPLETION_DELAY=72*60*60*1000;
export const REQUEST_STATES=['requested','in_progress','available','declined'];
const clean=value=>typeof value==='string' ? value.trim() : '';
const normalized=value=>clean(value).normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu,'');

export class RequestBoard {
    constructor(store,upstreams,config) {
        this.store=store; this.db=store.db; this.upstreams=upstreams; this.config=config;
        this.detailsCache=new Map(); this.inventoryCache=new Map(); this.lastSync=new Map(); this.syncing=false;
        this.credentialPath=config.databasePath===':memory:' ? null : join(dirname(config.databasePath),'catalog-credentials.json');
        if (!config.tmdbReadToken && this.credentialPath) {
            try {this.config.tmdbReadToken=JSON.parse(readFileSync(this.credentialPath,'utf8')).tmdbReadToken || '';}
            catch (error) {if (error.code!=='ENOENT') this.credentialError=true;}
        }
        this.db.exec(`CREATE TABLE IF NOT EXISTS request_board(
            id TEXT PRIMARY KEY,author_id TEXT NOT NULL,display_name TEXT NOT NULL,media_type TEXT NOT NULL,media_id INTEGER NOT NULL,
            title TEXT NOT NULL,year INTEGER,poster_path TEXT,seasons TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'requested',
            created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,removed_at INTEGER);
            CREATE INDEX IF NOT EXISTS request_board_order ON request_board(created_at DESC,id DESC);
            CREATE UNIQUE INDEX IF NOT EXISTS request_board_person_title ON request_board(author_id,media_type,media_id) WHERE removed_at IS NULL;
            INSERT OR IGNORE INTO migrations VALUES(4,datetime('now'));`);
        this.migrateCompletion(); this.loadLibraryCredential();
    }
    // Migration keeps existing requests and starts no countdown without a library check.
    migrateCompletion() {
        const columns=this.db.prepare('PRAGMA table_info(request_board)').all();
        if (!columns.some(c=>c.name==='available_at')) this.db.exec('ALTER TABLE request_board ADD COLUMN available_at INTEGER');
        this.db.exec("INSERT OR IGNORE INTO migrations VALUES(5,datetime('now'))");
    }
    loadLibraryCredential() {
        this.libraryCredentialPath=this.credentialPath ? join(dirname(this.credentialPath),'library-credentials.json') : null;
        this.libraryApiKey=this.config.jellyfinLibraryApiKey || '';
        if (!this.libraryApiKey && this.libraryCredentialPath) {
            try {this.libraryApiKey=JSON.parse(readFileSync(this.libraryCredentialPath,'utf8')).apiKey || '';}
            catch (error) {if(error.code!=='ENOENT') this.libraryCredentialError=true;}
        }
    }
    async identifiers(user,id) {
        this.access(user); if (!user.isAdmin) fail('Only administrators can view catalogue identifiers',403);
        const row=this.db.prepare('SELECT media_type,media_id FROM request_board WHERE id=? AND removed_at IS NULL').get(id);
        if (!row) fail('Request not found',404);
        const title=await this.details(user,row.media_type,row.media_id);
        const imdb=/^tt[0-9]{7,10}$/.test(title.providerIds.imdb || '') ? title.providerIds.imdb : null;
        return {imdb,imdbUrl:imdb ? `https://www.imdb.com/title/${imdb}/` : null,tmdb:String(row.media_id),tmdbUrl:`https://www.themoviedb.org/${row.media_type}/${row.media_id}`};
    }
    async reconcile(user,header) {
        this.access(user);
        const rows=this.db.prepare("SELECT * FROM request_board WHERE author_id=? AND removed_at IS NULL AND status!='declined'").all(user.id);
        for (const key of this.inventoryCache.keys()) if(key.startsWith(`${user.id}:`)) this.inventoryCache.delete(key);
        for (const row of rows) {
            if(this.closed) break;
            try {
                const title=await this.details(user,row.media_type,row.media_id);
                const library=await this.check(user,header,title);
                if(library.state==='needs_check') continue;
                const requested=JSON.parse(row.seasons);
                const seasons=requested.map(n=>library.seasons.find(season=>season.number===n));
                if(row.media_type==='tv' && (!seasons.length || seasons.some(season=>!season || !season.total))) continue;
                const complete=row.media_type==='movie' ? library.state==='available' : seasons.every(season=>season.state==='available');
                const partial=row.media_type==='tv' && seasons.some(season=>season.present>0);
                if(this.closed) break;
                const current=this.db.prepare('SELECT * FROM request_board WHERE id=? AND removed_at IS NULL').get(row.id);
                // An administrator or requester may have changed the entry during upstream calls.
                if(!current || current.status!==row.status || current.seasons!==row.seasons || current.updated_at!==row.updated_at) continue;
                const now=this.store.now();
                if(complete) {
                    const availableAt=current.available_at ?? now;
                    if(current.status==='available' && current.available_at!=null && now>=availableAt+COMPLETION_DELAY) {
                        this.db.prepare('UPDATE request_board SET removed_at=?,updated_at=? WHERE id=?').run(now,now,row.id);
                    } else this.db.prepare("UPDATE request_board SET status='available',available_at=?,updated_at=? WHERE id=?").run(availableAt,now,row.id);
                } else {
                    const status=partial ? 'in_progress' : current.status==='available' ? 'requested' : current.status;
                    this.db.prepare('UPDATE request_board SET status=?,available_at=NULL,updated_at=? WHERE id=?').run(status,now,row.id);
                }
            } catch { /* Failed or incomplete checks never complete or remove a request. */ }
        }
    }
    async reconcileCaller(user,header) {
        if(this.syncing || (this.lastSync.get(user.id) ?? -Infinity)>this.store.now()-60_000) return;
        this.syncing=true;
        try {await this.reconcile(user,header); this.lastSync.set(user.id,this.store.now());}
        finally {this.syncing=false;}
    }
    async reconcileBackground() {
        if(this.syncing || !this.libraryApiKey || !this.config.requestBoardEnabled) return;
        this.syncing=true;
        try {
            const people=this.db.prepare("SELECT DISTINCT author_id FROM request_board WHERE removed_at IS NULL AND status!='declined'").all();
            for(const person of people) {
                if(this.closed) break;
                try {
                    const data=await this.upstreams.json(`${this.config.jellyfinUrl}/Users/${encodeURIComponent(person.author_id)}`,{headers:this.headers(`Bearer ${this.libraryApiKey}`)});
                    if(data.Id!==person.author_id || data.Policy?.IsDisabled || !this.upstreams.isDiscoveryEligible({policy:data.Policy})) continue;
                    await this.reconcile({id:data.Id,name:data.Name,isAdmin:data.Policy?.IsAdministrator===true,policy:data.Policy},`Bearer ${this.libraryApiKey}`);
                } catch { /* Deleted, disabled, restricted, and unreachable accounts are skipped. */ }
            }
        } finally {this.syncing=false;}
    }
    access(user) {
        if (!this.config.requestBoardEnabled) fail('Request board is disabled',503);
        if (!this.upstreams.isDiscoveryEligible(user)) fail('The request catalogue is unavailable for this account',403);
    }
    credentials() { if (!this.config.tmdbReadToken) fail('Title search needs the administrator to connect TMDB',503); }
    validate(type,id) { if (!TYPES.includes(type) || !/^\d{1,10}$/.test(String(id)) || Number(id)<1) fail('Invalid title'); }
    async tmdb(path,query={}) {
        this.credentials();
        return this.upstreams.json(`https://api.themoviedb.org/3/${path}?${new URLSearchParams({language:'en-US',...query})}`,{headers:{Authorization:`Bearer ${this.config.tmdbReadToken}`}});
    }
    item(type,data) {
        const posterPath=/^\/[a-zA-Z0-9_-]+\.(jpg|png)$/.test(data.poster_path || '') ? data.poster_path : null;
        return {mediaType:type,mediaId:data.id,title:data.title || data.name || 'Untitled',originalTitle:data.original_title || data.original_name || '',
            year:Number((data.release_date || data.first_air_date || '').slice(0,4)) || null,overview:clean(data.overview).slice(0,2000),posterPath,
            posterUrl:posterPath ? `/api/community/catalog/artwork?path=${encodeURIComponent(posterPath)}` : null};
    }
    async search(user,type,query,page) {
        this.access(user); if (!TYPES.includes(type) || query.length<2 || query.length>100) fail('Search must be 2–100 characters');
        const data=await this.tmdb(`search/${type}`,{query,page:String(page),include_adult:'false'});
        return {page:data.page,totalPages:Math.min(data.total_pages || 1,500),items:(data.results || []).filter(d=>!d.adult).map(d=>this.item(type,d))};
    }
    async details(user,type,id) {
        this.access(user); this.validate(type,id); this.credentials();
        const key=`${type}:${id}`,cached=this.detailsCache.get(key);
        if (cached?.expires>Date.now()) return cached.value;
        const d=await this.tmdb(`${type}/${id}`,{append_to_response:'external_ids'});
        if (d.adult) fail('Title unavailable',404);
        const value={...this.item(type,d),providerIds:{tmdb:String(d.id),imdb:d.imdb_id || d.external_ids?.imdb_id || null,tvdb:d.external_ids?.tvdb_id ? String(d.external_ids.tvdb_id) : null},
            seasons:type==='tv' ? (d.seasons || []).filter(s=>s.season_number>0).map(s=>({number:s.season_number,name:s.name,total:s.episode_count || 0})) : []};
        if (this.detailsCache.size>=200) this.detailsCache.clear();
        this.detailsCache.set(key,{value,expires:Date.now()+300_000}); return value;
    }
    headers(header) {
        const token=header.replace(/^Bearer\s+/i,'');
        return {Authorization:/^MediaBrowser\s/i.test(header) ? header : `MediaBrowser Client="Jellyfin Community", Device="Requests", DeviceId="community-requests", Version="0.1.0", Token="${token.replace(/["\\]/g,'')}"`};
    }
    async library(user,header,type,parentId=null,fresh=false) {
        const key=`${user.id}:${type}:${parentId || ''}`;
        const cached=this.inventoryCache.get(key); if (!fresh && cached?.expires>Date.now()) return cached.items;
        const items=[];
        for (let start=0;start<5000;start+=250) {
            if(this.closed) fail('Library check paused for restart',503);
            const params={UserId:user.id,Recursive:'true',IncludeItemTypes:parentId ? 'Episode' : type==='movie' ? 'Movie' : 'Series',Fields:'ProviderIds,LocationType',Limit:'250',StartIndex:String(start),EnableImages:'false',EnableUserData:'false',EnableTotalRecordCount:'true'};
            if (parentId) params.ParentId=parentId;
            const data=await this.upstreams.json(`${this.config.jellyfinUrl}/Items?${new URLSearchParams(params)}`,{headers:this.headers(header)});
            if (!Array.isArray(data.Items) || !Number.isInteger(data.TotalRecordCount)) fail('Could not verify your library',503);
            items.push(...data.Items);
            if (items.length>=data.TotalRecordCount) {
                if (this.inventoryCache.size>=100) this.inventoryCache.clear();
                this.inventoryCache.set(key,{items,expires:Date.now()+15_000}); return items;
            }
            if (!data.Items.length) break;
        }
        fail('Your library check could not finish; no request was added',503);
    }
    async check(user,header,title,fresh=false) {
        const items=await this.library(user,header,title.mediaType,null,fresh);
        const physical=item=>!item.IsPlaceHolder && !item.IsMissing && item.LocationType!=='Virtual';
        const match=item=>Object.entries(item.ProviderIds || {}).some(([provider,id])=>title.providerIds[provider.toLowerCase()] && String(id)===title.providerIds[provider.toLowerCase()]);
        const exact=items.filter(match);
        const candidates=items.filter(item=>[title.title,title.originalTitle].some(name=>name && normalized(name)===normalized(item.Name)) && (!title.year || !item.ProductionYear || title.year===item.ProductionYear));
        if (!exact.length) return {state:candidates.length ? 'needs_check' : 'not_found',matches:candidates.map(m=>({id:m.Id,name:m.Name,year:m.ProductionYear})),seasons:title.seasons};
        if (title.mediaType==='movie') return {state:exact.some(physical) ? 'available' : 'not_found',matches:exact.filter(physical).map(m=>({id:m.Id,name:m.Name})),seasons:[]};
        const episodes=(await Promise.all(exact.map(series=>this.library(user,header,'tv',series.Id,fresh)))).flat().filter(physical);
        const seasons=title.seasons.map(s=> {
            const numbers=new Set();
            for (const ep of episodes.filter(ep=>ep.ParentIndexNumber===s.number)) {
                if (!Number.isInteger(ep.IndexNumber) || ep.IndexNumber<1) continue;
                const end=Number.isInteger(ep.IndexNumberEnd) ? Math.min(ep.IndexNumberEnd,ep.IndexNumber+100) : ep.IndexNumber;
                for (let n=ep.IndexNumber;n<=end;n++) numbers.add(n);
            }
            const complete=s.total>0 && Array.from({length:Math.min(s.total,2000)},(_,i)=>i+1).every(n=>numbers.has(n)) && s.total<=2000;
            return {...s,present:numbers.size,state:complete ? 'available' : numbers.size ? 'partial' : 'missing'};
        });
        return {state:seasons.length && seasons.every(s=>s.state==='available') ? 'available' : episodes.length ? 'partial' : 'not_found',matches:exact.map(m=>({id:m.Id,name:m.Name})),seasons};
    }
    list(user) {
        this.access(user);
        const rows=this.db.prepare('SELECT * FROM request_board WHERE removed_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 1000').all();
        const groups=new Map();
        for (const r of rows) {
            const key=`${r.media_type}:${r.media_id}`;
            if (!groups.has(key)) groups.set(key,{mediaType:r.media_type,mediaId:r.media_id,title:r.title,year:r.year,
                posterUrl:r.poster_path ? `/api/community/catalog/artwork?path=${encodeURIComponent(r.poster_path)}` : null,requests:[]});
            groups.get(key).requests.push({id:r.id,authorId:r.author_id,displayName:r.display_name,seasons:JSON.parse(r.seasons),status:r.status,createdAt:r.created_at,availableAt:r.available_at,removeAfter:r.status==='available' && r.available_at!=null ? r.available_at+COMPLETION_DELAY : null,canRemove:r.author_id===user.id || user.isAdmin});
        }
        return {items:[...groups.values()]};
    }
    async add(user,header,input) {
        this.access(user); this.validate(input?.mediaType,input?.mediaId);
        const title=await this.details(user,input.mediaType,input.mediaId);
        const check=await this.check(user,header,title,true);
        if (check.state==='available') fail('This title is already in your library',409);
        if (check.state==='needs_check' && input.manualChecked!==true) fail('Check the possible library match before adding this request',409);
        let seasons=[];
        if (title.mediaType==='tv') {
            if (!Array.isArray(input.seasons) || !input.seasons.length || input.seasons.length>100 || input.seasons.some(n=>!Number.isInteger(n) || !title.seasons.some(s=>s.number===n))) fail('Select valid seasons');
            seasons=[...new Set(input.seasons)].filter(n=>check.seasons.find(s=>s.number===n)?.state!=='available').sort((a,b)=>a-b);
            if (!seasons.length) fail('The selected seasons are already available',409);
        }
        const existing=this.db.prepare('SELECT id,seasons,status FROM request_board WHERE author_id=? AND media_type=? AND media_id=? AND removed_at IS NULL').get(user.id,title.mediaType,title.mediaId);
        if (existing) {
            if (title.mediaType==='tv') this.db.prepare('UPDATE request_board SET seasons=?,updated_at=?,status=?,available_at=NULL WHERE id=?').run(JSON.stringify([...new Set([...JSON.parse(existing.seasons),...seasons])].sort((a,b)=>a-b)),this.store.now(),existing.status==='declined' || existing.status==='available' ? 'requested' : existing.status,existing.id);
            return {id:existing.id,existing:true};
        }
        const recent=this.db.prepare('SELECT COUNT(*) n FROM request_board WHERE author_id=? AND created_at>?').get(user.id,this.store.now()-60_000).n;
        if (recent>=5) fail('Request limit reached; try again in a minute',429);
        const id=randomUUID(),now=this.store.now();
        this.db.prepare('INSERT INTO request_board(id,author_id,display_name,media_type,media_id,title,year,poster_path,seasons,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,user.id,user.name,title.mediaType,title.mediaId,title.title,title.year,title.posterPath,JSON.stringify(seasons),now,now);
        return {id,existing:false};
    }
    remove(user,id) {
        this.access(user); const row=this.db.prepare('SELECT author_id FROM request_board WHERE id=? AND removed_at IS NULL').get(id);
        if (!row) fail('Request not found',404);
        if (row.author_id!==user.id && !user.isAdmin) fail('Only the requester or an administrator can remove this request',403);
        this.db.prepare('UPDATE request_board SET removed_at=?,updated_at=? WHERE id=?').run(this.store.now(),this.store.now(),id);
        return {ok:true};
    }
}

export function registerRequestBoard(app,store,upstreams,config) {
    const board=new RequestBoard(store,upstreams,config);
    app.decorate('requestBoard',board);
    app.addHook('onReady',async()=> {if(config.requestSyncIntervalMs!==0) {board.timer=setInterval(()=>void board.reconcileBackground(),config.requestSyncIntervalMs || 300_000); board.timer.unref(); void board.reconcileBackground();}});
    app.addHook('onClose',async()=> {board.closed=true; clearInterval(board.timer); while(board.syncing) await new Promise(resolve=>setTimeout(resolve,10));});
    app.get('/api/community/request-board/config',async r=> {board.access(r.communityUser);return {catalogReady:!!config.tmdbReadToken,isAdmin:r.communityUser.isAdmin,setupError:board.credentialError ? 'Saved catalogue access could not be read. Reconnect TMDB.' : null,...(r.communityUser.isAdmin ? {backgroundReady:!!board.libraryApiKey} : {})};});
    app.put('/api/community/request-board/config',async r=> {
        board.access(r.communityUser); if (!r.communityUser.isAdmin) fail('Only administrators can connect TMDB',403);
        const token=clean(r.body?.token);
        if (token.length<20 || token.length>2048 || /\s/.test(token)) fail('Enter the TMDB API Read Access Token');
        // Validate without returning or logging the token or upstream errors.
        try {await upstreams.json('https://api.themoviedb.org/3/configuration',{headers:{Authorization:`Bearer ${token}`}});}
        catch {fail('TMDB did not accept this token or could not be reached',400);}
        if (board.credentialPath) {
            const temp=board.credentialPath+'.new';
            try {
                writeFileSync(temp,JSON.stringify({tmdbReadToken:token}),{mode:0o600});
                renameSync(temp,board.credentialPath);
            } catch {try {unlinkSync(temp);} catch {} fail('Could not save catalogue access',503);}
        }
        config.tmdbReadToken=token; board.credentialError=false; board.detailsCache.clear(); return {catalogReady:true};
    });
    app.put('/api/community/request-board/library-config',async r=> {
        board.access(r.communityUser); if(!r.communityUser.isAdmin) fail('Only administrators can connect background library checks',403);
        const apiKey=clean(r.body?.apiKey);
        if(!/^[a-zA-Z0-9_-]{20,128}$/.test(apiKey)) fail('Enter a Jellyfin API key');
        try {
            const users=await upstreams.json(`${config.jellyfinUrl}/Users`,{headers:board.headers(`Bearer ${apiKey}`)});
            if(!Array.isArray(users) || !users.some(user=>user.Id===r.communityUser.id && user.Policy?.IsAdministrator && !user.Policy?.IsDisabled)) throw new Error('Invalid API access');
        } catch {fail('Jellyfin did not accept this key for background library checks',400);}
        if(board.libraryCredentialPath) {
            const temp=board.libraryCredentialPath+'.new';
            try {writeFileSync(temp,JSON.stringify({apiKey}),{mode:0o600}); renameSync(temp,board.libraryCredentialPath);}
            catch {try {unlinkSync(temp);} catch {} fail('Could not save library access',503);}
        }
        board.libraryApiKey=apiKey; return {backgroundReady:true};
    });
    app.get('/api/community/request-board/:id/identifiers',async r=>board.identifiers(r.communityUser,r.params.id));
    app.get('/api/community/request-board',async r=> {board.access(r.communityUser); await board.reconcileCaller(r.communityUser,r.headers.authorization); return board.list(r.communityUser);});
    app.post('/api/community/request-board',async (r,response)=>response.code(201).send(await board.add(r.communityUser,r.headers.authorization,r.body)));
    app.delete('/api/community/request-board/:id',async r=>board.remove(r.communityUser,r.params.id));
    app.put('/api/community/request-board/:id/status',async r=> {
        board.access(r.communityUser); if (!r.communityUser.isAdmin) fail('Only administrators can change request status',403);
        if (!REQUEST_STATES.includes(r.body?.status)) fail('Invalid status');
        const result=board.db.prepare('UPDATE request_board SET status=?,updated_at=?,available_at=NULL WHERE id=? AND removed_at IS NULL').run(r.body.status,store.now(),r.params.id);
        if (!result.changes) fail('Request not found',404);return {ok:true};
    });
    app.get('/api/community/catalog/search',async r=>board.search(r.communityUser,r.query.type,clean(r.query.q),Math.max(1,Math.min(500,Number(r.query.page)||1))));
    app.get('/api/community/catalog/:type/:id/check',async r=> {
        const title=await board.details(r.communityUser,r.params.type,r.params.id);
        return {title,library:await board.check(r.communityUser,r.headers.authorization,title)};
    });
    app.get('/api/community/catalog/artwork',async (r,response)=> {
        board.access(r.communityUser); const path=clean(r.query.path);
        if (!/^\/[a-zA-Z0-9_-]+\.(jpg|png)$/.test(path)) fail('Invalid poster');
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),config.upstreamTimeoutMs);
        try {
            const image=await upstreams.fetch(`https://image.tmdb.org/t/p/w300${path}`,{redirect:'manual',signal:controller.signal});
            const type=(image.headers.get('content-type') || '').split(';')[0];
            if (!image.ok || !['image/jpeg','image/png','image/webp'].includes(type)) fail('Poster unavailable',404);
            const bytes=await image.arrayBuffer(); if (bytes.byteLength>2_000_000) fail('Poster unavailable',502);
            return response.header('Cache-Control','private, max-age=300').type(type).send(Buffer.from(bytes));
        } finally {clearTimeout(timer);}
    });
}
