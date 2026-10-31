import importlib
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from database import Database
from meshtastic.protobuf import mesh_pb2


class SavedTracerouteTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        with patch.dict(os.environ, {'FIREFLY_DATABASE_FILE': str(root/'initial.db'), 'FIREFLY_RUNTIME_DIR': str(root/'runtime')}), patch('mesh_runtime.SharedPacketReceiver.start'):
            self.module = importlib.import_module('app')
        self.db = Database(str(root/'routes.db'))
        for user, node_id in [('alice', '!0000002a'), ('bob', '!0000002b')]:
            self.db.create_user(user, user, 'unused')
            self.assertTrue(self.db.create_profile(user, user, node_id, user, user, [{'name': 'LongFast', 'key': 'AQ=='}]))
        self.profile = self.db.get_profile('alice')
        for name, value in [('db', self.db), ('socketio', unittest.mock.Mock())]:
            patcher = patch.object(self.module, name, value)
            patcher.start(); self.addCleanup(patcher.stop)
        patcher = patch.object(self.module, '_dm_owner_profile_for_packet', return_value=self.profile)
        patcher.start(); self.addCleanup(patcher.stop)
        patcher = patch.object(self.module, '_display_name_for_node_num', side_effect=lambda n: f'node-{n}')
        patcher.start(); self.addCleanup(patcher.stop)
        self.client = self.module.app.test_client()
        self.login('alice')

    def login(self, user):
        with self.client.session_transaction() as session:
            session['user_id'] = user
            session['current_profile'] = self.db.get_profile(user)

    def receive(self, packet_id=100, request_id=99, destination=42):
        packet = mesh_pb2.MeshPacket(id=packet_id, to=destination)
        setattr(packet, 'from', 7)
        packet.decoded.request_id = request_id
        route = mesh_pb2.RouteDiscovery(route=[9], route_back=[8], snr_towards=[20, -128], snr_back=[16])
        self.module._emit_traceroute_result(packet, route)

    def test_received_route_survives_restart_and_latest_replaces_previous(self):
        self.receive()
        stored = Database(self.db.db_path).get_latest_traceroutes('alice')[7]
        self.assertEqual([hop['node_num'] for hop in stored['route_towards']], [42, 9, 7])
        self.assertEqual([hop['node_num'] for hop in stored['route_back']], [7, 8, 42])
        self.assertEqual(stored['route_towards'][0]['snr'], 5)
        self.assertIsNone(stored['route_towards'][1]['snr'])
        self.assertTrue(stored['received_at'].endswith('+00:00'))
        self.receive(packet_id=101)
        latest = self.db.get_latest_traceroutes('alice')
        self.assertEqual(len(latest), 1)
        self.assertEqual(latest[7]['packet_id'], 101)
        self.assertEqual(self.db.get_latest_traceroutes('bob'), {})

    def test_incoming_requests_and_routes_for_another_identity_do_not_overwrite_saved_result(self):
        self.receive()
        self.receive(packet_id=101, request_id=0)
        self.receive(packet_id=102, destination=43)
        self.assertEqual(self.db.get_latest_traceroutes('alice')[7]['packet_id'], 100)

    def test_authenticated_node_apis_return_only_current_profiles_saved_route(self):
        self.receive()
        node = {'node_num': 7, 'node_id': '!00000007', 'long_name': 'Cedar'}
        with patch.object(self.module, '_nodes_for_profile', return_value=[node]), patch.object(self.module, '_node_for_profile', return_value=node):
            self.assertEqual(self.client.get('/api/nodes').json['nodes'][0]['latest_traceroute']['packet_id'], 100)
            self.assertEqual(self.client.get('/api/nodes/7').json['latest_traceroute']['packet_id'], 100)
            self.login('bob')
            self.assertIsNone(self.client.get('/api/nodes/7').json['latest_traceroute'])
            self.assertIsNone(self.client.get('/api/nodes').json['nodes'][0]['latest_traceroute'])
        self.assertEqual(self.module.app.test_client().get('/api/nodes').status_code, 401)

    def test_deleting_profile_cleans_up_routes(self):
        self.receive()
        self.assertTrue(self.db.delete_profile('alice', 'alice'))
        self.assertEqual(self.db.get_latest_traceroutes('alice'), {})
