import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import mesh_runtime as mesh


class NodeTelemetryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        env = patch.dict(os.environ, {'FIREFLY_RUNTIME_DIR': str(Path(self.tmp.name)/'runtime'), 'FIREFLY_DATABASE_FILE': str(Path(self.tmp.name)/'test.db')})
        env.start(); self.addCleanup(env.stop)
        self.profile = {'id':'p', 'node_id':'!0000002a', 'channels':[{'name':'MeshOregon', 'key':'AQ=='}, {'name':'Private', 'key':'Ag=='}]}
        self.store = mesh.MeshNodeStore(self.profile)

    def save(self, channel, timestamp, values):
        tdb = mesh.meshdb.TelemetryDB(self.store.owner_node_num, self.store.db_path, channel=channel, channel_name=self.store._channel_name_for(channel), storage_name=self.store._storage_name_for(channel))
        tdb.save_packet({'from':7, 'channel':channel, 'decoded':{'telemetry':{'time':timestamp, **values}}})

    def test_latest_per_category_is_merged_across_channels_and_preserves_zero(self):
        first, second = self.store.channel_nums
        self.save(first, 1000, {'deviceMetrics': {'batteryLevel':0, 'voltage':3.5, 'channelUtilization':0, 'airUtilTx':0, 'uptimeSeconds':60}})
        self.save(second, 1100, {'environmentMetrics': {'temperature':0, 'relativeHumidity':50}})
        result = self.store.get_latest_telemetry(7)
        self.assertEqual(result['device']['values']['battery_level'], 0)
        self.assertEqual(result['device']['values']['channel_utilization'], 0)
        self.assertEqual(result['environment']['values']['temperature'], 0)
        self.save(second, 1200, {'deviceMetrics': {'batteryLevel':75, 'voltage':4.0}})
        result = self.store.get_latest_telemetry(7)
        self.assertEqual(result['device']['timestamp'], 1200)
        self.assertEqual(result['device']['values']['battery_level'], 75)
        self.assertNotIn('payload', result['device']['values'])
        self.assertEqual(self.store.get_latest_telemetry(8), {})

    def test_missing_telemetry_tables_are_an_empty_result(self):
        self.assertEqual(self.store.get_latest_telemetry(7), {})

    def test_unconfigured_channel_is_not_exposed(self):
        self.save(201, 1300, {'deviceMetrics': {'batteryLevel':99}})
        self.assertEqual(self.store.get_latest_telemetry(7), {})
