"""Read gallery links from download torrent names; never hash book contents."""
from __future__ import annotations

from collections import defaultdict
from pathlib import Path
import os
import re
import stat
import unicodedata

SOURCE = re.compile(r'^\s*\[(EH|EX)_([1-9]\d*)_([0-9a-f]{10})\]\s*', re.I)
BOOK_EXTS = {'.zip', '.cbz', '.rar', '.cbr', '.7z', '.cb7', '.pdf', '.epub'}


def parse_torrent(raw):
    if len(raw) > 20 * 1024 * 1024:
        raise ValueError('Torrent exceeds 20 MiB')
    position, info_span = 0, None

    def parse(depth=0):
        nonlocal position, info_span
        if depth > 100 or position >= len(raw):
            raise ValueError('Invalid or excessively nested bencode')
        marker = raw[position:position + 1]
        if marker.isdigit():
            end = raw.find(b':', position)
            if end < 0 or not re.fullmatch(rb'0|[1-9]\d*', raw[position:end]):
                raise ValueError('Invalid byte string length')
            length = int(raw[position:end])
            position = end + 1
            if position + length > len(raw):
                raise ValueError('Truncated byte string')
            value = raw[position:position + length]
            position += length
            return value
        if marker == b'i':
            end = raw.find(b'e', position)
            value = raw[position + 1:end]
            if end < 0 or not re.fullmatch(rb'0|-?[1-9]\d*', value):
                raise ValueError('Invalid integer')
            position = end + 1
            return int(value)
        if marker not in {b'l', b'd'}:
            raise ValueError('Invalid bencode marker')
        position += 1
        value = [] if marker == b'l' else {}
        while position < len(raw) and raw[position:position + 1] != b'e':
            if marker == b'l':
                value.append(parse(depth + 1))
            else:
                key = parse(depth + 1)
                if not isinstance(key, bytes) or key in value:
                    raise ValueError('Invalid or duplicated dictionary key')
                start = position
                value[key] = parse(depth + 1)
                if depth == 0 and key == b'info':
                    info_span = (start, position)
        if position >= len(raw):
            raise ValueError('Unterminated container')
        position += 1
        return value

    root = parse()
    if position != len(raw) or not isinstance(root, dict) or not isinstance(root.get(b'info'), dict) or info_span is None:
        raise ValueError('Torrent has no unique info dictionary or trailing data')
    return root


def decode(value):
    if not isinstance(value, bytes):
        raise ValueError('Expected byte string filename')
    return value.decode('utf-8', errors='strict')


def describe(path):
    if path.stat().st_size > 20 * 1024 * 1024:
        raise ValueError('Torrent exceeds 20 MiB')
    raw = path.read_bytes()
    root = parse_torrent(raw)
    info = root[b'info']
    name = decode(info.get(b'name.utf-8', info.get(b'name')))
    if name in {'', '.', '..'} or '/' in name or '\\' in name:
        raise ValueError('Unsafe torrent content name')
    files = []
    if b'files' in info:
        for item in info[b'files']:
            parts = [decode(part) for part in item.get(b'path.utf-8', item.get(b'path'))]
            if not parts or any(part in {'', '.', '..'} or '/' in part or '\\' in part for part in parts):
                raise ValueError('Unsafe torrent content path')
            files.append({'path': '/'.join([name, *parts]), 'name': parts[-1], 'size_bytes': item[b'length']})
    else:
        files.append({'path': name, 'name': name, 'size_bytes': info[b'length']})
    if any(not isinstance(item['size_bytes'], int) or item['size_bytes'] < 0 for item in files):
        raise ValueError('Invalid content size')
    total = sum(item['size_bytes'] for item in files)
    source = SOURCE.match(path.name)
    gallery = None
    if source:
        site, gid, token = source.groups()
        host = 'exhentai.org' if site.upper() == 'EX' else 'e-hentai.org'
        gallery = {'site': site.upper(), 'gid': int(gid), 'token': token.lower(),
                   'url': f'https://{host}/g/{gid}/{token.lower()}/', 'evidence': 'torrent_filename_prefix'}
    return {'torrent_path': str(path), 'torrent_size_bytes': len(raw), 'gallery': gallery,
            'content_name': name, 'files': files, 'total_size_bytes': total}


def filename_key(value):
    # RAR -> ZIP/CBZ is a common local conversion, not a different book.
    # Keep the entire book name, numbering and annotations; remove format only.
    name = unicodedata.normalize('NFC', SOURCE.sub('', value))
    suffix = Path(name).suffix
    if suffix.casefold() in BOOK_EXTS:
        name = name[:-len(suffix)]
    return name.casefold()


def source_key(gallery):
    return gallery['site'], gallery['gid'], gallery['token']


DEFAULT_DIRECTORY = Path.home() / 'Desktop'


def load_index(directory):
    """Read each small torrent once; never enumerate or open a book archive."""
    directory = Path(directory)
    index, errors, count = defaultdict(list), [], 0
    if not directory.is_dir():
        return index, errors, count
    for parent, subdirs, files in os.walk(directory, followlinks=False):
        parent = Path(parent)
        subdirs[:] = sorted(d for d in subdirs if not (parent / d).is_symlink()
                            and not getattr(parent / d, 'is_junction', lambda: False)())
        for name in sorted(files):
            path = parent / name
            if path.suffix.casefold() != '.torrent':
                continue
            try:
                attributes = path.lstat()
                if path.is_symlink() or getattr(attributes, 'st_file_attributes', 0) & getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 0):
                    continue
                torrent = describe(path)
                count += 1
                for content in torrent['files']:
                    index[filename_key(content['name'])].append((torrent, content))
            except (OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
                errors.append({'path': str(path), 'error': str(exc)})
    return index, errors, count


def match(filename, size_bytes, index):
    candidates = index.get(filename_key(filename), [])
    if not candidates:
        return {'state': 'no_match', 'reason': '没有本名一致的种子（已忽略归档格式扩展名）'}
    if any(not torrent['gallery'] for torrent, _ in candidates):
        return {'state': 'source_missing', 'reason': '同名种子缺少 gid/token 来源前缀'}
    galleries = {source_key(torrent['gallery']): torrent['gallery'] for torrent, _ in candidates}
    if len(galleries) != 1:
        return {'state': 'source_conflict', 'reason': '同一本名对应多个来源'}
    return {'state': 'matched', 'gallery': next(iter(galleries.values())),
            'rule': 'book_name_without_format_and_unique_gallery', 'size_bytes': size_bytes,
            'torrent_paths': sorted({torrent['torrent_path'] for torrent, _ in candidates})}


