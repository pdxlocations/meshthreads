"""Receive-path regressions with real protobuf/AES and no network traffic."""
import importlib
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
from meshtastic.protobuf import mesh_pb2, portnums_pb2
from mudp.encryption import encrypt_packet
from mudp.rx_message_handler import UDPPacketStream


class ReceiveProtocolTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.tmp.cleanup)
        with patch.dict(os.environ, {
            'FIREFLY_DATABASE_FILE': str(Path(cls.tmp.name) / 'test.db'),
            'FIREFLY_RUNTIME_DIR': str(Path(cls.tmp.name) / 'runtime'),
        }), patch('mesh_runtime.SharedPacketReceiver.start'):
            cls.module = importlib.import_module('app')

    def setUp(self):
        self.module._DEDUP_CACHE.clear()
        self.module._DEDUP_QUEUE.clear()
        self.profile = {'id': 'test', 'node_id': '!0000002a', 'channels': [{'name':'MeshOregon','key':'AQ=='}]}
        self.database = self.patch('db')
        self.database.get_all_profiles.return_value = {'test': self.profile}
        self.database.get_profile_by_node_num.side_effect = lambda n: self.profile if n == 42 else None
        self.patch('_storage_mesh_stores_for_packet', return_value=[])
        self.patch('_find_sender_node_for_packet', return_value=None)
        self.patch('_sender_public_key_for_local_packet', return_value=None)
        self.patch('_my_node_num', return_value=42)
        self.patch('_log_packet_summary')
        self.patch('_display_name_for_node_num', side_effect=lambda n: str(n))
        self.socket = self.patch('socketio')
        self.stream = UDPPacketStream('239.0.0.69', 4403)

    def patch(self, name, **kwargs):
        p = patch.object(self.module, name, **kwargs)
        self.addCleanup(p.stop)
        return p.start()

    def packet(self, sender, packet_id=123, port=portnums_pb2.PortNum.TEXT_MESSAGE_APP, destination=0xffffffff, encrypted=True):
        packet = mesh_pb2.MeshPacket(id=packet_id, to=destination, hop_limit=3, hop_start=3)
        setattr(packet, 'from', sender)
        data = mesh_pb2.Data(portnum=port)
        if port == portnums_pb2.PortNum.TEXT_MESSAGE_APP:
            data.payload = b'reply from radio'
            data.reply_id = 99
        elif port == portnums_pb2.PortNum.NODEINFO_APP:
            data.payload = mesh_pb2.User(id='!00000007', long_name='Radio', public_key=bytes(range(32))).SerializeToString()
        elif port == portnums_pb2.PortNum.TRACEROUTE_APP:
            data.payload = mesh_pb2.RouteDiscovery(route=[7], snr_towards=[20]).SerializeToString()
            data.request_id = 99
        if encrypted:
            packet.encrypted = encrypt_packet('MeshOregon', 'AQ==', packet, data)
        else:
            packet.channel = 15
            packet.decoded.CopyFrom(data)
        return packet

    def deliver(self, packet):
        self.stream._handle_datagram(packet.SerializeToString(), ('192.0.2.1', 4403))

    def test_two_senders_with_same_packet_id_both_reach_message_storage(self):
        self.deliver(self.packet(7))
        self.deliver(self.packet(8))
        self.assertEqual(self.database.store_message.call_count, 2)
        self.assertEqual([c.kwargs['sender_num'] for c in self.database.store_message.call_args_list], [7,8])

    def test_duplicate_datagrams_and_cleartext_topics_do_not_duplicate_messages(self):
        packet = self.packet(7, encrypted=False)
        self.deliver(packet)
        self.deliver(packet)
        self.database.store_message.assert_called_once()

    def test_encrypted_reply_retains_radio_reply_id_and_channel(self):
        self.deliver(self.packet(7))
        kwargs = self.database.store_message.call_args.kwargs
        self.assertEqual(kwargs['reply_packet_id'], 99)
        self.assertEqual(kwargs['channel'], 15)
        self.assertEqual(kwargs['content'], 'reply from radio')

    def test_encrypted_nodeinfo_response_is_decoded_without_a_cached_public_key(self):
        handler = self.patch('on_nodeinfo')
        self.deliver(self.packet(7, port=portnums_pb2.PortNum.NODEINFO_APP, destination=42))
        packet = handler.call_args.args[0]
        user = mesh_pb2.User.FromString(packet.decoded.payload)
        self.assertEqual(user.long_name, 'Radio')
        self.assertEqual(user.public_key, bytes(range(32)))

    def test_encrypted_traceroute_response_reaches_profile_socket_room(self):
        self.deliver(self.packet(7, port=portnums_pb2.PortNum.TRACEROUTE_APP, destination=42))
        events = [c for c in self.socket.emit.call_args_list if c.args[0] == 'traceroute_result']
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].kwargs['room'], 'profile_test')
        self.assertEqual(events[0].args[1]['request_id'], 99)

    def test_dedup_history_evicts_old_ids_and_stays_bounded(self):
        count = self.module._DEDUP_QUEUE.maxlen
        for n in range(count * 4):
            self.assertFalse(self.module._already_seen(('test', n)))
        self.assertEqual(len(self.module._DEDUP_CACHE), count)
        self.assertEqual(set(self.module._DEDUP_QUEUE), self.module._DEDUP_CACHE)
        self.assertFalse(self.module._already_seen(('test', 0)))

    def test_nodeinfo_ids_are_scoped_to_sender(self):
        self.patch('_storage_mesh_stores_for_packet', return_value=[(self.profile, Mock())])
        emit = self.patch('_emit_node_update')
        self.module.on_nodeinfo(self.packet(7, encrypted=False, port=portnums_pb2.PortNum.NODEINFO_APP))
        self.module.on_nodeinfo(self.packet(8, encrypted=False, port=portnums_pb2.PortNum.NODEINFO_APP))
        self.assertEqual(emit.call_count, 2)

    def test_traceroute_ids_are_scoped_to_sender(self):
        self.module.on_traceroute(self.packet(7, encrypted=False, port=portnums_pb2.PortNum.TRACEROUTE_APP, destination=42))
        self.module.on_traceroute(self.packet(8, encrypted=False, port=portnums_pb2.PortNum.TRACEROUTE_APP, destination=42))
        events = [c for c in self.socket.emit.call_args_list if c.args[0] == 'traceroute_result']
        self.assertEqual(len(events), 2)

    def test_listener_errors_are_reported_instead_of_silent(self):
        before = self.module._RECEIVE_COUNTS['listener_errors']
        self.module.on_receiver_error(RuntimeError('test receive failure'))
        self.assertEqual(self.module._RECEIVE_COUNTS['listener_errors'], before + 1)
        self.assertEqual(self.module._RECEIVE_LAST_ERROR, 'test receive failure')

    def test_diagnostics_separate_local_echoes_from_incoming_radio_packets(self):
        incoming_before = self.module._RECEIVE_COUNTS['inbound_packets']
        local_before = self.module._RECEIVE_COUNTS['local_echoes']
        self.deliver(self.packet(42, packet_id=321))
        self.deliver(self.packet(7, packet_id=322))
        self.assertEqual(self.module._RECEIVE_COUNTS['inbound_packets'], incoming_before + 1)
        self.assertEqual(self.module._RECEIVE_COUNTS['local_echoes'], local_before + 1)
