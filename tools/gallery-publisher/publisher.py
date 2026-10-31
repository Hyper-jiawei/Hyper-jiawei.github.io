#!/usr/bin/env python3
"""Loopback-only album editor and atomic GitHub publisher. No third-party Python packages."""
import argparse
import base64
import concurrent.futures
import datetime as dt
import glob
import hashlib
import hmac
import json
import mimetypes
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.heic', '.heif'}
MAX_FILE = 100 * 1024 * 1024

class PublisherError(Exception):
    pass

def digest(data):
    return hashlib.sha256(data).hexdigest()

def blob_sha(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()

def find_node():
    candidates = [os.environ.get('GALLERY_NODE'), shutil.which('node')]
    candidates += glob.glob(str(Path.home() / '.cache/codex-runtimes/*/dependencies/node/bin/node'))
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return candidate
    raise PublisherError('需要 Node.js 24。安装后重新打开工具，或设置 GALLERY_NODE。')

def worker(action, **values):
    result = subprocess.run([find_node(), str(HERE / 'worker.mjs')], input=json.dumps(dict(action=action, **values), ensure_ascii=False).encode(), stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
    if result.returncode:
        detail = result.stderr.decode('utf-8', errors='replace').strip()
        if 'Cannot find' in detail or 'ERR_MODULE_NOT_FOUND' in detail:
            raise PublisherError('缺少网站依赖。请在网站源码目录运行 npm ci 和 npm ci --prefix gallery/site。')
        raise PublisherError(detail[:1500] or '图片或配置处理失败。')
    return result.stdout if action == 'preview' else json.loads(result.stdout)

def index_state(folder):
    path = folder / 'index.md'
    if path.is_symlink():
        raise PublisherError('index.md 不能是符号链接。')
    if not path.exists():
        return '', None
    if path.stat().st_size > 1024 * 1024:
        raise PublisherError('index.md 超过 1 MB，请检查是否选错文件夹。')
    data = path.read_bytes()
    return data.decode('utf-8-sig'), digest(data)

def inspect_folder(folder):
    folder = Path(folder).expanduser().resolve()
    if not folder.is_dir():
        raise PublisherError('照片文件夹不存在。')
    photos, stems = [], set()
    for path in sorted(folder.iterdir(), key=lambda p: p.name.casefold()):
        if path.suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        if path.is_symlink() or not path.is_file():
            raise PublisherError(f'原图必须是普通文件：{path.name}')
        if any(c in path.name for c in '\\/?#%') or any(ord(c) < 32 for c in path.name) or not path.stem.strip():
            raise PublisherError(f'请先调整图片文件名，避免特殊符号：{path.name}')
        if path.stem in stems:
            raise PublisherError(f'照片标题重复：{path.stem}。请避免同名的 JPG / HEIC。')
        stems.add(path.stem)
        if path.stat().st_size >= MAX_FILE:
            raise PublisherError(f'{path.name} 达到 GitHub 的单文件限制（100 MB），请缩小后上传。')
        photos.append({'file': path.name, 'size': path.stat().st_size, 'title': path.stem})
    if not photos:
        raise PublisherError('文件夹内没有支持的图片。支持 JPG、PNG、WebP、TIFF、HEIC / HEIF，照片请直接放在所选文件夹中。')
    config, config_hash = index_state(folder)
    parsed = {'data': {}, 'errors': []}
    if config:
        try:
            parsed = worker('parse', config=config, files=[p['file'] for p in photos])
        except PublisherError as error:
            parsed['errors'] = [str(error)]
    return {'path': str(folder), 'name': folder.name, 'photos': photos, 'config': config, 'indexHash': config_hash, 'metadata': parsed['data'], 'warnings': parsed['errors']}

def valid_slug(slug):
    return bool(slug and len(slug) <= 150 and slug not in ('.', '..') and not slug.startswith('.') and all(c.isalnum() or c in '-_.' for c in slug))

def save_config(folder, config, expected_hash):
    photos = inspect_folder(folder)['photos']
    parsed = worker('parse', config=config, files=[p['file'] for p in photos])
    if parsed['errors']:
        raise PublisherError('\n'.join(parsed['errors']))
    _, current = index_state(folder)
    if current != expected_hash:
        raise PublisherError('index.md 已被其他编辑器修改。请点击「重新读取」，避免覆盖你刚填写的内容。')
    temporary = None
    try:
        with tempfile.NamedTemporaryFile('w', encoding='utf-8', dir=folder, prefix='.index-', suffix='.tmp', delete=False) as output:
            temporary = Path(output.name)
            output.write(config.rstrip() + '\n')
        os.replace(temporary, folder / 'index.md')
    finally:
        if temporary and temporary.exists():
            temporary.unlink()
    return index_state(folder)[1]

def existing_token():
    for name in ('GITHUB_TOKEN', 'GH_TOKEN'):
        if os.environ.get(name):
            return os.environ[name].strip()
    if shutil.which('gh'):
        try:
            result = subprocess.run(['gh', 'auth', 'token', '--hostname', 'github.com'], capture_output=True, text=True, timeout=8)
            if result.returncode == 0 and result.stdout.strip():
                return result.stdout.strip()
        except (subprocess.SubprocessError, OSError):
            pass
    try:
        result = subprocess.run(['git', '-c', 'credential.interactive=false', 'credential', 'fill'], input='protocol=https\nhost=github.com\n\n', capture_output=True, text=True, timeout=8, env=dict(os.environ, GIT_TERMINAL_PROMPT='0'))
        if result.returncode == 0:
            fields = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
            if fields.get('password'):
                return fields['password']
    except (subprocess.SubprocessError, OSError):
        pass
    raise PublisherError('没有找到可用的 GitHub 登录。请在「GitHub 连接」中填写此仓库的访问令牌，再点连接。令牌仅保存在本次工具进程的内存中。')

class GitHub:
    def __init__(self, token, repository):
        self.token, self.repository = token, repository

    def request(self, method, path, payload=None):
        data = None if payload is None else json.dumps(payload).encode()
        headers = {'Authorization': 'Bearer ' + self.token, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Hyper-Gallery-Publisher', 'Content-Type': 'application/json'}
        url = 'https://api.github.com' + path
        for attempt in range(3):
            try:
                with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=headers, method=method), timeout=90) as response:
                    return json.load(response)
            except urllib.error.HTTPError as error:
                if error.code in (429, 502, 503, 504) and attempt < 2:
                    time.sleep(2 ** attempt)
                    continue
                if error.code == 401:
                    raise PublisherError('GitHub 登录已失效，请重新连接。') from None
                if error.code in (403, 404):
                    raise PublisherError('没有仓库访问权限、令牌权限不足或触发了 GitHub 请求限制。请检查令牌是否允许访问此仓库并具有 Contents 读写权限。') from None
                detail = json.loads(error.read().decode()).get('message', '')
                raise PublisherError(f'GitHub 返回 {error.code}：{detail}') from None
            except (urllib.error.URLError, TimeoutError, OSError):
                if attempt < 2 and method != 'PATCH':
                    time.sleep(2 ** attempt)
                    continue
                raise PublisherError('无法连接 GitHub。请检查网络后重试；若在最终提交时断线，请先打开提交记录确认是否已发布。') from None

    def repo(self, method, suffix, payload=None):
        return self.request(method, '/repos/' + self.repository + suffix, payload)

    def head(self, branch):
        return self.repo('GET', '/git/ref/heads/' + urllib.parse.quote(branch, safe=''))['object']['sha']

    def tree(self, sha):
        commit = self.repo('GET', '/git/commits/' + sha)
        result = self.repo('GET', '/git/trees/' + commit['tree']['sha'] + '?recursive=1')
        if result.get('truncated'):
            raise PublisherError('仓库目录过大，GitHub 返回了不完整目录。本次没有提交，请先检查仓库。')
        return commit['tree']['sha'], {e['path']: e for e in result['tree']}

def publish_album(client, branch, folder, slug, allow_update, progress):
    if not valid_slug(slug):
        raise PublisherError('专辑目录名只能包含中文、字母、数字、连字符、下划线和点，且不能以点开头。')
    inspected = inspect_folder(folder)
    config, _ = index_state(folder)
    if not config:
        raise PublisherError('请先点击「生成配置文件」，并填写专辑标题、日期等信息。')
    parsed = worker('parse', config=config, files=[p['file'] for p in inspected['photos']])
    if parsed['errors']:
        raise PublisherError('\n'.join(parsed['errors']))
    # Preflight the current branch before selecting storage; never expose private tokens in Pages.
    import importlib.util
    spec = importlib.util.spec_from_file_location('hyper_gallery_storage', HERE / 'storage.py')
    storage = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(storage)
    current_head = client.head(branch)
    current_tree_sha, remote_tree = client.tree(current_head)
    incoming = sum(p['size'] for p in inspected['photos'])
    archived = 'gallery/content/' + slug + '/_processed.json' in remote_tree
    if archived or storage.estimate_main(remote_tree, incoming) > storage.MAIN_BUDGET:
        return storage.publish_archived(client, branch, folder, slug, inspected, allow_update, progress, PublisherError, ROOT / 'gallery/site', find_node(), worker)
    progress('读取远端最新版本', 0, len(inspected['photos']) + 1)
    head = current_head
    tree_sha, remote = current_tree_sha, remote_tree
    prefix = 'gallery/content/' + slug + '/'
    album_exists = any(name.startswith(prefix) for name in remote)
    if album_exists and not allow_update:
        raise PublisherError('远端已经有同名专辑。确认要更新时，请勾选「更新同名专辑」后重试。')
    files = [folder / p['file'] for p in inspected['photos']] + [folder / 'index.md']
    snapshots = {}
    for file in files:
        data = file.read_bytes()
        snapshots[file.name] = {'sha': blob_sha(data), 'digest': digest(data), 'size': len(data)}
    total, completed = len(files), 0
    entries = []
    lock = threading.Lock()
    def upload(file):
        nonlocal completed
        target, snapshot = prefix + file.name, snapshots[file.name]
        old = remote.get(target)
        if old and old['sha'] == snapshot['sha']:
            entry = None
        else:
            data = file.read_bytes()
            if digest(data) != snapshot['digest']:
                raise PublisherError(f'发布过程中原图发生变化：{file.name}。请等待编辑完成后重试。')
            try:
                result = client.repo('POST', '/git/blobs', {'content': base64.b64encode(data).decode(), 'encoding': 'base64'})
            except PublisherError as error:
                raise PublisherError(f'上传失败：{file.name}（{snapshot["size"] / 1024 / 1024:.2f} MiB）\n{error}') from None
            if result['sha'] != snapshot['sha']:
                raise PublisherError('上传文件校验失败：' + file.name)
            entry = {'path': target, 'type': 'blob', 'mode': '100644', 'sha': result['sha']}
        with lock:
            completed += 1
            progress('处理 ' + file.name, completed, total)
        return entry
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for entry in pool.map(upload, files):
            if entry:
                entries.append(entry)
    # Mirror only top-level album photos/index; never delete other albums or extra documents.
    for name, entry in remote.items():
        if not name.startswith(prefix) or entry['type'] != 'blob':
            continue
        leaf = name[len(prefix):]
        if '/' not in leaf and (Path(leaf).suffix.lower() in IMAGE_EXTENSIONS or leaf == 'index.md') and leaf not in snapshots:
            entries.append({'path': name, 'type': 'blob', 'mode': '100644', 'sha': None})
    for file in files:
        if file.is_symlink() or digest(file.read_bytes()) != snapshots[file.name]['digest']:
            raise PublisherError(f'提交前发现文件已改变：{file.name}。请重新发布。')
    if not entries:
        return {'unchanged': True, 'commit': head, 'url': f'https://github.com/{client.repository}/commit/{head}', 'albumUrl': f'https://{client.repository.split("/")[0].lower()}.github.io/gallery/{urllib.parse.quote(slug.lower())}/'}
    progress('创建专辑提交', total, total)
    tree = client.repo('POST', '/git/trees', {'base_tree': tree_sha, 'tree': entries})
    commit = client.repo('POST', '/git/commits', {'message': f'gallery: {"update" if album_exists else "publish"} {slug}', 'tree': tree['sha'], 'parents': [head]})
    if client.head(branch) != head:
        raise PublisherError('发布期间远端新增了提交。本次没有更新分支，请再次点击发布，工具会基于最新版本重试。')
    client.repo('PATCH', '/git/refs/heads/' + urllib.parse.quote(branch, safe=''), {'sha': commit['sha'], 'force': False})
    return {'unchanged': False, 'commit': commit['sha'], 'url': f'https://github.com/{client.repository}/commit/{commit["sha"]}', 'actionsUrl': f'https://github.com/{client.repository}/actions', 'albumUrl': f'https://{client.repository.split("/")[0].lower()}.github.io/gallery/{urllib.parse.quote(slug.lower())}/'}

class App:
    def __init__(self, repository, branch):
        self.repository, self.branch = repository, branch
        self.csrf = secrets.token_urlsafe(32)
        self.folder = None
        self.folder_id = None
        self.token = None
        self.job = None
        self.job_lock = threading.Lock()
        self.preview_slots = threading.Semaphore(2)
        self.cache = tempfile.TemporaryDirectory(prefix='hyper-gallery-preview-')

    def client(self):
        return GitHub(self.token or existing_token(), self.repository)

    def start_publish(self, payload):
        with self.job_lock:
            if self.job and self.job['status'] == 'running':
                raise PublisherError('已有发布任务正在运行。')
            if payload.get('folderId') != self.folder_id or self.folder is None:
                raise PublisherError('所选文件夹已改变，请重新选择。')
            client = self.client()
            folder = self.folder
            job = {'id': secrets.token_hex(12), 'status': 'running', 'message': '准备发布', 'done': 0, 'total': 1}
            self.job = job
        def progress(message, done, total):
            with self.job_lock:
                job.update(message=message, done=done, total=total)
        def run():
            try:
                result = publish_album(client, self.branch, folder, payload.get('slug', ''), payload.get('allowUpdate') is True, progress)
                with self.job_lock:
                    job.update(status='success', result=result, message='内容没有变化，无需重复提交。' if result['unchanged'] else '已提交到 GitHub。网站将在 Actions 部署成功后更新。')
            except Exception as error:
                with self.job_lock:
                    job.update(status='error', message=str(error) if isinstance(error, PublisherError) else '发布失败。请检查文件权限和网络后重试。')
        threading.Thread(target=run, daemon=True).start()
        return job.copy()

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def reply(self, status, data, content_type='application/json; charset=utf-8'):
        raw = json.dumps(data, ensure_ascii=False).encode() if not isinstance(data, bytes) else data
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        self.end_headers()
        self.wfile.write(raw)

    def authorized(self):
        if self.headers.get('Host') != f'127.0.0.1:{self.server.server_port}':
            return False
        origin = self.headers.get('Origin')
        if origin and origin != f'http://127.0.0.1:{self.server.server_port}':
            return False
        return hmac.compare_digest(self.headers.get('X-Publisher-Token', ''), self.server.app.csrf)

    def do_GET(self):
        if self.headers.get('Host') != f'127.0.0.1:{self.server.server_port}':
            self.reply(403, {'error': '仅允许本机访问。'})
            return
        if self.path == '/':
            html = (HERE / 'index.html').read_text().replace('__SESSION_TOKEN__', self.server.app.csrf)
            self.reply(200, html.encode(), 'text/html; charset=utf-8')
        elif self.path == '/config.mjs':
            self.reply(200, (HERE / 'config.mjs').read_bytes(), 'text/javascript; charset=utf-8')
        elif self.path == '/favicon.ico':
            self.reply(204, b'', 'image/x-icon')
        else:
            self.reply(404, {'error': '找不到此地址。'})

    def do_POST(self):
        if not self.authorized():
            self.reply(403, {'error': '会话已失效或请求来源不正确，请刷新本地工具页面。'})
            return
        try:
            size = int(self.headers.get('Content-Length', 0))
            if not 0 < size <= 2 * 1024 * 1024:
                raise PublisherError('请求体大小不正确。')
            payload = json.loads(self.rfile.read(size))
            app = self.server.app
            if self.path == '/api/info':
                self.reply(200, {'repository': app.repository, 'branch': app.branch})
            elif self.path == '/api/choose':
                if os.uname().sysname != 'Darwin':
                    raise PublisherError('请在路径框粘贴照片文件夹的完整路径。')
                result = subprocess.run(['osascript', '-e', 'POSIX path of (choose folder with prompt "选择要发布的照片专辑文件夹")'], capture_output=True, text=True, timeout=180)
                if result.returncode:
                    self.reply(200, {'cancelled': True})
                else:
                    self.load_folder(result.stdout.strip())
            elif self.path in ('/api/load', '/api/reload'):
                self.load_folder(str(app.folder) if self.path.endswith('reload') and app.folder else payload.get('path', ''))
            elif self.path == '/api/connect':
                if payload.get('token'):
                    app.token = payload['token'].strip()
                client = app.client()
                account = client.request('GET', '/user')
                repo = client.repo('GET', '')
                if not repo.get('permissions', {}).get('push'):
                    raise PublisherError('当前 GitHub 登录没有此仓库的写入权限。')
                app.token = client.token
                self.reply(200, {'login': account['login'], 'repository': app.repository})
            elif self.path == '/api/save':
                self.require_folder(payload)
                new_hash = save_config(app.folder, payload.get('config', ''), payload.get('indexHash'))
                self.reply(200, {'indexHash': new_hash})
            elif self.path == '/api/preview':
                self.require_folder(payload)
                name = payload.get('file', '')
                source = app.folder / name
                if not name or Path(name).name != name or source.suffix.lower() not in IMAGE_EXTENSIONS or source.is_symlink() or not source.is_file():
                    raise PublisherError('照片不在当前专辑中。')
                stamp = f'{source}:{source.stat().st_mtime_ns}:{source.stat().st_size}'.encode()
                cached = Path(app.cache.name) / (digest(stamp) + '.jpg')
                with app.preview_slots:
                    if not cached.exists():
                        cached.write_bytes(worker('preview', file=str(source)))
                self.reply(200, cached.read_bytes(), 'image/jpeg')
            elif self.path == '/api/publish':
                self.reply(200, app.start_publish(payload))
            elif self.path == '/api/job':
                if not app.job or payload.get('id') != app.job['id']:
                    raise PublisherError('找不到发布任务。')
                with app.job_lock:
                    self.reply(200, app.job.copy())
            else:
                self.reply(404, {'error': '找不到此操作。'})
        except (PublisherError, ValueError, OSError, subprocess.SubprocessError) as error:
            self.reply(400, {'error': str(error) if isinstance(error, (PublisherError, ValueError)) else '本地文件操作失败，请检查路径、文件权限或依赖是否完整。'})

    def require_folder(self, payload):
        if self.server.app.folder is None or payload.get('folderId') != self.server.app.folder_id:
            raise PublisherError('请先选择照片文件夹。')

    def load_folder(self, path):
        app = self.server.app
        if app.job and app.job['status'] == 'running':
            raise PublisherError('发布中，请等待完成后再切换文件夹。')
        if not path:
            raise PublisherError('请填写照片文件夹路径。')
        info = inspect_folder(path)
        app.folder = Path(info['path'])
        app.folder_id = secrets.token_hex(16)
        info['folderId'] = app.folder_id
        self.reply(200, info)

def main():
    parser = argparse.ArgumentParser(description='Hyper Gallery 本地发布工具')
    parser.add_argument('--port', type=int, default=8768)
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--repository', default='Hyper-jiawei/Hyper-jiawei.github.io')
    parser.add_argument('--branch', default='main')
    options = parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', options.repository):
        parser.error('仓库格式应为 owner/name')
    app = App(options.repository, options.branch)
    try:
        server = ThreadingHTTPServer(('127.0.0.1', options.port), Handler)
    except OSError:
        url = f'http://127.0.0.1:{options.port}/'
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                running = 'Hyper · Gallery 发布工具' in response.read(20000).decode('utf-8', errors='replace')
            if running:
                print('发布工具已经运行：' + url, flush=True)
                if not options.no_browser:
                    webbrowser.open(url)
                app.cache.cleanup()
                return
        except (OSError, urllib.error.URLError):
            pass
        raise SystemExit(f'端口 {options.port} 正在使用。可以执行 python3 publisher.py --port 8769。')
    server.app = app
    url = f'http://127.0.0.1:{server.server_port}/'
    print(f'Hyper Gallery 发布工具：{url}\n关闭此终端或按 Control+C 即可停止。\n原图只会在点击「发布到 Gallery」后上传。', flush=True)
    if not options.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        app.cache.cleanup()

if __name__ == '__main__':
    main()
