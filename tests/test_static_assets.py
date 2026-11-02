"""Rendered pages, offline cache, and font URLs must resolve after asset cleanup."""
import importlib
import json
import os
from pathlib import Path
import re
import tempfile
import unittest
from html.parser import HTMLParser
from unittest.mock import patch
from database import Database

ROOT = Path(__file__).resolve().parents[1]


class PageAssets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.assets = []
        self.ids = []
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get('id'):
            self.ids.append(attrs['id'])
        for name in ('src','href'):
            if attrs.get(name, '').startswith('/static/'):
                self.assets.append(attrs[name].split('?',1)[0])


class StaticAssetTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        env = patch.dict(os.environ, {'FIREFLY_DATABASE_FILE':str(root/'initial.db'), 'FIREFLY_RUNTIME_DIR':str(root/'runtime')})
        env.start(); self.addCleanup(env.stop)
        with patch('mesh_runtime.SharedPacketReceiver.start'):
            self.module = importlib.import_module('app')
        self.db = Database(str(root/'assets.db'))
        for name,value in [('db',self.db),('profile_manager',self.module.ProfileManager(self.db))]:
            patcher=patch.object(self.module,name,value);patcher.start();self.addCleanup(patcher.stop)
        self.client=self.module.app.test_client()

    def assert_assets(self, html):
        parser=PageAssets();parser.feed(html)
        self.assertEqual(len(parser.ids),len(set(parser.ids)), 'Duplicate HTML IDs')
        for asset in parser.assets:
            self.assertTrue((ROOT/asset.lstrip('/')).is_file(),asset)
        self.assertEqual(parser.assets.count('/static/css/board.css'),1)
        return parser

    def test_auth_board_and_admin_assets_resolve_without_legacy_controls(self):
        self.assert_assets(self.client.get('/').get_data(as_text=True))
        self.db.create_user('demo','demo','unused')
        self.db.bootstrap_admin('demo')
        self.db.create_profile('p','demo','!00000007','Demo','DEMO',[{'name':'Room','key':'AQ=='}])
        with self.client.session_transaction() as session:
            session['user_id']='demo'
            session['current_profile']=self.db.get_profile('p')
        for url in ['/', '/admin']:
            response=self.client.get(url)
            self.assertEqual(response.status_code,200)
            parser=self.assert_assets(response.get_data(as_text=True))
            for unused in ['mobileSettingsSheet','profileSelect','setProfileBtn','chatTabBar','mobileConnectBtn','desktopConnectBtn']:
                self.assertNotIn(unused,parser.ids)
        self.assertIn('boardConnectionState',self.assert_assets(self.client.get('/').get_data(as_text=True)).ids)
        # Startup bindings must not refer to the hidden controls removed in cleanup.
        source=(ROOT/'templates/index.html').read_text()
        bound_ids=re.findall(r"document\.getElementById\('([^']+)'\)\.addEventListener",source)
        parser=self.assert_assets(self.client.get('/').get_data(as_text=True))
        for element_id in bound_ids:
            self.assertIn(element_id,parser.ids,element_id)

    def test_cache_manifest_and_css_references_exist(self):
        worker=(ROOT/'static/service-worker.js').read_text()
        for asset in re.findall(r'"(/static/[^"\n]+)"',worker):
            self.assertTrue((ROOT/asset.lstrip('/')).is_file(),asset)
        manifest=json.loads((ROOT/'static/manifest.json').read_text())
        for icon in manifest['icons']:
            self.assertTrue((ROOT/icon['src'].lstrip('/')).is_file(),icon['src'])
        for css in (ROOT/'static/css').glob('*.css'):
            for url in re.findall(r'url\([\'\"]?([^\)\'\"]+)',css.read_text()):
                if not url.startswith(('data:','http:','https:')):
                    self.assertTrue((css.parent/url).resolve().is_file(),url)
