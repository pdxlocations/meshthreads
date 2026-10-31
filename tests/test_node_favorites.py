import importlib
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from database import Database


class NodeFavoritesTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        with patch.dict(os.environ, {'FIREFLY_DATABASE_FILE':str(root/'test.db'), 'FIREFLY_RUNTIME_DIR':str(root/'runtime')}), patch('mesh_runtime.SharedPacketReceiver.start'):
            self.module = importlib.import_module('app')
        self.db = Database(str(root/'favorites.db'))
        self.db.create_user('alice','alice','unused')
        self.db.create_user('bob','bob','unused')
        p = patch.object(self.module, 'db', self.db)
        p.start()
        self.addCleanup(p.stop)
        self.client = self.module.app.test_client()
        self.headers = {'X-CSRF-Token':'token'}
        self.login('alice')

    def login(self, user):
        with self.client.session_transaction() as session:
            session['user_id'] = user
            session['csrf_token'] = 'token'

    def star(self, node=7, favorite=True, headers=None):
        return self.client.put(f'/api/nodes/{node}/favorite', json={'favorite':favorite}, headers=self.headers if headers is None else headers)

    def test_star_is_persistent_and_idempotent(self):
        for _ in range(2):
            self.assertEqual(self.star().status_code, 200)
        self.assertEqual(Database(self.db.db_path).get_node_favorites('alice'), [7])
        self.assertEqual(self.client.get('/api/node-favorites').json, {'node_nums':[7]})

    def test_unstar_removes_only_selected_node(self):
        self.star(7)
        self.star(8)
        self.star(7, False)
        self.assertEqual(self.db.get_node_favorites('alice'), [8])

    def test_accounts_have_separate_favorites(self):
        self.star(7)
        self.login('bob')
        self.assertEqual(self.client.get('/api/node-favorites').json['node_nums'], [])
        self.star(8)
        self.assertEqual(self.db.get_node_favorites('alice'), [7])
        self.assertEqual(self.db.get_node_favorites('bob'), [8])

    def test_authentication_and_csrf_are_required(self):
        anonymous = self.module.app.test_client()
        self.assertEqual(anonymous.get('/api/node-favorites').status_code, 401)
        self.assertEqual(self.star(headers={}).status_code, 403)
        self.assertEqual(self.db.get_node_favorites('alice'), [])

    def test_invalid_values_are_rejected(self):
        for favorite in ('true',1,None):
            self.assertEqual(self.star(favorite=favorite).status_code, 400)
        for node in (0,0xffffffff,0x100000000):
            self.assertEqual(self.star(node).status_code, 400)

    def test_account_deletion_cleans_up_favorites(self):
        self.star(7)
        self.assertTrue(self.db.delete_user('alice'))
        self.assertEqual(self.db.get_node_favorites('alice'), [])
