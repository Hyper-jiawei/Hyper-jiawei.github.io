import base64
import http.client
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'publisher.py'
spec = importlib.util.spec_from_file_location('gallery_publisher', SCRIPT)
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)

class FakeGitHub:
    repository = 'Hyper-jiawei/Hyper-jiawei.github.io'
    def __init__(self, remote=None, concurrent=False):
        self.remote = remote or {}
        self.calls = []
        self.heads = 0
        self.concurrent = concurrent
    def head(self, branch):
        self.heads += 1
        return 'someone-else' if self.concurrent and self.heads > 1 else 'original-head'
    def tree(self, sha):
        return 'original-tree', self.remote
    def repo(self, method, path, payload=None):
        self.calls.append((method, path, payload))
        if path == '/git/blobs':
            return {'sha': p.blob_sha(base64.b64decode(payload['content']))}
        if path == '/git/trees':
            return {'sha': 'new-tree'}
        if path == '/git/commits':
            return {'sha': 'new-commit'}
        if method == 'PATCH':
            return {'object': {'sha': 'new-commit'}}
        raise AssertionError(path)

def generated(files, **overrides):
    values = dict(title='测试专辑', date='2026-10-23', photos=[dict(file=name, description='', featured=False, cover=i == 0) for i, name in enumerate(files)])
    values.update(overrides)
    return p.worker('generate', **values)['config']

class FolderAndConfigTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name) / '2026-10-23-iPhoneDuo'
        self.folder.mkdir()
        (self.folder / '中文 照片.HEIC').write_bytes(b'original phone bytes')
    def test_defaults_omit_featured_and_leave_descriptions_empty(self):
        config = generated(['中文 照片.HEIC'])
        self.assertNotIn('featured:', config)
        parsed = p.worker('parse', config=config, files=['中文 照片.HEIC'])
        self.assertEqual(parsed['errors'], [])
        self.assertEqual(parsed['data']['description'], '')
        self.assertEqual(parsed['data']['resources'][0]['params'], dict(cover=True, description=''))
    def test_only_checked_photos_get_featured(self):
        config = generated(['a.jpg', 'b.jpg'], photos=[dict(file='a.jpg', featured=True), dict(file='b.jpg', featured=False)])
        data = p.worker('parse', config=config, files=['a.jpg', 'b.jpg'])['data']
        self.assertIs(data['resources'][0]['params']['featured'], True)
        self.assertNotIn('featured', data['resources'][1]['params'])
    def test_multiline_quotes_unicode_and_unknown_album_options_survive(self):
        story = '她说：“雨夜”。\n下一行\\路灯'
        config = generated(['中文 照片.HEIC'], description=story, metadata={'layout': 'actual', 'size': '7in'})
        data = p.worker('parse', config=config, files=['中文 照片.HEIC'])['data']
        self.assertEqual(data['description'], story)
        self.assertEqual(data['layout'], 'actual')
        self.assertEqual(data['size'], '7in')
    def test_save_is_atomic_and_protects_external_changes(self):
        config = generated(['中文 照片.HEIC'])
        first_hash = p.save_config(self.folder, config, None)
        self.assertEqual(first_hash, p.digest((self.folder / 'index.md').read_bytes()))
        (self.folder / 'index.md').write_text(config + '\n手动编辑\n')
        with self.assertRaisesRegex(p.PublisherError, '其他编辑器'):
            p.save_config(self.folder, config, first_hash)
        self.assertIn('手动编辑', (self.folder / 'index.md').read_text())
    def test_wrong_filename_and_invalid_date_are_rejected_before_saving(self):
        for config in [generated(['不存在.JPG']), generated(['中文 照片.HEIC'], date='2026-20-23')]:
            with self.assertRaises(p.PublisherError):
                p.save_config(self.folder, config, None)
        self.assertFalse((self.folder / 'index.md').exists())
    def test_duplicate_titles_and_symlinks_are_rejected(self):
        (self.folder / '中文 照片.JPG').write_bytes(b'x')
        with self.assertRaisesRegex(p.PublisherError, '标题重复'):
            p.inspect_folder(self.folder)
        (self.folder / '中文 照片.JPG').unlink()
        (self.folder / 'linked.JPG').symlink_to(self.folder / '中文 照片.HEIC')
        with self.assertRaisesRegex(p.PublisherError, '普通文件'):
            p.inspect_folder(self.folder)
    def test_real_heic_preview_is_jpeg_and_does_not_change_original(self):
        fixture = p.ROOT / 'gallery/site/scripts/fixtures/phone.heic'
        original = fixture.read_bytes()
        preview = p.worker('preview', file=str(fixture))
        self.assertTrue(preview.startswith(b'\xff\xd8'))
        self.assertEqual(fixture.read_bytes(), original)

class PublishingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        (self.folder / '作品.HEIC').write_bytes(b'original photo bytes')
        (self.folder / 'index.md').write_text(generated(['作品.HEIC']))
        self.prefix = 'gallery/content/2026-10-23-iPhoneDuo/'
    def publish(self, client, update=False):
        return p.publish_album(client, 'main', self.folder, '2026-10-23-iPhoneDuo', update, lambda *args: None)
    def test_new_album_is_one_atomic_commit_and_does_not_touch_other_content(self):
        remote = {'gallery/content/other/a.jpg': dict(type='blob', sha='old'), 'src/content/posts/post.md': dict(type='blob', sha='article')}
        client = FakeGitHub(remote)
        result = self.publish(client)
        tree = next(payload for method, path, payload in client.calls if path == '/git/trees')
        self.assertEqual(tree['base_tree'], 'original-tree')
        self.assertEqual({e['path'] for e in tree['tree']}, {self.prefix + '作品.HEIC', self.prefix + 'index.md'})
        commit = next(payload for method, path, payload in client.calls if path == '/git/commits')
        self.assertEqual(commit['parents'], ['original-head'])
        patch_call = next(payload for method, path, payload in client.calls if method == 'PATCH')
        self.assertEqual(patch_call, dict(sha='new-commit', force=False))
        self.assertEqual(result['albumUrl'], 'https://hyper-jiawei.github.io/gallery/2026-10-23-iphoneduo/')
    def test_existing_album_requires_explicit_update(self):
        with self.assertRaisesRegex(p.PublisherError, '同名专辑'):
            self.publish(FakeGitHub({self.prefix + 'old.jpg': dict(type='blob', sha='old')}))
    def test_updating_removes_only_old_top_level_photos_of_this_album(self):
        client = FakeGitHub({self.prefix + 'old.jpg': dict(type='blob', sha='old'), self.prefix + 'notes.txt': dict(type='blob', sha='notes'), self.prefix + 'nested/keep.jpg': dict(type='blob', sha='nested'), 'gallery/content/other/x.jpg': dict(type='blob', sha='other')})
        self.publish(client, True)
        entries = next(payload['tree'] for method, path, payload in client.calls if path == '/git/trees')
        self.assertEqual([e['path'] for e in entries if e['sha'] is None], [self.prefix + 'old.jpg'])
    def test_unchanged_album_creates_no_commit(self):
        remote = {self.prefix + f.name: dict(type='blob', sha=p.blob_sha(f.read_bytes())) for f in self.folder.iterdir()}
        client = FakeGitHub(remote)
        self.assertTrue(self.publish(client, True)['unchanged'])
        self.assertEqual(client.calls, [])
    def test_concurrent_remote_changes_never_force_overwrite(self):
        client = FakeGitHub(concurrent=True)
        with self.assertRaisesRegex(p.PublisherError, '远端新增'):
            self.publish(client)
        self.assertFalse(any(method == 'PATCH' for method, _, _ in client.calls))
    def test_changed_source_cancels_final_commit(self):
        client = FakeGitHub()
        original = client.repo
        def mutate(method, path, payload=None):
            result = original(method, path, payload)
            if path == '/git/blobs':
                (self.folder / '作品.HEIC').write_bytes(b'changed')
            return result
        client.repo = mutate
        with self.assertRaises(p.PublisherError):
            self.publish(client)
        self.assertFalse(any(path == '/git/commits' for _, path, _ in client.calls))
    def test_path_traversal_is_rejected(self):
        for slug in ['../other', 'a/b', '.git', '', 'a%2fb']:
            with self.assertRaises(p.PublisherError):
                p.publish_album(FakeGitHub(), 'main', self.folder, slug, False, lambda *args: None)

class HTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = p.App('Hyper-jiawei/Hyper-jiawei.github.io', 'main')
        cls.server = p.ThreadingHTTPServer(('127.0.0.1', 0), p.Handler)
        cls.server.app = cls.app
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.app.cache.cleanup()
    def request(self, method, path, token=None, origin=None, host=None, payload=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port)
        headers = {'Content-Type': 'application/json'}
        if token: headers['X-Publisher-Token'] = token
        if origin: headers['Origin'] = origin
        if host: headers['Host'] = host
        connection.request(method, path, body=json.dumps(payload or {}) if method == 'POST' else None, headers=headers)
        response = connection.getresponse()
        result = response.status, response.read()
        connection.close()
        return result
    def test_explicit_http_publish_runs_an_atomic_job_without_real_network(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            (folder / '测试.JPG').write_bytes(b'original bytes')
            _, raw = self.request('POST', '/api/load', self.app.csrf, payload={'path': str(folder)})
            info = json.loads(raw)
            code, _ = self.request('POST', '/api/save', self.app.csrf, payload={'folderId': info['folderId'], 'indexHash': info['indexHash'], 'config': generated(['测试.JPG'])})
            self.assertEqual(code, 200)
            client = FakeGitHub()
            with patch.object(self.app, 'client', return_value=client):
                code, raw = self.request('POST', '/api/publish', self.app.csrf, payload={'folderId': info['folderId'], 'slug': '2026-11-01-test', 'allowUpdate': False})
                self.assertEqual(code, 200)
                job_id = json.loads(raw)['id']
                for _ in range(100):
                    _, raw = self.request('POST', '/api/job', self.app.csrf, payload={'id': job_id})
                    job = json.loads(raw)
                    if job['status'] != 'running':
                        break
                    time.sleep(.02)
                self.assertEqual(job['status'], 'success', job)
                self.assertEqual(job['result']['commit'], 'new-commit')
                self.assertEqual(sum(method == 'PATCH' for method, _, _ in client.calls), 1)
            self.app.folder = None
            self.app.folder_id = None

    def test_missing_session_and_foreign_origin_cannot_trigger_actions(self):
        self.assertEqual(self.request('POST', '/api/choose')[0], 403)
        self.assertEqual(self.request('POST', '/api/choose', self.app.csrf, 'https://example.com')[0], 403)
        self.assertEqual(self.request('GET', '/', host='attacker.example')[0], 403)
    def test_local_editor_and_authenticated_info_are_available(self):
        self.assertEqual(self.request('GET', '/')[0], 200)
        self.assertEqual(self.request('GET', '/config.mjs')[0], 200)
        code, body = self.request('POST', '/api/info', self.app.csrf)
        self.assertEqual(code, 200)
        self.assertEqual(json.loads(body)['repository'], self.app.repository)
        self.assertEqual(self.request('GET', '/../publisher.py')[0], 404)

if __name__ == '__main__':
    unittest.main()
