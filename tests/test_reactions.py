import tempfile
import unittest
from pathlib import Path
from database import Database
from message_reactions import is_emoji_reply
from runtime_files import database_connection


class ReactionStorageTests(unittest.TestCase):
    def test_single_unicode_emoji_detection(self):
        for content in ['😀', '❤️', '👍🏽', '🇺🇸', '👨‍👩‍👧‍👦', '1️⃣', '🏳️‍🌈', ' ☀️ ']:
            with self.subTest(content=content):
                self.assertTrue(is_emoji_reply(content, 99))
                self.assertFalse(is_emoji_reply(content, None))
        for content in ['hi 😀', '😀😀', ':)', '', '1', 'abc', '1 2', '👍 and ❤️']:
            self.assertFalse(is_emoji_reply(content, 99), content)
        self.assertTrue(is_emoji_reply('😀😀', 99, flagged=True))

    def test_flags_persist_and_old_single_emoji_replies_are_recognized(self):
        with tempfile.TemporaryDirectory() as root:
            db = Database(str(Path(root)/'messages.db'))
            self.assertTrue(db.store_message('flagged',content='👍👍',channel=15,reply_packet_id=99,is_emoji=True))
            self.assertTrue(db.store_message('legacy',content='❤️',channel=15,reply_packet_id=99))
            self.assertTrue(db.store_message('standalone',content='😀',channel=15))
            self.assertTrue(db.store_message('dm',content='🇺🇸',channel=15,reply_packet_id=99,message_type='dm',owner_profile_id='p'))
            with database_connection(db.db_path) as conn:
                conn.execute("UPDATE messages SET is_emoji=0 WHERE message_id='legacy'")
            db = Database(db.db_path)
            messages = {m['id']:m for m in db.get_messages_for_channel(15)}
            self.assertTrue(messages['flagged']['is_emoji'])
            self.assertTrue(messages['legacy']['is_emoji'])
            self.assertFalse(messages['standalone']['is_emoji'])
            self.assertTrue(db.get_dm_messages_for_profile('p')[0]['is_emoji'])
