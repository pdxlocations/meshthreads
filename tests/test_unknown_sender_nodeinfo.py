"""Automatic discovery without sleeping or sending radio packets."""
import importlib
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
from meshtastic.protobuf import mesh_pb2
from nodeinfo_requests import DelayedNodeInfoRequests


class SchedulerTests(unittest.TestCase):
    def setUp(self):
        self.now = 1000
        self.timers = []
        def timer(delay, callback):
            result = Mock(delay=delay, callback=callback)
            self.timers.append(result)
            return result
        self.scheduler = DelayedNodeInfoRequests(timer_factory=timer, clock=lambda: self.now, capacity=2)

    def test_delay_dedup_and_cooldown(self):
        callback = Mock()
        self.assertTrue(self.scheduler.schedule(7, callback))
        self.assertEqual(self.timers[0].delay, 5)
        callback.assert_not_called()
        self.assertFalse(self.scheduler.schedule(7, callback))
        self.timers[0].callback()
        callback.assert_called_once()
        self.assertFalse(self.scheduler.schedule(7, callback))
        self.now += 600
        self.assertTrue(self.scheduler.schedule(7, callback))

    def test_stagger_and_capacity(self):
        for sender in (7, 8):
            self.assertTrue(self.scheduler.schedule(sender, Mock()))
        self.assertEqual([t.delay for t in self.timers], [5, 6])
        self.assertFalse(self.scheduler.schedule(9, Mock()))


class AutoNodeInfoTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.tmp.cleanup)
        with patch.dict(os.environ, {
            'FIREFLY_DATABASE_FILE': str(Path(cls.tmp.name) / 'test.db'),
            'FIREFLY_RUNTIME_DIR': str(Path(cls.tmp.name) / 'runtime'),
        }), patch('mesh_runtime.SharedPacketReceiver.start'):
            cls.app = importlib.import_module('app')

    def setUp(self):
        self.profile = {'id': 'local', 'node_id': '!0000002a', 'channels': [
            {'name': 'Private', 'key': 'AQ=='}, {'name': 'MeshOregon', 'key': 'AQ=='}]}
        self.packet = mesh_pb2.MeshPacket(to=0xffffffff, channel=15)
        setattr(self.packet, 'from', 7)
        self.db = self.mock('db')
        self.db.get_profile_by_node_num.return_value = None
        self.lookup = self.mock('_find_sender_node_for_packet', return_value=None)
        self.queue = self.mock('_NODEINFO_REQUESTS')
        self.udp = self.mock('udp_server')
        self.udp.running = True
        self.udp.get_active_profile.return_value = self.profile

    def mock(self, name, **kwargs):
        patcher = patch.object(self.app, name, **kwargs)
        self.addCleanup(patcher.stop)
        return patcher.start()

    def run_request(self):
        self.app._schedule_unknown_sender_nodeinfo(self.packet)
        self.queue.schedule.call_args.args[1]()

    def test_unknown_sender_requests_on_received_channel(self):
        self.run_request()
        profile, sender = self.udp.exchange_nodeinfo.call_args.args
        self.assertEqual(sender, 7)
        self.assertEqual(profile['selected_channel_index'], 1)
        self.assertEqual(profile['channel'], 'MeshOregon')

    def test_placeholder_also_requests(self):
        self.lookup.return_value = {'long_name': '!00000007'}
        self.run_request()
        self.udp.exchange_nodeinfo.assert_called_once()

    def test_known_sender_does_not_schedule(self):
        self.lookup.return_value = {'long_name': 'Cedar'}
        self.app._schedule_unknown_sender_nodeinfo(self.packet)
        self.queue.schedule.assert_not_called()

    def test_nodeinfo_during_delay_skips_request(self):
        self.lookup.side_effect = [None, {'long_name': 'Cedar'}]
        self.run_request()
        self.udp.exchange_nodeinfo.assert_not_called()

    def test_stopped_transport_does_not_activate_profile(self):
        self.udp.running = False
        self.run_request()
        self.udp.exchange_nodeinfo.assert_not_called()

    def test_does_not_use_unrelated_channel(self):
        self.packet.channel = 200
        self.run_request()
        self.udp.exchange_nodeinfo.assert_not_called()

    def test_dm_for_other_profile_is_not_requested(self):
        self.packet.to = 99
        self.run_request()
        self.udp.exchange_nodeinfo.assert_not_called()

    def test_local_identity_is_not_requested(self):
        self.db.get_profile_by_node_num.return_value = self.profile
        self.app._schedule_unknown_sender_nodeinfo(self.packet)
        self.queue.schedule.assert_not_called()

    def test_pki_dm_uses_active_profile(self):
        self.packet.to = 42
        self.packet.channel = 0
        self.packet.pki_encrypted = True
        routing = self.mock('_profile_for_node_request', return_value=self.profile)
        self.run_request()
        routing.assert_called_once_with(self.profile, 7)
        self.udp.exchange_nodeinfo.assert_called_once_with(self.profile, 7)
