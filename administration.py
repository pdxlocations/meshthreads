"""Administrative roles and browser-session accounting, without credentials in reports."""
import sqlite3
import json
import hashlib
import base64
import time
from runtime_files import database_connection

ACTIVE_WINDOW = 90


def initialize_admin_schema(conn):
    columns = {row[1] for row in conn.execute('PRAGMA table_info(users)')}
    upgrading = 'is_admin' not in columns
    if upgrading:
        conn.execute('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0')
    conn.execute('CREATE TABLE IF NOT EXISTS app_settings (name TEXT PRIMARY KEY, value TEXT NOT NULL)')
    conn.execute("INSERT OR IGNORE INTO app_settings VALUES ('initial_admin_assigned', '0')")
    # Existing installations have an established owner; do not let a new login claim them.
    if upgrading:
        owner = conn.execute('SELECT id FROM users ORDER BY created_at, rowid LIMIT 1').fetchone()
        if owner:
            conn.execute('UPDATE users SET is_admin = 1 WHERE id = ?', (owner[0],))
            conn.execute("UPDATE app_settings SET value = '1' WHERE name = 'initial_admin_assigned'")
    conn.execute('''CREATE TABLE IF NOT EXISTS web_sessions (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        profile_id TEXT, started_at REAL NOT NULL, last_seen REAL NOT NULL,
        ended_at REAL, online_seconds REAL NOT NULL DEFAULT 0)''')
    conn.execute('CREATE INDEX IF NOT EXISTS web_sessions_user ON web_sessions(user_id)')


def channel_revision(channels):
    return hashlib.sha256(json.dumps(channels, sort_keys=True).encode()).hexdigest()


def channel_summary(channels):
    return [{'index': index, 'name': channel['name'],
             'key_bytes': len(base64.b64decode(channel['key'].replace('-', '+').replace('_', '/')))}
            for index, channel in enumerate(channels)]


class Administration:
    def bootstrap_admin(self, user_id):
        with database_connection(self.db_path) as conn:
            conn.execute('BEGIN IMMEDIATE')
            pending = conn.execute("SELECT value FROM app_settings WHERE name = 'initial_admin_assigned'").fetchone()
            if pending and pending[0] == '0' and conn.execute('SELECT 1 FROM users WHERE id=?', (user_id,)).fetchone():
                conn.execute('UPDATE users SET is_admin=1 WHERE id=?', (user_id,))
                conn.execute("UPDATE app_settings SET value='1' WHERE name='initial_admin_assigned'")

    def set_user_admin(self, actor_id, user_id, enabled):
        with database_connection(self.db_path) as conn:
            conn.execute('BEGIN IMMEDIATE')
            actor = conn.execute('SELECT is_admin FROM users WHERE id=?', (actor_id,)).fetchone()
            if not actor or not actor[0]:
                return 'forbidden'
            target = conn.execute('SELECT is_admin FROM users WHERE id=?', (user_id,)).fetchone()
            if not target:
                return 'missing'
            if target[0] and not enabled and conn.execute('SELECT COUNT(*) FROM users WHERE is_admin=1').fetchone()[0] <= 1:
                return 'last_admin'
            conn.execute('UPDATE users SET is_admin=? WHERE id=?', (int(enabled), user_id))
            return 'ok'

    def admin_edit_user(self, actor_id, user_id, username, password_hash=None):
        with database_connection(self.db_path) as conn:
            conn.execute('BEGIN IMMEDIATE')
            if not conn.execute('SELECT 1 FROM users WHERE id=? AND is_admin=1', (actor_id,)).fetchone():
                return 'forbidden'
            if not conn.execute('SELECT 1 FROM users WHERE id=?', (user_id,)).fetchone():
                return 'missing'
            if conn.execute('SELECT 1 FROM users WHERE username=? COLLATE NOCASE AND id!=?', (username, user_id)).fetchone():
                return 'duplicate'
            conn.execute('UPDATE users SET username=? WHERE id=?', (username, user_id))
            if password_hash:
                conn.execute('UPDATE users SET password_hash=? WHERE id=?', (password_hash, user_id))
            return 'ok'

    def admin_delete_user(self, actor_id, user_id):
        with database_connection(self.db_path) as conn:
            conn.execute('PRAGMA foreign_keys=ON')
            conn.execute('BEGIN IMMEDIATE')
            if not conn.execute('SELECT 1 FROM users WHERE id=? AND is_admin=1', (actor_id,)).fetchone():
                return 'forbidden'
            target = conn.execute('SELECT is_admin FROM users WHERE id=?', (user_id,)).fetchone()
            if not target:
                return 'missing'
            if target[0] and conn.execute('SELECT COUNT(*) FROM users WHERE is_admin=1').fetchone()[0] <= 1:
                return 'last_admin'
            if actor_id == user_id:
                return 'self_delete'
            conn.execute("DELETE FROM messages WHERE message_type='dm' AND owner_profile_id IN (SELECT id FROM profiles WHERE user_id=?)", (user_id,))
            conn.execute('DELETE FROM users WHERE id=?', (user_id,))
            return 'ok'

    def admin_change_channel(self, actor_id, profile_id, index, revision, channel=None):
        from rooms import validate_channel
        with database_connection(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            conn.execute('BEGIN IMMEDIATE')
            if not conn.execute('SELECT 1 FROM users WHERE id=? AND is_admin=1', (actor_id,)).fetchone():
                return 'forbidden'
            row = conn.execute('SELECT channels_json,channel,key FROM profiles WHERE id=?', (profile_id,)).fetchone()
            if not row:
                return 'missing'
            channels = self._normalize_channels(row['channels_json'], row['channel'], row['key'])
            if revision != channel_revision(channels):
                return 'stale'
            if not 0 <= index < len(channels):
                return 'missing'
            if channel is None:
                if len(channels) == 1:
                    return 'last_channel'
                channels.pop(index)
            else:
                replacement = validate_channel({'name': channel.get('name', channels[index]['name']),
                                                'key': channel.get('key') or channels[index]['key']})
                if any(i != index and other == replacement for i, other in enumerate(channels)):
                    return 'duplicate'
                channels[index] = replacement
            conn.execute('''UPDATE profiles SET channel=?,key=?,channels_json=?,updated_at=CURRENT_TIMESTAMP
                         WHERE id=?''', (channels[0]['name'],channels[0]['key'],json.dumps(channels),profile_id))
            return 'ok'

    def start_web_session(self, session_id, user_id, profile_id=None, now=None):
        now = time.time() if now is None else now
        with database_connection(self.db_path) as conn:
            conn.execute('PRAGMA foreign_keys=ON')
            conn.execute('INSERT INTO web_sessions(id,user_id,profile_id,started_at,last_seen) VALUES(?,?,?,?,?)',
                         (session_id, user_id, profile_id, now, now))

    def touch_web_session(self, session_id, user_id, profile_id=None, end=False, now=None):
        now = time.time() if now is None else now
        with database_connection(self.db_path) as conn:
            cursor = conn.execute('''UPDATE web_sessions SET
                online_seconds=online_seconds + min(max(? - last_seen, 0), ?),
                last_seen=?, profile_id=?, ended_at=?
                WHERE id=? AND user_id=? AND ended_at IS NULL''',
                (now, ACTIVE_WINDOW, now, profile_id, now if end else None, session_id, user_id))
            return cursor.rowcount > 0

    def admin_overview(self, now=None):
        now = time.time() if now is None else now
        with database_connection(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            users = [dict(row) for row in conn.execute('SELECT id,username,is_admin,created_at FROM users ORDER BY username COLLATE NOCASE')]
            profiles = [dict(row) for row in conn.execute('SELECT id,user_id,node_id,long_name,short_name FROM profiles ORDER BY long_name COLLATE NOCASE')]
            sessions = [dict(row) for row in conn.execute('SELECT user_id,profile_id,started_at,last_seen,ended_at,online_seconds FROM web_sessions ORDER BY last_seen DESC')]
            messages = dict(conn.execute('SELECT direction,COUNT(*) FROM messages GROUP BY direction').fetchall())
            # Channel receives are shared; count them for each profile subscribed to that channel.
            profile_stats = {}
            for profile in self.get_all_profiles().values():
                from encryption import generate_hash
                channels = {generate_hash(c['name'], c['key']) for c in profile['channels']}
                received = 0
                if channels:
                    placeholders = ','.join('?' for _ in channels)
                    received = conn.execute(f'''SELECT COUNT(*) FROM messages WHERE direction='received'
                        AND ((message_type='dm' AND owner_profile_id=?) OR
                             (message_type='channel' AND channel IN ({placeholders})))''',
                        (profile['id'], *channels)).fetchone()[0]
                node_num = int(profile['node_id'][1:], 16)
                sent = conn.execute("SELECT COUNT(*) FROM messages WHERE direction='sent' AND sender_num=?", (node_num,)).fetchone()[0]
                profile_stats[profile['id']] = {'messages_in': received, 'messages_out': sent,
                    'channels': channel_summary(profile['channels']), 'channel_revision': channel_revision(profile['channels'])}
        for user in users:
            user['is_admin'] = bool(user['is_admin'])
            user['profiles'] = [{**p, **profile_stats.get(p['id'], {})} for p in profiles if p['user_id'] == user['id']]
            user['sessions'] = []
            user['online_seconds'] = 0
            for saved in sessions:
                if saved['user_id'] != user['id']:
                    continue
                entry = dict(saved)
                entry['active'] = entry['ended_at'] is None and entry['last_seen'] >= now - ACTIVE_WINDOW
                user['online_seconds'] += entry['online_seconds']
                user['sessions'].append(entry)
            user['active_sessions'] = sum(s['active'] for s in user['sessions'])
        return {'users': users, 'totals': {'users': len(users), 'profiles': len(profiles),
                'active_sessions': sum(u['active_sessions'] for u in users),
                'messages_in': messages.get('received', 0), 'messages_out': messages.get('sent', 0)},
                'active_window_seconds': ACTIVE_WINDOW, 'generated_at': now}
