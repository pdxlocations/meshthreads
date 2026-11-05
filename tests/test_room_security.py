"""Exercise real authentication, CSRF, ownership, persistence and board history."""
import importlib
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from database import Database


class RoomSecurity(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.env = patch.dict(os.environ, {'FIREFLY_DATABASE_FILE': str(root / 'test.db'), 'FIREFLY_RUNTIME_DIR': str(root / 'runtime')})
        self.env.start()
        self.addCleanup(self.env.stop)
        with patch('mesh_runtime.SharedPacketReceiver.start'):
            self.module = importlib.import_module('app')
        self.db = Database(str(root / 'test.db'))
        self.module.migrate_profile_identities(self.db, '239.0.0.69', 4403)
        for name in ('alice', 'bob'):
            self.db.create_user(name, name, 'unused')
        for name, value in [('db', self.db), ('profile_manager', self.module.ProfileManager(self.db))]:
            patcher = patch.object(self.module, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.client = self.module.app.test_client()
        with self.client.session_transaction() as session:
            session['user_id'] = 'alice'
            session['csrf_token'] = 'test-token'
        self.headers = {'X-CSRF-Token': 'test-token'}
        response = self.client.post('/api/profiles', headers=self.headers, json={
            'long_name': 'Alice', 'short_name': 'ALIC', 'channels': [{'name':'LongFast','key':'AQ=='}],
        })
        self.assertEqual(response.status_code, 200)
        self.profile_id = response.json['profile_id']
        with self.client.session_transaction() as session:
            session['current_profile'] = self.db.get_profile(self.profile_id)

    def test_rooms_require_login_and_csrf(self):
        anonymous = self.module.app.test_client()
        self.assertEqual(anonymous.get('/api/rooms/0').status_code, 401)
        self.assertEqual(self.client.post('/api/rooms', json={'name':'Secret'}).status_code, 403)
        self.assertEqual(self.client.post('/api/rooms', headers=self.headers, json={'name':'Secret'}).status_code, 200)
        self.assertEqual(len(self.db.get_profile(self.profile_id)['channels']), 2)

    def test_another_users_profile_cannot_supply_invite_keys(self):
        with self.client.session_transaction() as session:
            session['user_id'] = 'bob'
        self.assertEqual(self.client.get('/api/rooms/0').status_code, 400)
        self.assertEqual(self.client.post('/api/rooms', headers=self.headers, json={'name':'Secret'}).status_code, 400)
        self.assertEqual(len(self.db.get_profile(self.profile_id)['channels']), 1)

    def test_non_object_payload_is_rejected(self):
        self.assertEqual(self.client.post('/api/rooms', headers=self.headers, json=['invalid']).status_code, 400)

    def test_old_thread_root_is_available_after_more_than_100_messages(self):
        profile = self.db.get_profile(self.profile_id)
        channel = self.module._channel_number_for_config(profile['channels'][0])
        for packet in range(1, 103):
            self.db.store_message(str(packet), packet_id=packet, sender_num=42,
                                  content='post', channel=channel, reply_packet_id=1 if packet == 102 else None)
        payload = self.client.get('/api/messages').json
        self.assertLess(len(payload['channel_messages']), 102)
        self.assertEqual(len(payload['channel_history']['threads']), 12)
        self.assertTrue(payload['channel_history']['has_more'])
        self.assertTrue(any(m['packet_id'] == 1 for m in payload['channel_messages']))

    def test_history_api_is_scoped_validates_cursors_and_paginates(self):
        profile=self.db.get_profile(self.profile_id)
        channel=self.module._channel_number_for_config(profile['channels'][0])
        for n in range(1,35):
            self.db.store_message(str(n),packet_id=n,sender_num=8,content='Stored message',channel=channel)
        first=self.client.get('/api/channel-history?channel_index=0')
        self.assertEqual(first.status_code,200)
        self.assertEqual(len(first.json['threads']),12)
        cursor=first.json['next_cursor']
        second=self.client.get('/api/channel-history',query_string={'channel_index':0,'cursor':cursor})
        self.assertEqual(second.status_code,200)
        self.assertTrue(set(t['thread_id'] for t in first.json['threads']).isdisjoint(t['thread_id'] for t in second.json['threads']))
        self.assertEqual(self.client.get('/api/channel-history?channel_index=1').status_code,400)
        self.assertEqual(self.client.get('/api/channel-history?cursor=invalid').status_code,400)
        self.assertEqual(self.module.app.test_client().get('/api/channel-history').status_code,401)
        state=self.client.get('/api/message-state').json
        self.assertNotIn('channel_messages',state)
        self.assertEqual(len(state['channel_summaries']),1)
