"""Bounded operational state and cleanup of files created by intake itself."""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
import csv
import io
import os
import re
import time
import traceback
import uuid

CACHE_DAYS = 30
CACHE_FILES = 2000
CACHE_BYTES = 32 * 1024 * 1024
DELETE_DAYS = 30
DELETE_ROWS = 1000
FAILURE_FIELDS = ['filename', 'path', 'kind', 'reason', 'existing_paths', 'library_root', 'recovery']
DELETE_FIELDS = ['time', 'filename', 'path', 'existing_path', 'page_count', 'sampled_pages', 'sample_sha256', 'algorithm']
CACHE_NAMES = {'api': re.compile(r'(?:[1-9]\d*_[0-9a-f]{10}|[0-9a-f]{64})\.json'),
               'search': re.compile(r'[0-9a-f]{64}\.json')}
TEMP_NAME = re.compile(r'\.manga_(?:latest|failures|deleted_duplicates|last_error)_[0-9a-f]{32}\.tmp')


def key(path):
    return str(Path(path).absolute()).replace('\\', '/').rstrip('/').casefold()


def linked(path):
    path = Path(path).absolute()
    return any(p.is_symlink() or p.is_junction() for p in (path, *path.parents))


def atomic(path, raw):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.parent / f'.manga_{path.stem}_{uuid.uuid4().hex}.tmp'
    try:
        with temporary.open('xb') as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def text(path, value):
    atomic(path, value.encode('utf-8-sig'))


def read_csv(path):
    if not Path(path).exists():
        return []
    with Path(path).open(encoding='utf-8-sig', newline='') as stream:
        return list(csv.DictReader(stream))


def csv_bytes(rows, fields):
    stream = io.StringIO(newline='')
    writer = csv.DictWriter(stream, fieldnames=fields, extrasaction='ignore')
    writer.writeheader()
    writer.writerows(rows)
    return stream.getvalue().encode('utf-8-sig')


@contextmanager
def run_lock(project):
    """The OS releases the lock on interruption; the one-byte file is reusable."""
    state = Path(project) / 'state/intake'
    if linked(state):
        raise ValueError('运行状态目录是链接，请使用工具包内的实际目录')
    state.mkdir(parents=True, exist_ok=True)
    stream = (state / 'run.lock').open('a+b')
    acquired = False
    try:
        stream.seek(0, 2)
        if not stream.tell():
            stream.write(b'0')
            stream.flush()
        stream.seek(0)
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            acquired = True
        except OSError as error:
            raise ValueError('已有一批整理正在运行，请等待该批完成') from error
        yield
    finally:
        if acquired:
            stream.seek(0)
            if os.name == 'nt':
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)
        stream.close()


def is_reader_sync_failure(row, project):
    """Recognize typed sync failures and the original state-directory rows."""
    return row.get('kind') == 'reader_sync' or (
        row.get('filename') == '阅读器同步' and bool(row.get('path'))
        and key(row['path']) == key(Path(project) / 'state/intake'))


def update_failures(project, library, processed, failures, libraries=(), moved_paths=None, *, reader_synced=False):
    """Replace processed items, retaining unresolved items from other selections."""
    path = Path(project) / 'state/intake/failures.csv'
    scope, selected = key(library), {key(p) for p in processed}
    moved_paths = {key(source): target for source, target in (moved_paths or {}).items()}
    def current_path(location):
        seen = set()
        while key(location) in moved_paths and key(location) not in seen:
            seen.add(key(location))
            location = moved_paths[key(location)]
        return location
    retained = {}
    available = {}
    for old in read_csv(path):
        location = old.get('path', '')
        if not location:
            continue
        owner = old.get('library_root') or next((str(p) for p in libraries
                if key(location).startswith(key(p) + '/')), str(library))
        owner_key = key(owner)
        if is_reader_sync_failure(old, project):
            # Missing journals alone do not prove a scan was ever persisted.
            if owner_key == scope and reader_synced:
                continue
            old.update(kind='reader_sync', path=str(path.parent), library_root=owner)
            retained[(owner_key, key(path.parent), 'reader_sync')] = old
            continue
        if owner_key != scope:
            if owner_key not in available:
                available[owner_key] = Path(owner).is_dir()
            if not available[owner_key]:
                # An offline drive is unknown, not evidence that its problems are solved.
                old['library_root'] = owner
                retained[(owner_key, key(location), old.get('kind', ''))] = old
                continue
        if key(owner) == scope and (key(location) in selected or not Path(location).exists()):
            # Recovery errors refer to books and are regenerated by recover().
            continue
        if not Path(location).exists() and not (old.get('recovery') and Path(old['recovery']).is_file()):
            continue
        old['library_root'] = owner
        old['existing_paths'] = '\n'.join(current_path(p) for p in old.get('existing_paths', '').splitlines())
        retained[(key(owner), key(location), old.get('kind', ''))] = old
    for failure in failures:
        row = {**failure, 'library_root': str(library),
               'existing_paths': '\n'.join(failure.get('existing_paths', []))}
        retained[(scope, key(row['path']), row.get('kind', ''))] = row
    rows = list(retained.values())
    atomic(path, csv_bytes(rows, FAILURE_FIELDS))
    return len(rows)


def record_deletions(project, deleted=(), *, now=None):
    now = time.time() if now is None else now
    path = Path(project) / 'state/intake/deleted_duplicates.csv'
    original = read_csv(path)
    rows = []
    for row in original:
        try:
            timestamp = datetime.fromisoformat(row['time']).timestamp()
        except (KeyError, ValueError, TypeError):
            continue
        if 0 <= now - timestamp <= DELETE_DAYS * 86400:
            rows.append(row)
    moment = datetime.fromtimestamp(now, timezone.utc).isoformat(timespec='seconds')
    rows.extend({**row, 'time': moment} for row in deleted)
    rows = rows[-DELETE_ROWS:]
    if not rows:
        path.unlink(missing_ok=True)
    elif deleted or rows != original:
        atomic(path, csv_bytes(rows, DELETE_FIELDS))


def remove_unchanged(path, before):
    if linked(path):
        return False
    try:
        current = path.stat()
        if (current.st_size, current.st_mtime_ns, current.st_ino) != (before.st_size, before.st_mtime_ns, before.st_ino):
            return False
        path.unlink()
        return True
    except FileNotFoundError:
        return False


def cleanup(project, cache, *, now=None, max_files=CACHE_FILES, max_bytes=CACHE_BYTES, extra_caches=()):
    now = time.time() if now is None else now
    result = {'cache_removed': 0, 'temporary_removed': 0, 'bytes_removed': 0, 'warnings': []}
    candidates = []
    def remove(path, stat, field):
        try:
            if remove_unchanged(path, stat):
                result[field] += 1
                result['bytes_removed'] += stat.st_size
        except OSError as error:
            result['warnings'].append(f'{path.name}: {error}')
    for cache_folder in (Path(cache), *map(Path, extra_caches)):
        for name, pattern in CACHE_NAMES.items():
            folder = cache_folder / name
            if linked(folder) or not folder.is_dir():
                continue
            for path in folder.iterdir():
                if linked(path) or not path.is_file():
                    continue
                try:
                    stat = path.stat()
                except OSError:
                    continue
                age = max(0, now - stat.st_mtime)
                if path.name.endswith('.tmp') and pattern.fullmatch(path.name[:-4]):
                    if age >= 86400:
                        remove(path, stat, 'temporary_removed')
                elif pattern.fullmatch(path.name):
                    if age > CACHE_DAYS * 86400:
                        remove(path, stat, 'cache_removed')
                    else:
                        candidates.append((path, stat))
    candidates.sort(key=lambda item: item[1].st_mtime_ns, reverse=True)
    kept_count = kept_bytes = 0
    for path, stat in candidates:
        if kept_count >= max_files or kept_bytes + stat.st_size > max_bytes:
            remove(path, stat, 'cache_removed')
        else:
            kept_count += 1
            kept_bytes += stat.st_size
    state = Path(project) / 'state/intake'
    if not linked(state) and state.is_dir():
        for path in state.iterdir():
            if TEMP_NAME.fullmatch(path.name) and not linked(path) and path.is_file():
                try:
                    stat = path.stat()
                    if now - stat.st_mtime >= 86400:
                        remove(path, stat, 'temporary_removed')
                except OSError as error:
                    result['warnings'].append(f'{path.name}: {error}')
        # pending_*.json, their temporary files and service_pause.json are recovery data.
        try:
            record_deletions(project, now=now)
        except (OSError, csv.Error) as error:
            result['warnings'].append('删除记录整理失败：' + str(error))
    return result


def record_error(project, error):
    state = Path(project) / 'state/intake'
    detail = ''.join(traceback.format_exception(error))[-60000:]
    text(state / 'last_error.txt', detail)
    text(state / 'latest.txt', '整理中断：' + str(error) +
         '\n已提交的文件保持；下次运行会恢复尚未完成的事务。详细原因见 last_error.txt。\n')


def clear_error(project):
    state = Path(project) / 'state/intake'
    if not list(state.glob('pending_*')) and not (state / 'service_pause.json').exists():
        (state / 'last_error.txt').unlink(missing_ok=True)
