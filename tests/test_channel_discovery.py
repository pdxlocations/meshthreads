"""Only real external reception qualifies a public channel; hashes are not proof."""
import tempfile
import unittest
from pathlib import Path
from flask import Flask
from database import Database
from rooms import register_room_routes
from channel_discovery import verified_public_channels, public_channel_fingerprint
from encryption import generate_hash
from mudp.encryption import encrypt_packet
from meshtastic.protobuf import mesh_pb2, portnums_pb2
from unittest.mock import Mock


class ChannelDiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.path=str(Path(self.tmp.name)/'test.db');self.db=Database(self.path)
        self.db.create_user('u','u','hash')
        self.channel={'name':'MeshOregon','key':'AQ=='}
        # A wrong key with a deliberately colliding one-byte channel hash.
        self.wrong=next({'name':'Bad'+chr(c),'key':'Ag=='} for c in range(33,127)
                        if generate_hash('Bad'+chr(c),'Ag==')==generate_hash('MeshOregon','AQ=='))
        self.db.create_profile('p','u','!0000002a','Local','LOC',[self.channel,self.wrong,{'name':'Untested','key':'AQ=='}])
        self.profiles=self.db.get_all_profiles()

    def packet(self,sender=7,port=portnums_pb2.PortNum.NODEINFO_APP):
        packet=mesh_pb2.MeshPacket(id=123,to=0xffffffff)
        setattr(packet,'from',sender)
        data=mesh_pb2.Data(portnum=port,payload=mesh_pb2.User(id='!00000007',long_name='External').SerializeToString())
        packet.encrypted=encrypt_packet(self.channel['name'],self.channel['key'],packet,data)
        return packet

    def receive(self,packet):
        channels=verified_public_channels(packet,self.profiles)
        self.db.record_public_channel_receipts(channels,int(getattr(packet,'from')),packet.id)
        return channels

    def test_meshoregon_and_local_one_byte_keys_both_qualify_independently(self):
        local = {'name':'Local','key':'BQ=='}
        self.db.update_profile('p','u','!0000002a','Local','LOC',[self.channel,local])
        self.profiles = self.db.get_all_profiles()
        self.receive(self.packet())
        self.assertNotIn(public_channel_fingerprint(local), self.db.get_verified_public_channel_fingerprints())
        packet = mesh_pb2.MeshPacket(id=124,to=0xffffffff)
        setattr(packet,'from',8)
        data = mesh_pb2.Data(portnum=portnums_pb2.PortNum.TEXT_MESSAGE_APP,payload=b'External Local traffic')
        packet.encrypted = encrypt_packet(local['name'],local['key'],packet,data)
        self.assertEqual(packet.channel,75)
        self.assertEqual(self.receive(packet),[local])
        self.assertEqual(self.db.get_verified_public_channel_fingerprints(),
                         {public_channel_fingerprint(self.channel),public_channel_fingerprint(local)})
        app = Flask(__name__)
        manager = Mock();manager.get_all_profiles.side_effect = self.db.get_all_profiles
        register_room_routes({'app':app,'login_required':lambda f:f,'profile_manager':manager,'db':self.db})
        self.assertEqual(app.test_client().get('/api/rooms/public-channels').json,
                         {'channels':[local,self.channel]})

    def test_only_exact_key_that_decoded_packet_is_verified_despite_hash_collision(self):
        packet=self.packet()
        self.assertEqual(generate_hash(self.wrong['name'],self.wrong['key']),packet.channel)
        self.assertEqual(self.receive(packet),[self.channel])
        self.assertEqual(self.db.get_verified_public_channel_fingerprints(),{public_channel_fingerprint(self.channel)})
        self.assertEqual(Database(self.path).get_verified_public_channel_fingerprints(),self.db.get_verified_public_channel_fingerprints())

    def test_local_echo_and_bad_packets_never_qualify(self):
        self.assertEqual(self.receive(self.packet(sender=42)),[])
        packet=self.packet();packet.encrypted=b'not a valid ciphertext'
        self.assertEqual(self.receive(packet),[])
        for sender in (0,0xffffffff): self.assertEqual(self.receive(self.packet(sender=sender)),[])
        self.assertEqual(self.db.get_verified_public_channel_fingerprints(),set())

    def test_pki_and_cleartext_do_not_prove_a_nonzero_psk(self):
        packet=self.packet();packet.pki_encrypted=True
        self.assertEqual(self.receive(packet),[])
        packet=self.packet();packet.decoded.CopyFrom(mesh_pb2.Data(portnum=1,payload=b'plaintext'))
        self.assertEqual(self.receive(packet),[])

    def test_all_registered_local_nodes_are_excluded_not_just_active_one(self):
        self.db.create_profile('other','u','!00000007','Other','OTH',[self.channel])
        self.profiles=self.db.get_all_profiles()
        self.assertEqual(self.receive(self.packet()),[])
        self.db.record_public_channel_receipts([self.channel],7,123)
        self.assertEqual(self.db.get_verified_public_channel_fingerprints(),set())

    def test_saved_channel_or_old_message_alone_does_not_qualify(self):
        self.db.store_message('legacy',sender_num=7,content='Legacy message',direction='received',channel=generate_hash(self.channel['name'],self.channel['key']))
        app=Flask(__name__)
        manager=Mock();manager.get_all_profiles.side_effect=self.db.get_all_profiles
        register_room_routes({'app':app,'login_required':lambda f:f,'profile_manager':manager,'db':self.db})
        client=app.test_client()
        self.assertEqual(client.get('/api/rooms/public-channels').json,{'channels':[]})
        self.receive(self.packet())
        self.assertEqual(client.get('/api/rooms/public-channels').json,{'channels':[self.channel]})

    def test_new_name_or_key_does_not_inherit_old_evidence(self):
        self.receive(self.packet())
        proof=self.db.get_verified_public_channel_fingerprints()
        self.assertNotIn(public_channel_fingerprint({'name':'Typo','key':'AQ=='}),proof)
        self.assertNotIn(public_channel_fingerprint({'name':'MeshOregon','key':'Aw=='}),proof)
