"""Capacity-aware private original archives; only browser-ready previews reach Pages."""
import base64
import concurrent.futures
import threading
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import urllib.parse

MAIN_BUDGET = 650 * 1024 * 1024
ARCHIVE_BUDGET = 800 * 1024 * 1024


def estimate_main(tree, incoming):
    # Local originals also yield multiple WebP exports and sometimes a full-pixel JPEG.
    originals = sum(e.get('size', 0) for path, e in tree.items() if path.startswith('gallery/content/') and '/_preview/' not in path and Path(path).suffix.lower() in {'.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.tif', '.tiff'})
    previews = sum(e.get('size', 0) for path, e in tree.items() if '/_preview/' in path)
    return originals * 3 + previews + incoming * 3


def choose_archive(client, incoming, error):
    repositories = []
    page = 1
    while True:
        batch = client.request('GET', f'/user/repos?affiliation=owner&per_page=100&page={page}')
        repositories.extend(batch)
        if len(batch) < 100:
            break
        page += 1
    owner = client.repository.split('/')[0]
    archives = sorted((r for r in repositories if r['owner']['login'].lower() == owner.lower() and re.fullmatch(r'gallery\d{2,}', r['name'])), key=lambda r: int(r['name'][7:]))
    for repo in reversed(archives):
        if repo['private'] and repo.get('size', 0) * 1024 + incoming < ARCHIVE_BUDGET:
            return repo['full_name'], repo['default_branch']
    number = max([int(r['name'][7:]) for r in archives] + [0]) + 1
    repo = client.request('POST', '/user/repos', {'name': f'gallery{number:02d}', 'private': True, 'auto_init': True, 'description': 'Hyper Gallery private originals and album configuration'})
    if not repo.get('private'):
        raise error('原图存储仓库不是私人仓库，已停止上传。')
    return repo['full_name'], repo['default_branch']


def commit_files(client, branch, files, prefix, allow_update, progress, error, mirror=True):
    head = client.head(branch)
    tree_sha, tree = client.tree(head)
    if not allow_update and any(p.startswith(prefix) for p in tree):
        raise error('远端已经有同名专辑，请勾选「更新同名专辑」。')
    entries = []
    completed = 0
    lock = threading.Lock()
    def upload(item):
        nonlocal completed
        name, data = item
        target = prefix + name
        sha = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
        entry = None
        if tree.get(target, {}).get('sha') != sha:
            try:
                result = client.repo('POST', '/git/blobs', {'encoding': 'base64', 'content': base64.b64encode(data).decode()})
            except Exception as exc:
                raise error('上传失败：' + name + '\n' + str(exc)) from None
            if result['sha'] != sha:
                raise error('上传文件校验失败：' + name)
            entry = {'path': target, 'mode': '100644', 'type': 'blob', 'sha': sha}
        with lock:
            completed += 1
            progress(f'{client.repository} · {name}', completed, len(files))
        return entry
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        entries = [entry for entry in pool.map(upload, files.items()) if entry]
    if mirror:
        for path, entry in tree.items():
            if path.startswith(prefix) and entry['type'] == 'blob' and path[len(prefix):] not in files:
                leaf = path[len(prefix):]
                if leaf.startswith('_preview/') or leaf in ('index.md', '_processed.json') or '/' not in leaf and Path(leaf).suffix.lower() in {'.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.tif', '.tiff'}:
                    entries.append({'path': path, 'mode': '100644', 'type': 'blob', 'sha': None})
    if not entries:
        return head
    new_tree = client.repo('POST', '/git/trees', {'base_tree': tree_sha, 'tree': entries})
    commit = client.repo('POST', '/git/commits', {'tree': new_tree['sha'], 'parents': [head], 'message': 'gallery: sync ' + prefix.rstrip('/')})
    if client.head(branch) != head:
        raise error('远端在上传期间有新提交，未覆盖远端，请重新发布。')
    client.repo('PATCH', '/git/refs/heads/' + urllib.parse.quote(branch, safe=''), {'sha': commit['sha'], 'force': False})
    return commit['sha']


def publish_archived(client, branch, folder, slug, inspected, allow_update, progress, error, site, node, worker):
    if sum(p['size'] for p in inspected['photos']) >= ARCHIVE_BUDGET:
        raise error('单辑原图超过 800 MiB 预算，请拆成两辑。')
    prefix = 'gallery/content/' + slug + '/'
    config = (folder / 'index.md').read_text(encoding='utf-8-sig')
    originals = {p['file']: (folder / p['file']).read_bytes() for p in inspected['photos']}
    originals['index.md'] = (folder / 'index.md').read_bytes()
    metadata = worker('parse', config=config, files=[p['file'] for p in inspected['photos']])
    if metadata['errors']:
        raise error('\n'.join(metadata['errors']))
    # Generate all derivatives before modifying either remote repository.
    progress('在本机生成轻量预览图，原图保持不变', 0, len(originals))
    with tempfile.TemporaryDirectory(prefix='hyper-gallery-archive-') as temporary:
        root = Path(temporary)
        (root / 'scripts').mkdir()
        (root / 'content' / slug).mkdir(parents=True)
        for name in ('build-images.mjs', 'heic-input.mjs', 'featured.mjs'):
            shutil.copyfile(site / 'scripts' / name, root / 'scripts' / name)
        (root / 'node_modules').symlink_to(site / 'node_modules', target_is_directory=True)
        for name, data in originals.items():
            (root / 'content' / slug / name).write_bytes(data)
        result = subprocess.run([node, str(root / 'scripts/build-images.mjs')], env=__import__('os').environ.copy() | {'GALLERY_CONTENT': str(root / 'content')}, capture_output=True, timeout=1800)
        if result.returncode:
            raise error('生成预览失败：' + result.stderr.decode(errors='replace')[-1500:])
        album = json.loads((root / 'src/data/gallery.json').read_text())['albums'][0]
        public = {'index.md': originals['index.md']}
        for photo in album['photos']:
            # Public full view stays at <=3000px; camera originals stay in the private archive.
            photo['displayOriginal'] = photo['srcset'][-1]
            for asset in (root / 'public/img' / photo['key']).iterdir():
                if asset.suffix.lower() == '.webp':
                    public['_preview/' + photo['key'] + '/' + asset.name] = asset.read_bytes()
        head = client.head(branch)
        _, tree = client.tree(head)
        other_bytes = sum(e.get('size', 0) for p, e in tree.items() if p.startswith('gallery/') and not p.startswith(prefix) and e['type'] == 'blob')
        if other_bytes * 2 + sum(map(len, public.values())) > MAIN_BUDGET:
            raise error('主站预览文件也接近容量预算，未上传。仅拆分私人原图仓库已不足，需要另接公共图片托管；不会继续堆满 Pages。')
        repo_name, archive_branch = choose_archive(client, sum(map(len, originals.values())), error)
        archive = type(client)(client.token, repo_name)
        archive_head = commit_files(archive, archive_branch, originals, prefix, True, progress, error)
        for photo in album['photos']:
            photo['original']['url'] = 'https://github.com/' + repo_name + '/blob/' + archive_head + '/' + urllib.parse.quote(prefix + photo['file'])
        album['archive'] = {'repository': repo_name, 'commit': archive_head}
        public['_processed.json'] = json.dumps(album, ensure_ascii=False).encode()
        # Verify source files have not changed during conversion/upload.
        for name, data in originals.items():
            if (folder / name).read_bytes() != data:
                raise error('源文件在发布期间发生变化，原图已备份，但未更新主站。请重新发布。')
        sha = commit_files(client, branch, public, prefix, allow_update, progress, error)
    return {'unchanged': False, 'commit': sha, 'url': f'https://github.com/{client.repository}/commit/{sha}', 'actionsUrl': f'https://github.com/{client.repository}/actions', 'albumUrl': f'https://{client.repository.split("/")[0].lower()}.github.io/gallery/{urllib.parse.quote(slug.lower())}/', 'archive': repo_name, 'archiveUrl': 'https://github.com/' + repo_name}
