import importlib
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from werkzeug.security import generate_password_hash
from database import Database


class LoginProfileTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.password_hash = generate_password_hash('test-password')

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        with patch.dict(os.environ, {'FIREFLY_DATABASE_FILE':str(root/'initial.db'),'FIREFLY_RUNTIME_DIR':str(root/'runtime')}), patch('mesh_runtime.SharedPacketReceiver.start'):
            self.module = importlib.import_module('app')
        self.db = Database(str(root/'login.db'))
        for name in ['alice','bob']:
            self.db.create_user(name,name,self.password_hash)
        for name,value in [('db',self.db),('profile_manager',self.module.ProfileManager(self.db))]:
            p=patch.object(self.module,name,value);p.start();self.addCleanup(p.stop)
        p=patch.object(self.module,'_unregister_current_session_transport');p.start();self.addCleanup(p.stop)
        self.client=self.module.app.test_client()
        with self.client.session_transaction() as session: session['csrf_token']='test-csrf'
        self.profile('bob-node','bob','!00000008')

    def profile(self, profile_id='only', user='alice', node='!00000007'):
        self.assertTrue(self.db.create_profile(profile_id,user,node,profile_id,'TEST',[{'name':'First','key':'AQ=='},{'name':'Second','key':'Ag=='}]))

    def login(self, async_request=False, password='test-password'):
        return self.client.post('/login',data={'username':'alice','password':password,'csrf_token':'test-csrf'},headers={'X-Requested-With':'fetch'} if async_request else {})

    def test_one_owned_profile_is_activated_and_first_channel_opened(self):
        self.profile()
        response=self.login()
        self.assertEqual(response.status_code,302)
        self.assertEqual(response.location,'/?channel=0')
        with self.client.session_transaction() as session:
            self.assertEqual(session['current_profile']['id'],'only')
            self.assertEqual(session['current_channel_index'],0)

    def test_async_login_has_same_single_profile_behavior(self):
        self.profile()
        self.assertEqual(self.login(True).json,{'redirect_url':'/?channel=0'})
        with self.client.session_transaction() as session: self.assertEqual(session['current_profile']['id'],'only')

    def test_zero_or_multiple_profiles_open_profiles_without_activation(self):
        self.assertEqual(self.login(True).json,{'redirect_url':'/?open_profiles=1'})
        self.profile()
        self.profile('second','alice','!00000009')
        self.assertEqual(self.login(True).json,{'redirect_url':'/?open_profiles=1'})
        with self.client.session_transaction() as session: self.assertNotIn('current_profile',session)

    def test_bad_password_does_not_activate_profile(self):
        self.profile()
        self.assertEqual(self.login(True,password='incorrect').status_code,401)
        with self.client.session_transaction() as session:
            self.assertNotIn('current_profile',session)
            self.assertNotIn('user_id',session)
