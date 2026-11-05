"""Thread paging keeps roots, clear boundaries, activity and channel scope intact."""
import tempfile
import unittest
from pathlib import Path
from runtime_files import database_connection
from database import Database


class ThreadHistoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.path=str(Path(self.tmp.name)/'history.db');self.db=Database(self.path)
        self.db.create_user('u','u','hash')
        self.db.create_profile('p','u','!00000007','Test','TST',[{'name':'Room','key':'AQ=='}])

    def message(self,n,reply=None,channel=15,**extra):
        self.assertTrue(self.db.store_message(str(n),packet_id=n,sender_num=8,content=f'Message {n}',channel=channel,reply_packet_id=reply,**extra))

    def test_cursor_pages_do_not_repeat_or_omit_threads_and_bumped_roots_survive(self):
        for n in range(1,81):self.message(n)
        self.message(100,reply=1)
        first=self.db.get_channel_thread_page(15,'p')
        self.assertEqual(len(first['threads']),12)
        self.assertEqual([m['packet_id'] for m in first['threads'][0]['messages']],[1,100])
        ids=[];page=first
        while True:
            ids.extend(t['thread_id'] for t in page['threads'])
            if not page['has_more']:break
            page=self.db.get_channel_thread_page(15,'p',cursor=page['next_cursor'])
        self.assertEqual(len(ids),80);self.assertEqual(len(set(ids)),80)

    def test_long_threads_page_replies_and_include_root_and_requested_live_reply(self):
        self.message(1)
        for n in range(2,132):self.message(n,reply=1)
        first=self.db.get_channel_thread_page(15,'p')['threads'][0]
        self.assertEqual(len(first['messages']),41);self.assertTrue(first['has_more'])
        second=self.db.get_channel_thread_page(15,'p',thread_id=first['thread_id'],after=first['after'])['threads'][0]
        self.assertLessEqual(len(second['messages']),42)
        self.assertIn(1,[m['packet_id'] for m in second['messages']])
        focused=self.db.get_channel_thread_for_packet(15,'p',131)['threads'][0]
        self.assertIn(131,[m['packet_id'] for m in focused['messages']])
        self.assertIn(1,[m['packet_id'] for m in focused['messages']])
        self.assertEqual(focused['after'],40)

    def test_late_parent_merges_orphan_groups_and_cycles_are_finite(self):
        self.message(2,reply=1);self.message(3,reply=1);self.message(1)
        page=self.db.get_channel_thread_page(15,'p')
        self.assertEqual(len(page['threads']),1)
        self.assertEqual({m['packet_id'] for m in page['threads'][0]['messages']},{1,2,3})
        self.message(10,reply=11);self.message(11,reply=10)
        self.assertEqual(len(self.db.get_channel_thread_page(15,'p')['threads']),2)
        Database(self.path)
        self.assertEqual(len(self.db.get_channel_thread_page(15,'p')['threads']),2)

    def test_pages_never_include_other_channels_or_dms(self):
        self.message(1);self.message(2,channel=16);self.message(3,message_type='dm',owner_profile_id='p')
        page=self.db.get_channel_thread_page(15,'p')
        self.assertEqual([m['packet_id'] for t in page['threads'] for m in t['messages']],[1])
        self.assertEqual(self.db.get_channel_thread_for_packet(15,'p',2)['threads'],[])
        other=self.db.get_channel_thread_page(15,'p',thread_id=2)
        self.assertEqual(other['threads'][0]['messages'],[])

    def test_clear_history_is_profile_scoped_and_does_not_resurrect_roots(self):
        self.message(1);self.message(2,reply=1)
        self.db.clear_channel_messages_for_profile('p',15)
        self.assertEqual(self.db.get_channel_thread_page(15,'p')['threads'],[])
        self.message(3,reply=1)
        own=self.db.get_channel_thread_page(15,'p')['threads'][0]
        self.assertEqual([m['packet_id'] for m in own['messages']],[3])
        self.assertEqual(len(self.db.get_channel_thread_page(15,None)['threads'][0]['messages']),3)

    def test_delete_prunes_index_and_rebuild_backfills_legacy_rows(self):
        self.message(1);self.message(2,reply=1)
        with database_connection(self.path) as conn:conn.execute('DELETE FROM messages WHERE packet_id=2')
        self.assertEqual(self.db.get_channel_thread_page(15,'p')['threads'][0]['message_count'],1)
        with database_connection(self.path) as conn:
            conn.execute('DELETE FROM messages')
            conn.execute("INSERT INTO messages(message_id,packet_id,sender_num,content,channel) VALUES('legacy',99,8,'Legacy',15)")
        Database(self.path)
        self.assertEqual(self.db.get_channel_thread_page(15,'p')['threads'][0]['messages'][0]['packet_id'],99)

    def test_reaction_counts_and_senders_include_reactions_beyond_reply_page(self):
        self.message(1)
        for n in range(2,102):
            self.assertTrue(self.db.store_message(str(n),packet_id=n,sender_num=n%5+10,content='❤️',channel=15,reply_packet_id=1))
        thread=self.db.get_channel_thread_page(15,'p')['threads'][0]
        self.assertLess(len(thread['messages']),102)
        root=next(m for m in thread['messages'] if m['packet_id']==1)
        self.assertEqual(len(root['reaction_summary']),1)
        self.assertEqual(len(root['reaction_summary'][0]['senders']),5)

    def test_deep_reply_chains_cannot_force_the_entire_thread_into_one_page(self):
        for n in range(1,250): self.message(n,reply=n-1 if n>1 else None)
        messages=self.db.get_channel_thread_page(15,'p')['threads'][0]['messages']
        self.assertLessEqual(len(messages),82)
        self.assertIn(1,[m['packet_id'] for m in messages])
        self.assertIn(249,[m['packet_id'] for m in messages])

    def test_invalid_cursor_is_rejected(self):
        for cursor in ('invalid','WzFd','e30'):
            with self.assertRaises(ValueError):self.db.get_channel_thread_page(15,'p',cursor=cursor)
