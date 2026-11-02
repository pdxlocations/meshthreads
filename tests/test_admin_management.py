"""Administrative editing against isolated databases and mocked radio/config files."""
import importlib
import os
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock
from werkzeug.security import generate_password_hash, check_password_hash
from database import Database
from administration import channel_revision


class AdminManagementTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.password = generate_password_hash('test-password')

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        with patch.dict(os.environ, {'FIREFLY_DATABASE_FILE':str(root/'initial.db'), 'FIREFLY_RUNTIME_DIR':str(root/'runtime')}), patch('mesh_runtime.SharedPacketReceiver.start'):
            self.module = importlib.import_module('app')
        self.db = Database(str(root/'test.db'))
        for user in ('admin','bob','other'):
            self.db.create_user(user,user,self.password)
        self.db.bootstrap_admin('admin')
        self.channels = [{'name':'Public','key':'AQ=='},{'name':'Private','key':'MDEyMzQ1Njc4OWFiY2RlZg=='}]
        self.db.create_profile('bob-radio','bob','!00000007','Bob radio','BOB',self.channels)
        self.radio = Mock(running=False)
        self.radio.get_active_profile.return_value = None
        self.config = Mock()
        for name, value in [('db',self.db),('profile_manager',self.module.ProfileManager(self.db)),('udp_server',self.radio),('ensure_profile_config',self.config)]:
            p=patch.object(self.module,name,value);p.start();self.addCleanup(p.stop)
        self.client = self.module.app.test_client()
        with self.client.session_transaction() as session:
            session['user_id']='admin';session['csrf_token']='csrf'
        self.headers = {'X-CSRF-Token':'csrf'}
        self.url = '/api/admin/profiles/bob-radio/channels/1'

    def revision(self):
        return channel_revision(self.db.get_profile('bob-radio')['channels'])

    def test_report_lists_rooms_and_key_sizes_without_psks(self):
        report = self.client.get('/api/admin/overview').json
        profile = next(u for u in report['users'] if u['id']=='bob')['profiles'][0]
        self.assertEqual(profile['channels'],[{'name':'Public','index':0,'key_bytes':1},{'name':'Private','index':1,'key_bytes':16}])
        self.assertEqual(profile['channel_revision'],self.revision())
        self.assertNotIn(self.channels[1]['key'],json.dumps(report))
        self.assertNotIn('password_hash',json.dumps(report))

    def test_user_edit_renames_and_resets_password_without_changing_role(self):
        response=self.client.put('/api/admin/users/bob',json={'username':'Robert','password':'replacement'},headers=self.headers)
        self.assertEqual(response.status_code,200)
        user=self.db.get_user_by_id('bob')
        self.assertEqual(user['username'],'Robert')
        self.assertTrue(check_password_hash(user['password_hash'],'replacement'))
        self.assertFalse(user['is_admin'])
        self.client.put('/api/admin/users/bob',json={'username':'Bob','password':''},headers=self.headers)
        self.assertEqual(self.db.get_user_by_id('bob')['password_hash'],user['password_hash'])

    def test_username_conflicts_and_invalid_payloads(self):
        url='/api/admin/users/bob'
        self.assertEqual(self.client.put(url,json={'username':'ADMIN'},headers=self.headers).status_code,409)
        for data in ([],{'username':''},{'username':'Bob','password':42}):
            self.assertEqual(self.client.put(url,json=data,headers=self.headers).status_code,400)
        self.assertEqual(self.db.get_user_by_id('bob')['username'],'bob')

    def test_all_mutations_enforce_csrf_and_current_admin(self):
        operations=[('put','/api/admin/users/bob',{'username':'Changed'}),('delete','/api/admin/users/bob',{}),
                    ('put',self.url,{'name':'Changed','revision':self.revision()}),('delete',self.url,{'revision':self.revision()})]
        for method,url,data in operations:
            self.assertEqual(getattr(self.client,method)(url,json=data).status_code,403)
        with self.client.session_transaction() as session:session['user_id']='other'
        for method,url,data in operations:
            self.assertEqual(getattr(self.client,method)(url,json=data,headers=self.headers).status_code,403)
        self.assertEqual(self.db.admin_edit_user('other','bob','Changed'),'forbidden')
        self.assertEqual(self.db.admin_delete_user('other','bob'),'forbidden')
        self.assertEqual(self.db.admin_change_channel('other','bob-radio',1,self.revision()),'forbidden')

    def test_channel_rename_keeps_key_and_replacement_key_is_validated(self):
        response=self.client.put(self.url,json={'name':'Renamed','key':'','revision':self.revision()},headers=self.headers)
        self.assertEqual(response.status_code,200)
        channels=self.db.get_profile('bob-radio')['channels']
        self.assertEqual(channels[1],{'name':'Renamed','key':self.channels[1]['key']})
        self.config.assert_called_once()
        response=self.client.put(self.url,json={'name':'Renamed','key':'bad','revision':self.revision()},headers=self.headers)
        self.assertEqual(response.status_code,400)
        self.assertEqual(self.db.get_profile('bob-radio')['channels'],channels)
        response=self.client.put(self.url,json={'name':'Renamed','key':'Ag==','revision':self.revision()},headers=self.headers)
        self.assertEqual(response.status_code,200)
        self.assertEqual(self.db.get_profile('bob-radio')['channels'][1]['key'],'Ag==')

    def test_stale_edits_and_duplicate_rooms_rejected(self):
        revision=self.revision()
        self.assertEqual(self.client.put(self.url,json={'name':'Public','key':'AQ==','revision':revision},headers=self.headers).status_code,409)
        self.client.put(self.url,json={'name':'New','revision':revision},headers=self.headers)
        self.assertEqual(self.client.delete(self.url,json={'revision':revision},headers=self.headers).status_code,409)
        self.assertEqual(len(self.db.get_profile('bob-radio')['channels']),2)

    def test_channel_delete_keeps_other_profiles_and_message_history_and_last_channel(self):
        self.db.create_profile('other-radio','other','!00000008','Other radio','OTHR',self.channels)
        self.db.store_message('history',content='Saved',channel=42)
        self.assertEqual(self.client.delete(self.url,json={'revision':self.revision()},headers=self.headers).status_code,200)
        self.assertEqual(len(self.db.get_profile('other-radio')['channels']),2)
        self.assertEqual(len(self.db.get_messages_for_channel(42)),1)
        self.assertEqual(self.client.delete('/api/admin/profiles/bob-radio/channels/0',json={'revision':self.revision()},headers=self.headers).status_code,409)

    def test_radio_profile_cannot_be_changed_or_its_user_deleted(self):
        self.radio.running=True;self.radio.get_active_profile.return_value={'id':'bob-radio'}
        self.assertEqual(self.client.delete(self.url,json={'revision':self.revision()},headers=self.headers).status_code,409)
        self.assertEqual(self.client.delete('/api/admin/users/bob',json={},headers=self.headers).status_code,409)
        self.assertIsNotNone(self.db.get_user_by_id('bob'))

    def test_user_delete_cascades_private_data_but_keeps_shared_history(self):
        self.db.start_web_session('bob-session','bob','bob-radio')
        self.db.store_message('dm',message_type='dm',owner_profile_id='bob-radio',content='Private',channel=42)
        self.db.store_message('room',message_type='channel',owner_profile_id='bob-radio',content='Shared',channel=42)
        self.assertEqual(self.client.delete('/api/admin/users/bob',json={},headers=self.headers).status_code,200)
        self.assertIsNone(self.db.get_user_by_id('bob'))
        self.assertIsNone(self.db.get_profile('bob-radio'))
        self.assertEqual(len(self.db.get_messages_for_channel(42)),1)
        self.assertEqual(self.db.get_dm_messages_for_profile('bob-radio'),[])
        self.assertEqual(self.client.delete('/api/admin/users/admin',json={},headers=self.headers).status_code,409)
        self.assertTrue(self.db.get_user_by_id('admin')['is_admin'])

    def test_deleted_user_socket_is_disconnected_and_next_request_is_unauthenticated(self):
        client=self.module.app.test_client()
        with client.session_transaction() as session: session['user_id']='bob';session['csrf_token']='bobcsrf'
        socket=self.module.socketio.test_client(self.module.app,flask_test_client=client)
        self.addCleanup(lambda: socket.disconnect() if socket.is_connected() else None)
        self.assertTrue(socket.is_connected())
        self.assertEqual(self.client.delete('/api/admin/users/bob',json={},headers=self.headers).status_code,200)
        self.assertFalse(socket.is_connected())
        self.assertEqual(client.get('/api/profiles').status_code,401)
