"""Role, privacy, session, and dashboard regressions using isolated databases."""
import importlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from werkzeug.security import generate_password_hash
from database import Database


class AdministrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = str(Path(self.tmp.name) / 'admin.db')
        self.db = Database(self.path)
        for name in ('alice', 'bob'):
            self.db.create_user(name, name, 'secret-password-hash')

    def test_first_successful_signin_claims_initial_admin_only_once(self):
        self.db.bootstrap_admin('bob')
        self.db.bootstrap_admin('alice')
        self.assertTrue(self.db.get_user_by_id('bob')['is_admin'])
        self.assertFalse(self.db.get_user_by_id('alice')['is_admin'])
        Database(self.path).bootstrap_admin('alice')
        self.assertFalse(self.db.get_user_by_id('alice')['is_admin'])

    def test_existing_install_assigns_oldest_account(self):
        path = str(Path(self.tmp.name) / 'legacy.db')
        with sqlite3.connect(path) as conn:
            conn.execute('CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT,password_hash TEXT,created_at TEXT)')
            conn.execute("INSERT INTO users VALUES('old','old','hash','2025-01-01')")
            conn.execute("INSERT INTO users VALUES('new','new','hash','2026-01-01')")
        db = Database(path)
        db.bootstrap_admin('new')
        self.assertTrue(db.get_user_by_id('old')['is_admin'])
        self.assertFalse(db.get_user_by_id('new')['is_admin'])

    def test_roles_require_admin_and_preserve_last_admin(self):
        self.db.bootstrap_admin('alice')
        self.assertEqual(self.db.set_user_admin('bob', 'bob', True), 'forbidden')
        self.assertEqual(self.db.set_user_admin('alice', 'alice', False), 'last_admin')
        self.assertEqual(self.db.set_user_admin('alice', 'missing', True), 'missing')
        self.assertEqual(self.db.set_user_admin('alice', 'bob', True), 'ok')
        self.assertEqual(self.db.set_user_admin('bob', 'alice', False), 'ok')
        self.assertFalse(self.db.delete_user('bob'))

    def test_concurrent_demotions_cannot_remove_all_admins(self):
        self.db.bootstrap_admin('alice')
        self.db.set_user_admin('alice', 'bob', True)
        with ThreadPoolExecutor(2) as pool:
            results = list(pool.map(lambda user: self.db.set_user_admin(user, user, False), ('alice','bob')))
        self.assertCountEqual(results, ['ok','last_admin'])

    def test_session_heartbeat_logout_idle_and_capped_time(self):
        self.db.start_web_session('session', 'alice', now=1000)
        self.db.touch_web_session('session','alice', 'profile', now=1030)
        user = self.db.admin_overview(now=1040)['users'][0]
        self.assertEqual(user['active_sessions'],1)
        self.assertEqual(user['online_seconds'],30)
        self.assertEqual(user['sessions'][0]['profile_id'],'profile')
        self.assertEqual(self.db.admin_overview(now=1200)['users'][0]['active_sessions'],0)
        self.db.touch_web_session('session','alice',end=True,now=2000)
        user = self.db.admin_overview(now=2000)['users'][0]
        self.assertEqual(user['online_seconds'],120)
        self.assertEqual(user['active_sessions'],0)
        self.assertFalse(self.db.touch_web_session('session','alice',now=2010))
        self.assertFalse(self.db.touch_web_session('session','bob',now=2010))

    def test_report_whitelists_profile_data_and_counts_stored_messages(self):
        self.db.create_profile('p','alice','!00000007','Alice radio','ALIC',[{'name':'Room','key':'AQ=='}])
        from encryption import generate_hash
        channel = generate_hash('Room','AQ==')
        self.db.store_message('rx',sender_num=8,sender_display='Radio',content='private body',direction='received',channel=channel)
        self.db.store_message('tx',sender_num=7,sender_display='Alice radio',content='private body',direction='sent',channel=channel)
        self.db.store_message('dm-other',sender_num=8,sender_display='Radio',content='private body',direction='received',message_type='dm',owner_profile_id='other',channel=channel)
        report = self.db.admin_overview()
        profile = report['users'][0]['profiles'][0]
        self.assertEqual((profile['messages_in'],profile['messages_out']), (1,1))
        self.assertEqual(report['totals']['messages_in'],2)
        text = json.dumps(report)
        for secret in ('secret-password-hash','private body','AQ==','password_hash','session_id'):
            self.assertNotIn(secret,text)


class AdminApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.password = generate_password_hash('test-password')

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root=Path(self.tmp.name)
        with patch.dict(os.environ, {'FIREFLY_DATABASE_FILE':str(root/'initial.db'),'FIREFLY_RUNTIME_DIR':str(root/'runtime')}), patch('mesh_runtime.SharedPacketReceiver.start'):
            self.module=importlib.import_module('app')
        self.db=Database(str(root/'api.db'))
        for user in ('alice','bob'): self.db.create_user(user,user,self.password)
        for name,value in [('db',self.db),('profile_manager',self.module.ProfileManager(self.db))]:
            patcher=patch.object(self.module,name,value);patcher.start();self.addCleanup(patcher.stop)
        self.client=self.module.app.test_client()
        with self.client.session_transaction() as session: session['csrf_token']='csrf'

    def login(self, user='alice', password='test-password'):
        return self.client.post('/login',data={'username':user,'password':password,'csrf_token':'csrf'})

    def test_failed_login_cannot_claim_admin(self):
        self.login(password='wrong')
        self.assertFalse(self.db.get_user_by_id('alice')['is_admin'])
        self.assertEqual(self.client.get('/api/admin/overview').status_code,401)

    def test_admin_page_menu_and_guarded_role_api(self):
        self.login()
        self.assertEqual(self.client.get('/admin').status_code,200)
        self.assertIn(b'id="adminMenuLink"',self.client.get('/').data)
        overview=self.client.get('/api/admin/overview')
        self.assertEqual(overview.status_code,200)
        self.assertIn('no-store',overview.headers['Cache-Control'])
        self.assertEqual(overview.json['totals']['active_sessions'],1)
        url='/api/admin/users/bob/admin'
        self.assertEqual(self.client.put(url,json={'is_admin':True}).status_code,403)
        self.assertEqual(self.client.put(url,json={'is_admin':'true'},headers={'X-CSRF-Token':'csrf'}).status_code,400)
        self.assertEqual(self.client.put(url,json={'is_admin':True},headers={'X-CSRF-Token':'csrf'}).status_code,200)
        self.assertTrue(self.db.get_user_by_id('bob')['is_admin'])
        self.db.set_user_admin('bob','alice',False)
        self.assertEqual(self.client.get('/admin').status_code,403)
        self.assertEqual(self.client.get('/api/admin/overview').status_code,403)
        self.assertEqual(self.client.put(url,json={'is_admin':False},headers={'X-CSRF-Token':'csrf'}).status_code,403)
        self.assertNotIn(b'id="adminMenuLink"',self.client.get('/').data)

    def test_logout_ends_tracked_session(self):
        self.login()
        self.client.post('/api/session-heartbeat',headers={'X-CSRF-Token':'csrf'})
        self.client.post('/logout',data={'csrf_token':'csrf'})
        user=self.db.admin_overview()['users'][0]
        self.assertEqual(user['active_sessions'],0)
        self.assertIsNotNone(user['sessions'][0]['ended_at'])
        self.assertEqual(self.client.get('/api/admin/overview').status_code,401)

    def test_login_immediately_records_automatically_activated_profile(self):
        self.db.create_profile('only','alice','!00000007','Alice radio','ALIC',[{'name':'Room','key':'AQ=='}])
        self.login()
        user = self.db.admin_overview()['users'][0]
        self.assertEqual(user['sessions'][0]['profile_id'], 'only')
