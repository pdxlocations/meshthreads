import base64
import unittest
from flask import Flask
from rooms import public_channels_from_profiles, register_room_routes
from unittest.mock import Mock


class PublicChannels(unittest.TestCase):
    def test_filters_private_keys_and_metadata_deduplicates_and_normalizes(self):
        profiles = {
            'alice': {'user_id':'alice', 'channels':[
                {'name':'MeshOregon','key':'AQ=='}, {'name':'Private','key':base64.b64encode(bytes(32)).decode()},
                {'name':'Other private','key':base64.b64encode(bytes(16)).decode()},
                {'name':'Bad','key':'invalid'}, {'name':'Alt','key':'_w=='},
            ]},
            'bob': {'channels':[{'name':'MeshOregon','key':'AQ=='},{'name':'MeshOregon','key':'Ag=='}]},
            'legacy': {'channel':'LongFast','key':'AQ=='},
        }
        self.assertEqual(public_channels_from_profiles(profiles), [
            {'name':'Alt','key':'/w=='}, {'name':'LongFast','key':'AQ=='},
            {'name':'MeshOregon','key':'AQ=='}, {'name':'MeshOregon','key':'Ag=='},
        ])

    def test_route_requires_login_and_works_without_active_profile(self):
        app=Flask(__name__)
        allowed=False
        def login_required(fn):
            def guarded(*args,**kwargs):
                if not allowed: return {'error':'Sign in'},401
                return fn(*args,**kwargs)
            guarded.__name__=fn.__name__
            return guarded
        manager=Mock()
        manager.get_all_profiles.return_value={'other-user':{'channel':'Local','key':'AQ=='}}
        register_room_routes({'app':app,'login_required':login_required,'profile_manager':manager})
        client=app.test_client()
        self.assertEqual(client.get('/api/rooms/public-channels').status_code,401)
        manager.get_all_profiles.assert_not_called()
        allowed=True
        self.assertEqual(client.get('/api/rooms/public-channels').json,{'channels':[{'name':'Local','key':'AQ=='}]})
        manager.get_all_profiles.assert_called_once_with()
