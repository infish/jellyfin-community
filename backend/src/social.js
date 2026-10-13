import { randomUUID } from 'node:crypto';

export const EMOJIS = ['😀','😃','😄','😁','😆','😅','😂','🤣','🙂','🙃','😉','😊','😇','🥰','😍','😘','😋','😛','😎','🤔','😐','🙄','😢','😭','😮','😴','😬','😡','🇮🇱','🧃'];
const fail = (message, statusCode = 404) => { throw Object.assign(new Error(message), { statusCode }); };

export class Social {
    constructor(store) {
        this.store = store;
        this.db = store.db;
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS community_users(id TEXT PRIMARY KEY, name TEXT NOT NULL);
            INSERT OR IGNORE INTO community_users SELECT author_id, display_name FROM messages;
            CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY, a TEXT NOT NULL, b TEXT NOT NULL, UNIQUE(a,b));
            CREATE TABLE IF NOT EXISTS chat_messages(seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
                conversation_id TEXT NOT NULL REFERENCES conversations(id), author_id TEXT NOT NULL,
                body TEXT NOT NULL, created_at INTEGER NOT NULL, reply_to TEXT REFERENCES chat_messages(id), client_id TEXT NOT NULL,
                UNIQUE(conversation_id,author_id,client_id));
            CREATE INDEX IF NOT EXISTS chat_order ON chat_messages(conversation_id,seq);
            CREATE TABLE IF NOT EXISTS chat_preferences(user_id TEXT NOT NULL, peer_id TEXT NOT NULL,
                muted INTEGER NOT NULL DEFAULT 0, blocked INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id,peer_id));
            CREATE TABLE IF NOT EXISTS chat_unread(user_id TEXT NOT NULL, conversation_id TEXT NOT NULL, through_seq INTEGER NOT NULL,
                PRIMARY KEY(user_id,conversation_id));
            CREATE TABLE IF NOT EXISTS reactions(scope TEXT NOT NULL, message_id TEXT NOT NULL, user_id TEXT NOT NULL,
                emoji TEXT NOT NULL, PRIMARY KEY(scope,message_id,user_id,emoji));
            INSERT OR IGNORE INTO migrations(version,applied_at) VALUES(2,datetime('now'));
        `);
        if (!this.db.prepare('PRAGMA table_info(messages)').all().some(c => c.name === 'reply_to')) this.db.exec('ALTER TABLE messages ADD COLUMN reply_to TEXT REFERENCES messages(id)');
        if (!this.db.prepare('SELECT 1 FROM migrations WHERE version=3').get()) this.db.exec(`
            BEGIN IMMEDIATE;
            DELETE FROM reactions WHERE rowid NOT IN (SELECT MAX(rowid) FROM reactions GROUP BY scope,message_id,user_id);
            CREATE UNIQUE INDEX IF NOT EXISTS reaction_per_person ON reactions(scope,message_id,user_id);
            INSERT INTO migrations VALUES(3,datetime('now'));
            COMMIT;
        `);
    }
    remember(user) { this.db.prepare('INSERT INTO community_users VALUES(?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name WHERE name!=excluded.name').run(user.id, user.name); }
    user(id) { return this.db.prepare('SELECT id,name FROM community_users WHERE id=?').get(id); }
    conversation(user, id) {
        const c = this.db.prepare('SELECT * FROM conversations WHERE id=? AND (a=? OR b=?)').get(id, user.id, user.id);
        if (!c) fail('Conversation not found');
        return { ...c, peer: c.a === user.id ? c.b : c.a };
    }
    settings(userId, peer) { return this.db.prepare('SELECT muted,blocked FROM chat_preferences WHERE user_id=? AND peer_id=?').get(userId, peer) || { muted: 0, blocked: 0 }; }
    blocked(userId, peer) { return !!this.db.prepare('SELECT 1 FROM chat_preferences WHERE ((user_id=? AND peer_id=?) OR (user_id=? AND peer_id=?)) AND blocked=1').get(userId, peer, peer, userId); }
    open(user, peer) {
        if (peer === user.id || !this.user(peer)) fail('Person unavailable');
        if (this.blocked(user.id, peer)) fail('Conversation unavailable', 403);
        const [a,b] = [user.id, peer].sort();
        this.db.prepare('INSERT OR IGNORE INTO conversations VALUES(?,?,?)').run(randomUUID(), a, b);
        return this.db.prepare('SELECT id FROM conversations WHERE a=? AND b=?').get(a,b);
    }
    list(user) {
        return this.db.prepare('SELECT id,a,b FROM conversations WHERE a=? OR b=?').all(user.id,user.id).map(c => {
            const peerId = c.a === user.id ? c.b : c.a;
            const preferences = this.settings(user.id, peerId);
            const last = this.db.prepare('SELECT body,created_at AS createdAt,seq FROM chat_messages WHERE conversation_id=? ORDER BY seq DESC LIMIT 1').get(c.id);
            const unread = this.db.prepare(`SELECT COUNT(*) AS n FROM chat_messages WHERE conversation_id=? AND author_id!=?
                AND seq>COALESCE((SELECT through_seq FROM chat_unread WHERE user_id=? AND conversation_id=?),0)`).get(c.id,user.id,user.id,c.id).n;
            return { id: c.id, peer: this.user(peerId), last: last ? { body: last.body, createdAt: last.createdAt } : null,
                unread, muted: !!preferences.muted, blocked: !!preferences.blocked, canSend: !this.blocked(user.id,peerId) };
        }).sort((a,b) => (b.last?.createdAt || 0) - (a.last?.createdAt || 0));
    }
    quote(scope, id) {
        if (!id) return null;
        const row = scope === 'board'
            ? this.db.prepare('SELECT id,author_id AS authorId,display_name AS displayName,body,deleted_at FROM messages WHERE id=?').get(id)
            : this.db.prepare('SELECT m.id,m.author_id AS authorId,u.name AS displayName,m.body FROM chat_messages m JOIN community_users u ON u.id=m.author_id WHERE m.id=?').get(id);
        if (!row) return null;
        return { id: row.id, authorId: row.authorId, displayName: row.deleted_at ? '' : row.displayName, body: row.deleted_at ? 'Message deleted' : row.body, deleted: !!row.deleted_at };
    }
    reactions(scope, id, user) {
        const rows = this.db.prepare('SELECT r.emoji,u.id,u.name FROM reactions r JOIN community_users u ON u.id=r.user_id WHERE scope=? AND message_id=? ORDER BY r.emoji,u.name').all(scope,id);
        return [...new Set(rows.map(r => r.emoji))].map(emoji => {
            const people = rows.filter(r => r.emoji === emoji).map(r => ({ id:r.id,name:r.name }));
            return { emoji, count:people.length, mine:people.some(p => p.id === user.id), people };
        });
    }
    boardMessage(id) {
        const m = this.db.prepare('SELECT id,author_id AS authorId,display_name AS displayName,body,created_at AS createdAt,reply_to FROM messages WHERE id=? AND deleted_at IS NULL').get(id);
        if (!m) fail('Message not found');
        return m;
    }
    enrichBoard(m, user) {
        const replyTo = this.db.prepare('SELECT reply_to FROM messages WHERE id=?').get(m.id)?.reply_to;
        return { ...m, reply: this.quote('board',replyTo), reactions: this.reactions('board',m.id,user) };
    }
    chatMessage(user, id) {
        const m = this.db.prepare('SELECT * FROM chat_messages WHERE id=?').get(id);
        if (!m) fail('Message not found');
        this.conversation(user,m.conversation_id);
        return m;
    }
    enrichChat(m,user) {
        return { id:m.id,seq:m.seq,authorId:m.author_id,displayName:this.user(m.author_id).name,body:m.body,createdAt:m.created_at,
            reply:this.quote('direct',m.reply_to),reactions:this.reactions('direct',m.id,user) };
    }
    messages(user,id,before) {
        this.conversation(user,id);
        const rows = this.db.prepare('SELECT * FROM chat_messages WHERE conversation_id=? AND seq<? ORDER BY seq DESC LIMIT 41').all(id,before || Number.MAX_SAFE_INTEGER);
        const more = rows.length > 40;
        if (more) rows.pop();
        return { items:rows.reverse().map(m => this.enrichChat(m,user)), nextCursor:more ? rows[0].seq : null };
    }
    send(user,id,body,replyTo,clientId) {
        const c = this.conversation(user,id);
        if (this.blocked(user.id,c.peer)) fail('Messaging is blocked',403);
        const old = this.db.prepare('SELECT * FROM chat_messages WHERE conversation_id=? AND author_id=? AND client_id=?').get(id,user.id,clientId);
        if (old) {
            if (old.body !== body || old.reply_to !== (replyTo || null)) fail('Message retry differs from original',409);
            return this.enrichChat(old,user);
        }
        if (replyTo && this.chatMessage(user,replyTo).conversation_id !== id) fail('Reply not found');
        const recent = this.db.prepare('SELECT COUNT(*) n FROM chat_messages WHERE author_id=? AND created_at>?').get(user.id,this.store.now()-60_000).n;
        if (recent >= 30) fail('Message limit reached; try again in a minute',429);
        const messageId = randomUUID();
        this.db.prepare('INSERT INTO chat_messages(id,conversation_id,author_id,body,created_at,reply_to,client_id) VALUES(?,?,?,?,?,?,?)').run(messageId,id,user.id,body,this.store.now(),replyTo || null,clientId);
        return this.enrichChat(this.chatMessage(user,messageId),user);
    }
    react(user,scope,id,emoji,active) {
        if (scope === 'board') this.boardMessage(id);
        else {
            const m = this.chatMessage(user,id);
            const c = this.conversation(user,m.conversation_id);
            if (this.blocked(user.id,c.peer)) fail('Messaging is blocked',403);
        }
        if (active) this.db.prepare('INSERT INTO reactions VALUES(?,?,?,?) ON CONFLICT(scope,message_id,user_id) DO UPDATE SET emoji=excluded.emoji').run(scope,id,user.id,emoji);
        else this.db.prepare('DELETE FROM reactions WHERE scope=? AND message_id=? AND user_id=? AND emoji=?').run(scope,id,user.id,emoji);
        return { reactions:this.reactions(scope,id,user) };
    }
}

export function registerSocial(app,store,upstreams,config) {
    const social = store.social;
    const enabled = () => { if (!config.boardEnabled) fail('Community chat is disabled',503); };
    const text = body => { if (typeof body !== 'string' || !body.trim() || [...body.trim()].length > 500) fail('Message must be 1–500 characters',400); return body.trim(); };
    const reply = value => { if (value != null && (typeof value !== 'string' || value.length > 96)) fail('Invalid reply',400); return value || null; };
    app.get('/api/community/messages/:id', async r => { enabled(); return social.enrichBoard(social.boardMessage(r.params.id),r.communityUser); });
    const ids = body => {
        if (!Array.isArray(body?.ids) || body.ids.length>200 || body.ids.some(id=>typeof id!=='string' || !/^[0-9a-f-]{36}$/.test(id))) fail('Invalid message list',400);
        return [...new Set(body.ids)];
    };
    app.post('/api/community/messages/snapshot',async r => {
        enabled(); return { items:ids(r.body).map(id=> {
            try { return social.enrichBoard(social.boardMessage(id),r.communityUser); }
            catch (error) { if (error.statusCode===404) return {id,deleted:true}; throw error; }
        }) };
    });
    app.post('/api/community/conversations/:id/snapshot',async r => {
        enabled(); social.conversation(r.communityUser,r.params.id);
        return { items:ids(r.body).map(id=> {
            const m=social.chatMessage(r.communityUser,id);
            if (m.conversation_id!==r.params.id) fail('Message not found');
            return social.enrichChat(m,r.communityUser);
        }) };
    });
    app.put('/api/community/reactions/:scope/:id', async r => {
        enabled();
        if (!['board','direct'].includes(r.params.scope) || !EMOJIS.includes(r.body?.emoji) || typeof r.body?.active !== 'boolean') fail('Invalid reaction',400);
        return social.react(r.communityUser,r.params.scope,r.params.id,r.body.emoji,r.body.active);
    });
    app.get('/api/community/conversations', async r => { enabled(); return { items:social.list(r.communityUser) }; });
    app.post('/api/community/conversations', async (r,reply) => { enabled(); if (typeof r.body?.peerId !== 'string') fail('Invalid person',400); return reply.code(201).send(social.open(r.communityUser,r.body.peerId)); });
    app.get('/api/community/conversations/:id/messages', async r => {
        enabled(); const before = r.query?.before;
        if (before && (!/^\d+$/.test(before) || !Number.isSafeInteger(Number(before)) || Number(before)<1)) fail('Invalid cursor',400);
        return social.messages(r.communityUser,r.params.id,before ? Number(before) : null);
    });
    app.get('/api/community/conversations/:id/messages/:messageId', async r => {
        enabled(); social.conversation(r.communityUser,r.params.id);
        const m = social.chatMessage(r.communityUser,r.params.messageId);
        if (m.conversation_id !== r.params.id) fail('Message not found');
        return social.enrichChat(m,r.communityUser);
    });
    app.post('/api/community/conversations/:id/messages', async (r,response) => {
        enabled(); if (!/^[a-zA-Z0-9_-]{16,96}$/.test(r.body?.clientId || '')) fail('Invalid message identifier',400);
        return response.code(201).send(social.send(r.communityUser,r.params.id,text(r.body?.body),reply(r.body?.replyTo),r.body.clientId));
    });
    // Only the current user's unread marker is stored. Never expose it to the sender.
    app.put('/api/community/conversations/:id/unread', async r => {
        enabled(); social.conversation(r.communityUser,r.params.id);
        const m = social.chatMessage(r.communityUser,r.body?.throughId || '');
        if (m.conversation_id !== r.params.id) fail('Message not found');
        social.db.prepare('INSERT INTO chat_unread VALUES(?,?,?) ON CONFLICT(user_id,conversation_id) DO UPDATE SET through_seq=MAX(through_seq,excluded.through_seq)').run(r.communityUser.id,r.params.id,m.seq);
        return { ok:true };
    });
    app.put('/api/community/conversations/:id/settings', async r => {
        enabled(); const c = social.conversation(r.communityUser,r.params.id);
        if (typeof r.body?.muted !== 'boolean' || typeof r.body?.blocked !== 'boolean') fail('Invalid conversation settings',400);
        social.db.prepare('INSERT INTO chat_preferences VALUES(?,?,?,?) ON CONFLICT(user_id,peer_id) DO UPDATE SET muted=excluded.muted,blocked=excluded.blocked').run(r.communityUser.id,c.peer,Number(r.body.muted),Number(r.body.blocked));
        return { ok:true };
    });
    app.get('/api/community/conversations/:id/avatar', async (r,response) => {
        enabled(); const c = social.conversation(r.communityUser,r.params.id);
        const avatar = await upstreams.avatar(c.peer,r.headers.authorization);
        return response.header('Cache-Control','private, no-store').type(avatar.type).send(avatar.body);
    });
    app.get('/api/community/conversations/:id/messages/:messageId/avatar', async (r,response) => {
        enabled(); social.conversation(r.communityUser,r.params.id);
        const m=social.chatMessage(r.communityUser,r.params.messageId);
        if (m.conversation_id!==r.params.id) fail('Message not found');
        const avatar=await upstreams.avatar(m.author_id,r.headers.authorization);
        return response.header('Cache-Control','private, no-store').type(avatar.type).send(avatar.body);
    });
    app.get('/api/community/conversations/:id/people/:personId/avatar',async (r,response)=> {
        enabled(); const c=social.conversation(r.communityUser,r.params.id);
        if (![c.a,c.b].includes(r.params.personId)) fail('Profile picture unavailable');
        const avatar=await upstreams.avatar(r.params.personId,r.headers.authorization);
        return response.header('Cache-Control','private, no-store').type(avatar.type).send(avatar.body);
    });
}
