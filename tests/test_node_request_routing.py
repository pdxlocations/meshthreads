"""Node requests must use a destination's shared channel, not an unrelated board."""
import importlib
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
from mesh_runtime import MeshNodeStore


class NodeRequestRoutingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.tmp.cleanup)
        with patch.dict(os.environ, {'FIREFLY_DATABASE_FILE':str(Path(cls.tmp.name)/'test.db'),
                                    'FIREFLY_RUNTIME_DIR':str(Path(cls.tmp.name)/'runtime')}), patch('mesh_runtime.SharedPacketReceiver.start'):
            cls.module = importlib.import_module('app')

    def setUp(self):
        self.profile = {'id':'mine', 'node_id':'!12345678', 'channels':[
            {'name':'MeshOregon','key':'AQ=='}, {'name':'Private','key':'Ag=='},
        ]}
        self.mesh_hash = self.module._channel_number_for_config(self.profile['channels'][0])
        self.private_hash = self.module._channel_number_for_config(self.profile['channels'][1])
        self.node = self.patch('_node_for_profile', return_value={'channel_numbers':[self.mesh_hash]})
        self.patch('_get_session_profile', return_value=self.profile)
        self.sender = self.patch('udp_server')
        self.sender.exchange_nodeinfo.return_value = 123
        self.sender.send_traceroute.return_value = 456

    def patch(self, name, **kwargs):
        p = patch.object(self.module, name, **kwargs)
        self.addCleanup(p.stop)
        return p.start()

    def test_nodeinfo_from_private_board_uses_contact_mesh_channel(self):
        with self.module.app.test_request_context('/api/nodes/7/exchange-nodeinfo', method='POST'):
            self.module.session['current_channel_index'] = 1
            response = self.module.exchange_nodeinfo.__wrapped__(7)
            sent = self.sender.exchange_nodeinfo.call_args.args[0]
            self.assertEqual(sent['channel'], 'MeshOregon')
            self.assertEqual(response.json['channel_name'], 'MeshOregon')
            self.assertEqual(self.module.session['current_channel_index'], 1)

    def test_traceroute_from_private_board_uses_contact_mesh_channel(self):
        with self.module.app.test_request_context('/api/nodes/7/traceroute', method='POST', json={'hop_limit':3}):
            self.module.session['current_channel_index'] = 1
            response = self.module.send_node_traceroute.__wrapped__(7)
            sent = self.sender.send_traceroute.call_args.args[0]
            self.assertEqual(sent['channel'], 'MeshOregon')
            self.assertEqual(response.json['channel_name'], 'MeshOregon')
            self.assertEqual(self.sender.send_traceroute.call_args.kwargs['hop_limit'], 3)

    def test_selected_channel_is_kept_when_contact_is_known_there(self):
        self.node.return_value = {'channel_numbers':[self.mesh_hash,self.private_hash]}
        with self.module.app.test_request_context('/'):
            self.module.session['current_channel_index'] = 1
            selected = self.module._profile_for_node_request(self.profile, 7)
        self.assertEqual(selected['channel'], 'Private')

    def test_unknown_contact_uses_primary_channel(self):
        self.node.return_value = None
        with self.module.app.test_request_context('/'):
            self.module.session['current_channel_index'] = 1
            selected = self.module._profile_for_node_request(self.profile, 7)
        self.assertEqual(selected['channel'], 'MeshOregon')

    def test_contact_channel_evidence_survives_node_merge(self):
        store = object.__new__(MeshNodeStore)
        merged = store._merge_node_records({'node_num':7, 'channel_numbers':[15]},
                                            {'node_num':7, 'channel_numbers':[48,15]})
        self.assertEqual(merged['channel_numbers'], [15,48])
