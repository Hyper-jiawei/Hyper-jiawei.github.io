import importlib.util
import json
import base64, os, shutil, subprocess
from pathlib import Path
import tempfile
import unittest

from test_publisher import p, FakeGitHub, generated
spec = importlib.util.spec_from_file_location('gallery_storage', p.HERE / 'storage.py')
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)

class ArchiveClient(FakeGitHub):
    token = 'test-token'
    changes = {}
    blobs = {}
    def __init__(self, token='test-token', repository='Hyper-jiawei/Hyper-jiawei.github.io'):
        super().__init__()
        self.token, self.repository = token, repository
    def request(self, method, path, payload=None):
        if method == 'GET':
            return [{'owner': {'login': 'Hyper-jiawei'}, 'name': 'gallery01', 'full_name': 'Hyper-jiawei/gallery01', 'private': True, 'size': 1, 'default_branch': 'main'}]
        raise AssertionError(path)
    def repo(self, method, path, payload=None):
        if path == '/git/blobs':
            data = base64.b64decode(payload['content']); self.blobs[p.blob_sha(data)] = data
        if path == '/git/trees':
            self.changes[self.repository] = payload['tree']
        return super().repo(method, path, payload)

class StorageTests(unittest.TestCase):
    def test_budget_accounts_for_derivatives_and_public_previews(self):
        tree = {'gallery/content/a/a.jpg': {'size': 100}, 'gallery/content/b/_preview/key/960.webp': {'size': 20}}
        self.assertEqual(s.estimate_main(tree, 50), 470)
    def test_reuses_private_archive_and_rotates_past_full_or_public_repos(self):
        client = ArchiveClient()
        self.assertEqual(s.choose_archive(client, 100, p.PublisherError)[0], 'Hyper-jiawei/gallery01')
        class Full(ArchiveClient):
            def request(self, method, path, payload=None):
                if method == 'GET':
                    return [{'owner': {'login': 'Hyper-jiawei'}, 'name': 'gallery01', 'full_name': 'Hyper-jiawei/gallery01', 'private': True, 'size': s.ARCHIVE_BUDGET // 1024, 'default_branch': 'main'}, {'owner': {'login': 'Hyper-jiawei'}, 'name': 'gallery02', 'private': False, 'size': 0}]
                assert payload['name'] == 'gallery03' and payload['private'] is True
                return {'full_name': 'Hyper-jiawei/gallery03', 'private': True, 'default_branch': 'main'}
        self.assertEqual(s.choose_archive(Full(), 100, p.PublisherError)[0], 'Hyper-jiawei/gallery03')
    def test_private_publish_keeps_originals_private_and_emits_only_webp_and_manifest_in_main(self):
        ArchiveClient.changes = {}
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            original = (p.ROOT / 'gallery/site/scripts/fixtures/phone.heic').read_bytes()
            (folder / '手机.HEIC').write_bytes(original)
            (folder / 'index.md').write_text(generated(['手机.HEIC']))
            result = s.publish_archived(ArchiveClient(), 'main', folder, 'phone', p.inspect_folder(folder), False, lambda *a: None, p.PublisherError, p.ROOT / 'gallery/site', p.find_node(), p.worker)
            self.assertEqual(result['archive'], 'Hyper-jiawei/gallery01')
            private = ArchiveClient.changes['Hyper-jiawei/gallery01']
            public = ArchiveClient.changes['Hyper-jiawei/Hyper-jiawei.github.io']
            self.assertIn('gallery/content/phone/手机.HEIC', [e['path'] for e in private])
            self.assertTrue(any(e['path'].endswith('_processed.json') for e in public))
            self.assertTrue(any('/_preview/' in e['path'] for e in public))
            self.assertFalse(any(e['path'].endswith('.HEIC') or 'full-resolution.jpg' in e['path'] for e in public))
            self.assertEqual((folder / '手机.HEIC').read_bytes(), original)

            root = folder / 'build'
            (root / 'scripts').mkdir(parents=True)
            (root / 'node_modules').symlink_to(p.ROOT / 'gallery/site/node_modules', target_is_directory=True)
            for name in ('build-images.mjs', 'heic-input.mjs', 'featured.mjs'):
                shutil.copyfile(p.ROOT / 'gallery/site/scripts' / name, root / 'scripts' / name)
            for entry in public:
                path = root / entry['path'].replace('gallery/content/', 'content/', 1)
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(ArchiveClient.blobs[entry['sha']])
            run = subprocess.run([p.find_node(), str(root / 'scripts/build-images.mjs')], env=dict(os.environ, GALLERY_CONTENT=str(root / 'content')), capture_output=True)
            self.assertEqual(run.returncode, 0, run.stderr.decode())
            album = json.loads((root / 'src/data/gallery.json').read_text())['albums'][0]
            self.assertTrue(album['prepared'])
            self.assertTrue(album['photos'][0]['original']['url'].startswith('https://github.com/Hyper-jiawei/gallery01/'))
            self.assertTrue((root / 'public' / album['photos'][0]['displayOriginal']['url'].lstrip('/')).exists())
