// Run only inside the isolated preview container. No Jellyfin users are created.
import { Store } from '/app/src/store.js';
if (process.env.PREVIEW_ONLY !== 'true') throw new Error('Preview fixtures require the isolated preview app');
const store=new Store(process.env.DATABASE_PATH);
try {
    const self=store.listPresence().find(user=>user.id!=='preview-friend');
    if (!self) throw new Error('Sign into the preview first');
    const friend={id:'preview-friend',name:'Preview Friend'};
    store.social.remember(friend);
    store.setPresence(friend,'preview_friend_session');
    const c=store.social.open(self,friend.id);
    if (!store.db.prepare('SELECT 1 FROM chat_messages WHERE conversation_id=?').get(c.id)) {
        const message=store.social.send(friend,c.id,'Hello! This conversation is local preview data. 🙂',null,'preview_message_0001');
        store.social.send(self,c.id,'Testing replies and reactions 🧃',message.id,'preview_message_0002');
        store.social.react(friend,'direct',message.id,'😀',true);
    }
    if (!store.db.prepare('SELECT 1 FROM messages').get()) {
        const message=store.createMessage(friend,'Welcome to the local chat preview! 🇮🇱🧃');
        store.social.react(self,'board',message.id,'😍',true);
        store.createMessage(self,'Reactions, quoted replies, and private chat are ready to review.',message.id);
    }
    console.log('Local preview fixtures ready; NAS data untouched.');
} finally {store.close();}
