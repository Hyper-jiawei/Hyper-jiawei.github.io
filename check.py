"""Validate editable content and optionally stage only public files for Pages."""
import argparse
import datetime
import json
from pathlib import Path
import shutil
from urllib.parse import urlsplit, unquote

ROOT = Path(__file__).resolve().parent

def require(value, message):
    if not value:
        raise ValueError(message)

def url(value, label, image=False):
    if not value:
        return
    require(isinstance(value, str), f'{label}: must be a string')
    parts = urlsplit(value)
    if parts.scheme or parts.netloc:
        require(parts.scheme in ('http', 'https') and bool(parts.netloc), f'{label}: use http(s) or a local relative path')
    else:
        require(not parts.query and not parts.fragment, f'{label}: local path must not have query/fragment')
        path = (ROOT / unquote(parts.path.lstrip('/'))).resolve()
        require(path.is_relative_to(ROOT / 'assets'), f'{label}: local files must be inside assets/')
        require(path.is_file(), f'{label}: missing local file {value}')
        if image:
            require(path.suffix.lower() in ('.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.svg'), f'{label}: unsupported image extension')

def date(value, label, optional=False):
    if optional and not value:
        return
    require(isinstance(value, str) and len(value) == 10, f'{label}: use YYYY-MM-DD')
    datetime.date.fromisoformat(value)

def validate():
    data = json.loads((ROOT / 'content.json').read_text())
    for name in ('profile', 'featured', 'projects', 'albums', 'notes'):
        require(name in data, f'Missing key: {name}')
    for key in ('name', 'nameEn', 'username', 'bio', 'location', 'organization', 'github', 'email', 'intro', 'interests', 'updated'):
        require(key in data['profile'], f'profile.{key} is required (can be empty)')
    date(data['profile']['updated'], 'profile.updated')
    require(isinstance(data['profile']['interests'], list), 'profile.interests: use an array')
    url(data['profile']['github'], 'profile.github')
    for key in ('eyebrow', 'title', 'subtitle', 'image', 'alt'):
        require(key in data['featured'], f'featured.{key} is required')
    url(data['featured']['image'], 'featured.image', True)
    ids = set()
    for section in ('projects', 'albums', 'notes'):
        require(isinstance(data[section], list), f'{section}: use an array')
        for i, entry in enumerate(data[section]):
            label = f'{section}[{i}]'
            require(isinstance(entry, dict), f'{label}: use an object')
            require(bool(entry.get('title')), f'{label}: title required')
            date(entry.get('date'), label + '.date', section == 'albums')
            if section != 'notes':
                require(bool(entry.get('id')) and entry['id'] not in ids, f'{label}: id must be nonempty and unique')
                ids.add(entry['id'])
                for key in ('category', 'description', 'cover'):
                    require(isinstance(entry.get(key), str), f'{label}.{key}: string required')
                url(entry['cover'], label + '.cover', True)
            if section == 'projects':
                require(bool(entry.get('url')), f'{label}: project url required')
            if section == 'notes':
                require(isinstance(entry.get('text'), str), f'{label}: text required')
            url(entry.get('url'), label + '.url')
            if section == 'albums':
                require(isinstance(entry.get('photos'), list), f'{label}.photos: use an array')
                for photo in entry['photos']:
                    require(bool(photo.get('src')), f'{label}: photo.src required')
                    require(bool(photo.get('alt')), f'{label}: photo.alt required')
                    url(photo['src'], label + '.photo.src', True)
            require(isinstance(entry.get('files', []), list), f'{label}.files: use an array')
            for item in entry.get('files', []):
                require(bool(item.get('name')) and bool(item.get('url')), f'{label}: file name and url required')
                url(item['url'], label + '.file.url')
    print(f"Content valid: {len(data['projects'])} projects, {len(data['albums'])} albums, {len(data['notes'])} notes")

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--prepare', action='store_true')
    args = parser.parse_args()
    validate()
    if args.prepare:
        target = ROOT / '_site'
        if target.exists():
            shutil.rmtree(target)
        target.mkdir()
        for name in ('index.html', '404.html', 'content.json', '.nojekyll', 'robots.txt', 'sitemap.xml', 'sw.js'):
            shutil.copy2(ROOT / name, target / name)
        shutil.copytree(ROOT / 'assets', target / 'assets', ignore=shutil.ignore_patterns('.gitkeep', '.DS_Store'))
        print('Public files prepared in _site/')
