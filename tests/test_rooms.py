"""Room API tests use temporary storage and a mocked radio transport."""
import base64
import importlib
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
from flask import Flask
from rooms import channel_url, parse_channel_url, register_room_routes


class ChannelLinks(unittest.TestCase):
    def test_meshtastic_protobuf_round_trip(self):
        channel = {'name': 'Nightshift', 'key': base64.b64encode(bytes(range(32))).decode()}
        self.assertEqual(parse_channel_url(channel_url(channel)), channel)

    def test_invalid_and_external_links_rejected(self):
        for url in ('https://example.org/e/#abc', 'javascript:alert(1)', 'https://meshtastic.org/e/#garbage'):
            with self.assertRaises(ValueError):
                parse_channel_url(url)

    def test_radio_name_limit_counts_utf8_bytes(self):
        with self.assertRaises(ValueError):
            channel_url({'name': '🛰' * 4, 'key': 'AQ=='})


class RoomAPI(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.active = {'id': 'mine', 'user_id': 'user', 'node_id': '!12345678', 'long_name': 'Station',
                       'short_name': 'STAT', 'hop_limit': 3, 'channels': [{'name': 'LongFast', 'key': 'AQ=='}]}
        self.manager = Mock()
        self.manager.get_profile.side_effect = lambda *a, **k: self.active
        def update(*args):
            self.active['channels'] = args[5]
            return True
        self.manager.update_profile.side_effect = update
        self.transport = Mock()
        self.api = {
            'app': self.app, 'login_required': lambda f: f,
            '_get_session_profile': lambda: self.active,
            '_get_session_user': lambda: {'id': 'user'},
            '_profile_channels': lambda p: list(p['channels']),
            '_profile_node_num': lambda p: 0x12345678,
            'profile_manager': self.manager, '_set_session_profile': Mock(),
            '_set_session_channel_index': Mock(), '_serialize_profile_for_client': lambda p: p,
            'ensure_profile_config': Mock(), '_seed_profile_mesh_identity': Mock(),
            'MCAST_GRP': '239.0.0.69', 'MCAST_PORT': 4403,
            '_effective_profile': lambda p: p, 'udp_server': self.transport,
        }
        register_room_routes(self.api)
        self.client = self.app.test_client()

    def test_create_uses_random_256_bit_keys_and_preserves_rooms(self):
        response = self.client.post('/api/rooms', json={'name': 'Retro'})
        self.assertEqual(response.status_code, 200)
        key = self.active['channels'][-1]['key']
        self.assertEqual(len(base64.b64decode(key)), 32)
        self.client.post('/api/rooms', json={'name': 'Retro2'})
        self.assertNotEqual(self.active['channels'][-1]['key'], key)
        self.assertEqual(self.active['channels'][0]['name'], 'LongFast')
        self.assertEqual(self.manager.update_profile.call_args.args[1], 'user')

    def test_join_is_explicit_and_idempotent(self):
        url = channel_url({'name': 'Retro', 'key': 'Ag=='})
        for _ in range(2):
            response = self.client.post('/api/rooms', json={'url': url})
            self.assertEqual(response.status_code, 200)
        self.assertEqual(len(self.active['channels']), 2)
        self.assertEqual(response.json['selected_channel_index'], 1)

    def test_invite_any_owned_room_uses_dm_and_contains_compatible_link(self):
        self.active['channels'].append({'name': 'Secret', 'key': base64.b64encode(bytes(32)).decode()})
        response = self.client.post('/api/rooms/1/invite', json={'target_node_num': 456})
        self.assertEqual(response.status_code, 200)
        args, kwargs = self.transport.send_message.call_args
        self.assertEqual(kwargs['message_type'], 'dm')
        self.assertEqual(kwargs['target_node_num'], 456)
        self.assertIn('Join my room Secret:', args[0])
        self.assertEqual(parse_channel_url(args[0].split(': ', 1)[1]), self.active['channels'][1])

    def test_invite_failure_and_invalid_recipient_are_reported(self):
        self.assertEqual(self.client.post('/api/rooms/0/invite', json={'target_node_num': 0xFFFFFFFF}).status_code, 400)
        self.transport.send_message.return_value = False
        self.transport.last_send_error = 'No public key'
        self.assertEqual(self.client.post('/api/rooms/0/invite', json={'target_node_num': 456}).status_code, 502)

    def test_leave_last_room_is_rejected(self):
        self.assertEqual(self.client.delete('/api/rooms/0').status_code, 400)
        self.manager.update_profile.assert_not_called()

    def test_rename_and_key_rotation_preserve_identity(self):
        self.client.put('/api/rooms/0', json={'name': 'Renamed', 'rotate_key': True})
        self.assertEqual(self.active['channels'][0]['name'], 'Renamed')
        self.assertEqual(self.manager.update_profile.call_args.args[2], '!12345678')
        self.assertEqual(len(base64.b64decode(self.active['channels'][0]['key'])), 32)

    def test_profile_required(self):
        self.api['_get_session_profile'] = lambda: None
        self.assertEqual(self.client.post('/api/rooms', json={'name': 'Nope'}).status_code, 400)
        self.manager.update_profile.assert_not_called()
