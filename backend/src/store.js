import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { Social } from './social.js';

export class Store {
    constructor(path, now = () => Date.now()) {
        this.db = new DatabaseSync(path);
        this.now = now;
        this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
        this.migrate();
        this.social = new Social(this);
    }

    migrate() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS preferences(
                user_id TEXT PRIMARY KEY,
                presence_visible INTEGER NOT NULL DEFAULT 1,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS presence(
                session_id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                display_name TEXT NOT NULL,
                heartbeat_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS presence_user_time ON presence(user_id, heartbeat_at DESC);
            CREATE TABLE IF NOT EXISTS messages(
                id TEXT PRIMARY KEY,
                author_id TEXT NOT NULL,
                display_name TEXT NOT NULL,
                body TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                deleted_at INTEGER
            );
            CREATE INDEX IF NOT EXISTS messages_order ON messages(created_at DESC, id DESC);
            CREATE TABLE IF NOT EXISTS submissions(
                idempotency_key TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                fingerprint TEXT NOT NULL,
                title_key TEXT NOT NULL,
                state TEXT NOT NULL CHECK(state IN ('in_flight','complete','uncertain','failed')),
                upstream_request_id TEXT,
                response_json TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS submissions_active_title
              ON submissions(title_key) WHERE state IN ('in_flight','uncertain');
            INSERT OR IGNORE INTO migrations(version, applied_at) VALUES (1, datetime('now'));
        `);
    }

    close() { this.db.close(); }

    setPresence(user, sessionId) {
        const now = this.now();
        const preference = this.db.prepare('SELECT presence_visible FROM preferences WHERE user_id=?').get(user.id);
        if (preference?.presence_visible === 0) return false;
        this.db.prepare(`INSERT INTO presence(session_id,user_id,display_name,heartbeat_at) VALUES(?,?,?,?)
            ON CONFLICT(session_id) DO UPDATE SET user_id=excluded.user_id,display_name=excluded.display_name,heartbeat_at=excluded.heartbeat_at`)
            .run(sessionId, user.id, user.name, now);
        return true;
    }

    removeSession(userId, sessionId) {
        this.db.prepare('DELETE FROM presence WHERE user_id=? AND session_id=?').run(userId, sessionId);
    }

    setPresenceVisible(userId, visible) {
        const now = this.now();
        this.db.prepare(`INSERT INTO preferences(user_id,presence_visible,updated_at) VALUES(?,?,?)
            ON CONFLICT(user_id) DO UPDATE SET presence_visible=excluded.presence_visible,updated_at=excluded.updated_at`)
            .run(userId, visible ? 1 : 0, now);
        if (!visible) this.db.prepare('DELETE FROM presence WHERE user_id=?').run(userId);
    }

    presenceVisible(userId) {
        return this.db.prepare('SELECT presence_visible FROM preferences WHERE user_id=?').get(userId)?.presence_visible !== 0;
    }

    listPresence() {
        const cutoff = this.now() - 90_000;
        this.db.prepare('DELETE FROM presence WHERE heartbeat_at < ?').run(cutoff);
        return this.db.prepare(`SELECT user_id AS id, display_name AS name, MAX(heartbeat_at) AS heartbeatAt
            FROM presence GROUP BY user_id ORDER BY display_name COLLATE NOCASE`).all();
    }

    createMessage(user, body, replyTo = null) {
        const now = this.now();
        const recent = this.db.prepare('SELECT COUNT(*) count FROM messages WHERE author_id=? AND created_at>?').get(user.id, now - 60_000).count;
        if (recent >= 5) return null;
        const message = { id: randomUUID(), authorId: user.id, displayName: user.name, body, createdAt: now };
        this.db.prepare('INSERT INTO messages(id,author_id,display_name,body,created_at,reply_to) VALUES(?,?,?,?,?,?)')
            .run(message.id, message.authorId, message.displayName, message.body, message.createdAt, replyTo);
        return message;
    }

    listMessages(cursor) {
        const params = [];
        let where = 'deleted_at IS NULL';
        if (cursor) {
            const [time, id] = cursor.split(':');
            where += ' AND (created_at < ? OR (created_at = ? AND id < ?))';
            params.push(Number(time), Number(time), id);
        }
        const rows = this.db.prepare(`SELECT id,author_id AS authorId,display_name AS displayName,body,created_at AS createdAt
            FROM messages WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT 31`).all(...params);
        const hasMore = rows.length > 30;
        if (hasMore) rows.pop();
        const last = rows.at(-1);
        return { items: rows, nextCursor: hasMore && last ? `${last.createdAt}:${last.id}` : null };
    }

    deleteMessage(user, id) {
        const row = this.db.prepare('SELECT author_id FROM messages WHERE id=? AND deleted_at IS NULL').get(id);
        if (!row) return 'missing';
        if (row.author_id !== user.id && !user.isAdmin) return 'forbidden';
        this.db.prepare('UPDATE messages SET deleted_at=? WHERE id=?').run(this.now(), id);
        return 'deleted';
    }

    messageAuthor(id) {
        return this.db.prepare('SELECT author_id FROM messages WHERE id=? AND deleted_at IS NULL').get(id)?.author_id;
    }

    beginSubmission({ key, userId, fingerprint, titleKey }) {
        const old = this.db.prepare('SELECT * FROM submissions WHERE idempotency_key=?').get(key);
        if (old) return old.fingerprint === fingerprint ? { kind: 'existing', row: old } : { kind: 'conflict' };
        const now = this.now();
        try {
            this.db.prepare(`INSERT INTO submissions(idempotency_key,user_id,fingerprint,title_key,state,created_at,updated_at)
                VALUES(?,?,?,?, 'in_flight',?,?)`).run(key, userId, fingerprint, titleKey, now, now);
            return { kind: 'started' };
        } catch (error) {
            if (String(error).includes('submissions_active_title')) return { kind: 'busy' };
            throw error;
        }
    }

    finishSubmission(key, state, response, upstreamId = null) {
        this.db.prepare('UPDATE submissions SET state=?,response_json=?,upstream_request_id=?,updated_at=? WHERE idempotency_key=?')
            .run(state, response == null ? null : JSON.stringify(response), upstreamId == null ? null : String(upstreamId), this.now(), key);
    }
}
