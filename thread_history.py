"""Indexed, cursor-paged channel threads. Message bodies are fetched only on demand."""
import base64
import json
import math
from datetime import datetime, timezone


def _epoch(value):
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return (parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)).timestamp()
    except (ValueError, TypeError):
        return 0


def index_message(conn, row):
    row_id, channel, packet, reply, timestamp = row
    parent = conn.execute('SELECT thread_id FROM channel_thread_members WHERE channel=? AND packet_id=? ORDER BY row_id DESC LIMIT 1', (channel, reply)).fetchone() if reply else None
    thread = parent[0] if parent else -int(reply) if reply else row_id
    orphan = -int(packet) if packet else None
    merging = orphan is not None and conn.execute('SELECT 1 FROM channel_threads WHERE channel=? AND thread_id=?', (channel, orphan)).fetchone()
    if thread == orphan:
        thread = row_id  # Self-replies and closed reply cycles need a real representative.
    if merging and thread != orphan:
        conn.execute('UPDATE channel_thread_members SET thread_id=? WHERE channel=? AND thread_id=?', (thread, channel, orphan))
        conn.execute('DELETE FROM channel_threads WHERE channel=? AND thread_id=?', (channel, orphan))
    conn.execute('INSERT INTO channel_thread_members VALUES(?,?,?,?)', (row_id, channel, thread, packet))
    if merging:
        members = conn.execute('SELECT m.id,m.timestamp FROM messages m JOIN channel_thread_members i ON i.row_id=m.id WHERE i.channel=? AND i.thread_id=?', (channel, thread)).fetchall()
        activity, last_id = max((_epoch(m[1]),m[0]) for m in members)
        conn.execute('INSERT OR REPLACE INTO channel_threads VALUES(?,?,?,?,?)', (channel,thread,activity,last_id,len(members)))
    else:
        activity = _epoch(timestamp)
        conn.execute('''INSERT INTO channel_threads VALUES(?,?,?,?,1) ON CONFLICT(channel,thread_id) DO UPDATE SET
            last_id=CASE WHEN excluded.activity>=activity THEN excluded.last_id ELSE last_id END,
            activity=max(activity,excluded.activity),message_count=message_count+1''', (channel,thread,activity,row_id))


def initialize_thread_history(conn):
    conn.execute('''CREATE TABLE IF NOT EXISTS channel_thread_members(
        row_id INTEGER PRIMARY KEY, channel INTEGER NOT NULL, thread_id INTEGER NOT NULL, packet_id INTEGER)''')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_thread_packet ON channel_thread_members(channel,packet_id,row_id DESC)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_thread_members ON channel_thread_members(channel,thread_id,row_id)')
    conn.execute('''CREATE TABLE IF NOT EXISTS channel_threads(channel INTEGER NOT NULL,thread_id INTEGER NOT NULL,
        activity REAL NOT NULL,last_id INTEGER NOT NULL,message_count INTEGER NOT NULL,PRIMARY KEY(channel,thread_id))''')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_thread_activity ON channel_threads(channel,activity DESC,last_id DESC)')
    # Upgrade once from compact relationship metadata, without hydrating message bodies.
    missing = conn.execute('''SELECT m.id,m.channel,m.packet_id,m.reply_packet_id,m.timestamp FROM messages m
        LEFT JOIN channel_thread_members i ON i.row_id=m.id
        WHERE coalesce(m.message_type,'channel')='channel' AND i.row_id IS NULL ORDER BY m.id''').fetchall()
    for row in missing:
        index_message(conn,row)
    conn.execute('''CREATE TRIGGER IF NOT EXISTS prune_thread_history BEFORE DELETE ON messages BEGIN
        UPDATE channel_threads SET
          message_count=message_count-1,
          activity=coalesce((SELECT max(cast(strftime('%s',m.timestamp) AS REAL)) FROM messages m JOIN channel_thread_members i ON i.row_id=m.id
            WHERE i.channel=channel_threads.channel AND i.thread_id=channel_threads.thread_id AND m.id!=OLD.id),0),
          last_id=coalesce((SELECT m.id FROM messages m JOIN channel_thread_members i ON i.row_id=m.id
            WHERE i.channel=channel_threads.channel AND i.thread_id=channel_threads.thread_id AND m.id!=OLD.id
            ORDER BY m.timestamp DESC,m.id DESC LIMIT 1),0)
        WHERE channel=OLD.channel AND thread_id=(SELECT thread_id FROM channel_thread_members WHERE row_id=OLD.id);
        DELETE FROM channel_threads WHERE message_count<=0;
        DELETE FROM channel_thread_members WHERE row_id=OLD.id;
    END''')


def reaction_summaries(conn,channel,thread,scope,params,targets):
    """Aggregate unique reactors without shipping every historical tapback row."""
    import unicodedata
    from message_reactions import is_emoji_reply
    rows=conn.execute(f"""SELECT m.message_id,m.packet_id,m.reply_packet_id,m.content,m.is_emoji,m.sender_num,m.sender_display
        FROM messages m JOIN channel_thread_members i ON i.row_id=m.id
        WHERE i.channel=? AND i.thread_id=? AND {scope} AND m.reply_packet_id IS NOT NULL
          AND (m.is_emoji=1 OR length(m.content)<=32) ORDER BY m.id""",(channel,thread,*params)).fetchall()
    packets={row['packet_id']:row for row in rows if row['packet_id']}
    groups={}
    for row in rows:
        if not is_emoji_reply(row['content'],row['reply_packet_id'],row['is_emoji']): continue
        target=row['reply_packet_id'];visited={row['packet_id']}
        while target in packets and is_emoji_reply(packets[target]['content'],packets[target]['reply_packet_id'],packets[target]['is_emoji']):
            if target in visited: target=None;break
            visited.add(target);target=packets[target]['reply_packet_id']
        if target not in targets: continue
        emoji=row['content'].strip()
        canonical=unicodedata.normalize('NFC',emoji).replace('\ufe0f','')
        group=groups.setdefault(target,{}).setdefault(canonical,{'emoji':emoji,'senders':{}})
        node=row['sender_num']
        identity=f'!{node:08x}' if node else ''
        group['senders'][str(node or row['message_id'])]={'sender_num':node,'sender':identity,'sender_display':row['sender_display'] or identity}
    return {target:[{'emoji':group['emoji'],'senders':list(group['senders'].values())} for group in values.values()] for target,values in groups.items()}


def _decode_cursor(cursor):
    if not cursor:
        return None
    try:
        value=json.loads(base64.urlsafe_b64decode(cursor+'='*(-len(cursor)%4)))
        if len(value)!=2 or not isinstance(value[0],(int,float)) or not math.isfinite(value[0]) or not isinstance(value[1],int) or not 0<value[1]<2**63: raise ValueError()
        return value
    except Exception:
        raise ValueError('Invalid history cursor.') from None


def _cursor(activity,row_id):
    return base64.urlsafe_b64encode(json.dumps([activity,row_id]).encode()).decode().rstrip('=')


class ThreadHistory:
    def _history_scope(self,conn,profile_id,channel):
        clear=self._channel_clear_state(conn,profile_id,channel)
        if clear and clear.get('cleared_through_message_id') is not None:
            return 'm.id>?',[int(clear['cleared_through_message_id'])]
        if clear and clear.get('cleared_before_timestamp'):
            return self._sqlite_ts_expr('m.timestamp')+'>'+self._sqlite_ts_expr('?'),[clear['cleared_before_timestamp']]
        return '1=1',[]

    def _history_messages(self,conn,channel,thread,scope,params,after=0,limit=40,focus_packet=None):
        rows=conn.execute(f'''SELECT m.* FROM messages m JOIN channel_thread_members i ON i.row_id=m.id
            WHERE i.channel=? AND i.thread_id=? AND {scope} AND m.id>? ORDER BY m.id LIMIT ?''',
            (channel,thread,*params,after,limit+1)).fetchall()
        has_more=len(rows)>limit
        rows=rows[:limit]
        next_after=rows[-1]['id'] if rows else after
        # Keep roots and intermediate ancestors attached even if they arrived late.
        by_id={r['id']:r for r in rows}
        root=conn.execute(f'''SELECT m.* FROM messages m JOIN channel_thread_members i ON i.row_id=m.id
            WHERE i.channel=? AND i.thread_id=? AND m.id=? AND {scope}''',(channel,thread,thread,*params)).fetchone()
        if root is not None: by_id[root['id']]=root
        latest=conn.execute(f'''SELECT m.* FROM messages m JOIN channel_thread_members i ON i.row_id=m.id
            WHERE i.channel=? AND i.thread_id=? AND {scope} ORDER BY m.id DESC LIMIT 1''',(channel,thread,*params)).fetchone()
        if latest is not None: by_id[latest['id']]=latest
        if focus_packet:
            focus=conn.execute(f"""SELECT m.* FROM messages m JOIN channel_thread_members i ON i.row_id=m.id
                WHERE i.channel=? AND i.thread_id=? AND i.packet_id=? AND {scope} ORDER BY m.id DESC LIMIT 1""", (channel,thread,focus_packet,*params)).fetchone()
            if focus is not None: by_id[focus['id']]=focus
        packets={row['packet_id'] for row in by_id.values() if row['packet_id']}
        queue=list(by_id.values())
        context_budget=40
        for row in queue:
            if context_budget<=0: break
            reply=row['reply_packet_id']
            if not reply or reply in packets: continue
            parent=conn.execute(f'''SELECT m.* FROM messages m JOIN channel_thread_members i ON i.row_id=m.id
                WHERE i.channel=? AND i.thread_id=? AND i.packet_id=? AND {scope} ORDER BY m.id DESC LIMIT 1''',
                (channel,thread,reply,*params)).fetchone()
            if parent is not None and parent['id'] not in by_id:
                by_id[parent['id']]=parent;queue.append(parent);packets.add(parent['packet_id']);context_budget-=1
        header=conn.execute('SELECT activity,last_id,message_count FROM channel_threads WHERE channel=? AND thread_id=?',(channel,thread)).fetchone()
        messages=self._serialize_messages(sorted(by_id.values(),key=lambda row:(_epoch(row['timestamp']),row['id']),reverse=True))
        summaries=reaction_summaries(conn,channel,thread,scope,params,{row['packet_id'] for row in by_id.values()})
        row_ids={row['message_id']:row['id'] for row in by_id.values()}
        for message in messages:
            message['history_row_id']=row_ids[message['id']]
            message['reaction_summary']=summaries.get(message['packet_id'],[])
            message['thread_id']=str(thread)
            message['thread_activity']=header['activity']*1000 if header else 0
            message['thread_last_id']=header['last_id'] if header else 0
        last_row=conn.execute('SELECT max(row_id) FROM channel_thread_members WHERE channel=? AND thread_id=?',(channel,thread)).fetchone()[0] or 0
        return {'thread_id':str(thread),'messages':messages,'has_more':has_more,'after':next_after,'last_row_id':last_row,
                'message_count':header['message_count'] if header else len(messages)}

    def get_channel_thread_page(self,channel,profile_id,cursor=None,limit=12,thread_id=None,after=0,focus_packet=None):
        import sqlite3
        from runtime_files import database_connection
        limit=max(1,min(int(limit),24))
        before=_decode_cursor(cursor)
        with database_connection(self.db_path) as conn:
            conn.row_factory=sqlite3.Row
            conn.execute('BEGIN')
            scope,params=self._history_scope(conn,profile_id,channel)
            if thread_id is not None:
                parsed_thread=int(thread_id)
                if not 0<=int(after)<2**63: raise ValueError('Invalid reply cursor.')
                if not -(2**63)<parsed_thread<2**63: raise ValueError('Invalid thread ID.')
                page=self._history_messages(conn,channel,parsed_thread,scope,params,after=max(0,int(after)),focus_packet=focus_packet)
                return {'channel':channel,'threads':[page],'next_cursor':None,'has_more':False}
            query=f'''SELECT h.* FROM channel_threads h WHERE h.channel=? AND EXISTS(
                SELECT 1 FROM channel_thread_members i JOIN messages m ON m.id=i.row_id
                WHERE i.channel=h.channel AND i.thread_id=h.thread_id AND {scope})'''
            values=[channel,*params]
            if before:
                query+=' AND (h.activity<? OR (h.activity=? AND h.last_id<?))'
                values.extend([before[0],before[0],before[1]])
            query+=' ORDER BY h.activity DESC,h.last_id DESC LIMIT ?'
            headers=conn.execute(query,(*values,limit+1)).fetchall()
            has_more=len(headers)>limit;headers=headers[:limit]
            threads=[self._history_messages(conn,channel,h['thread_id'],scope,params) for h in headers]
            return {'channel':channel,'threads':threads,'has_more':has_more,
                    'next_cursor':_cursor(headers[-1]['activity'],headers[-1]['last_id']) if has_more else None}

    def get_channel_thread_for_packet(self,channel,profile_id,packet_id):
        if not 0<int(packet_id)<=0xffffffff: raise ValueError('Invalid packet ID.')
        from runtime_files import database_connection
        with database_connection(self.db_path) as conn:
            row=conn.execute('SELECT thread_id FROM channel_thread_members WHERE channel=? AND packet_id=? ORDER BY row_id DESC LIMIT 1',(channel,packet_id)).fetchone()
        return self.get_channel_thread_page(channel,profile_id,thread_id=row[0],focus_packet=packet_id) if row else {'channel':channel,'threads':[],'has_more':False,'next_cursor':None}
