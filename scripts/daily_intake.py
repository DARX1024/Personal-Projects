"""Incoming ComicInfo -> owner folder -> related local series. No central index."""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import argparse
import base64
import csv
import hashlib
import json
import os
import re
import sys
import uuid
import unicodedata
import zipfile

# Embedded Python can omit the running script directory from sys.path.
sys.path.insert(0, str(Path(__file__).resolve().parent))

import intake_metadata as meta
import intake_reader
import intake_housekeeping as housekeeping
import intake_archives
import intake_inputs
import intake_enrichment
import nhentai_api
import intake_titles as matcher
import series_identity as series

PROJECT = Path(__file__).resolve().parents[1]
BOOK_EXTS = matcher.BOOK_EXTS


class ExistingBookError(ValueError):
    def __init__(self, reason, paths, *, kind='duplicate'):
        super().__init__(reason)
        self.existing_paths = sorted(set(str(p) for p in paths))
        self.kind = kind


def failure_row(filename, path, error):
    row = {'filename': filename, 'path': str(path), 'reason': str(error)}
    if isinstance(error, ExistingBookError):
        row.update(kind=error.kind, existing_paths=error.existing_paths)
    return row


def remap_existing_paths(source, target, failures, exact_copies, pending=()):
    def moved(path):
        return target if intake_reader.key(path) == intake_reader.key(source) else path
    for failure in failures:
        if 'existing_paths' in failure:
            failure['existing_paths'] = [moved(path) for path in failure['existing_paths']]
    for duplicate in exact_copies:
        duplicate['existing_path'] = moved(duplicate['existing_path'])
    for _, error in pending:
        error.existing_paths = [moved(path) for path in error.existing_paths]


def finalize_locations(moves, failures, successes, versions, conversions, exact_copies):
    """Resolve final report references once, including the current row's own moves."""
    locations = {intake_reader.key(source): target for source, target in moves.items()}
    def current(path):
        seen = set()
        while intake_reader.key(path) in locations and intake_reader.key(path) not in seen:
            seen.add(intake_reader.key(path))
            path = locations[intake_reader.key(path)]
        return path
    for row in [*failures, *successes, *versions, *conversions]:
        if row.get('path'):
            row['path'] = current(row['path'])
        if 'existing_paths' in row:
            row['existing_paths'] = [current(p) for p in row['existing_paths']]
    for row in exact_copies:
        row['existing_path'] = current(row['existing_path'])


def safe_name(value):
    substitutions = dict(zip('<>:"/\\|?*', '＜＞：＂／＼｜？＊'))
    value = re.sub(r'[<>:"/\\|?*]', lambda m: substitutions[m[0]], str(value))
    value = re.sub(r'[\x00-\x1f]', ' ', value)
    value = re.sub(r'\s+', ' ', value).strip(' .')
    if not value:
        raise ValueError('题名或归档主体为空')
    if re.fullmatch(r'CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9]', value, re.I):
        value = '_' + value
    if len(value) > 180:
        value = value[:180].rstrip(' .')
    return value


def stamp(path):
    value = Path(path).stat()
    return [value.st_size, value.st_mtime_ns, value.st_dev, value.st_ino]


def checked(path, library):
    path = Path(path).absolute()
    resolved = path.resolve()
    if not resolved.is_relative_to(Path(library).resolve()):
        raise ValueError('本次路径离开漫画库：' + str(path))
    cursor = path
    while cursor != Path(library).absolute():
        if cursor.is_symlink() or getattr(cursor, 'is_junction', lambda: False)():
            raise ValueError('本次路径包含链接目录：' + str(path))
        cursor = cursor.parent
    return path


def page_fingerprint(path, *, expected=None, cache=None, required_manifest=None):
    """Read image directory CRCs/sizes and hash at most three image payloads."""
    before = stamp(path)
    if expected is not None and before != expected:
        raise ValueError('文件在准备后发生变化，未删除：' + str(path))
    key = (intake_reader.key(path), tuple(before))
    if cache is not None and key in cache:
        manifest, sample = cache[key]
        return manifest, sample if required_manifest is None or manifest == required_manifest else None, before
    digest = hashlib.sha256()
    if Path(path).suffix.casefold() in intake_archives.CONVERT_EXTS:
        manifest, value = intake_archives.fingerprint(path, meta.IMAGE_EXTS)
        if stamp(path) != before:
            raise ValueError('归档在哈希读取期间发生变化，未删除：' + str(path))
        if cache is not None:
            cache[key] = (manifest, value)
        return manifest, value if required_manifest is None or manifest == required_manifest else None, before
    digest.update(b'manga-first-three-pages-v1\x00')
    def reading_order(entry):
        name = unicodedata.normalize('NFKC', entry.filename.replace('\\', '/')).casefold()
        return tuple((1, int(part)) if part.isdigit() else (0, part) for part in re.split(r'(\d+)', name))
    with zipfile.ZipFile(path) as archive:
        pages = sorted((entry for entry in archive.infolist() if not entry.is_dir()
                        and Path(entry.filename).suffix.casefold() in meta.IMAGE_EXTS), key=reading_order)
        if not pages:
            raise ValueError('候选压缩包没有支持的图页，未删除：' + str(path))
        manifest = tuple((entry.file_size, entry.CRC) for entry in pages)
        if required_manifest is not None and manifest != required_manifest:
            if stamp(path) != before:
                raise ValueError('文件在目录读取期间发生变化，未删除：' + str(path))
            return manifest, None, before
        sample_pages = pages[:3]
        digest.update(len(sample_pages).to_bytes(1, 'big'))
        for entry in sample_pages:
            digest.update(entry.file_size.to_bytes(8, 'big'))
            with archive.open(entry) as stream:
                while block := stream.read(1024 * 1024):
                    digest.update(block)
    if stamp(path) != before:
        raise ValueError('文件在哈希读取期间发生变化，未删除：' + str(path))
    value = digest.hexdigest()
    if cache is not None:
        cache[key] = (manifest, value)
    return manifest, value, before


def exact_duplicate(book, paths, library, incoming, cache, virtual=None):
    source = checked(book['path'], library)
    if not source.resolve().is_relative_to(Path(incoming).resolve()):
        raise ValueError('删除来源不在本次未分类输入内')
    if stamp(source) != book['read_stamp']:
        raise ValueError('新输入在准备后发生变化，未删除：' + str(source))
    source_manifest = source_hash = None
    for name in paths:
        target = checked(name, library)
        previous = (virtual or {}).get(str(target))
        physical = checked(previous.get('_origin', previous['path']), library) if previous else target
        if (target.resolve().is_relative_to(Path(library).resolve() / '【未分类】')
                or intake_reader.key(physical) == intake_reader.key(source) or not physical.is_file()):
            continue
        if source_hash is None:
            source_manifest, source_hash, _ = page_fingerprint(source, expected=book['read_stamp'], cache=cache)
        target_manifest, target_hash, target_stamp = page_fingerprint(physical, cache=cache, required_manifest=source_manifest)
        if target_manifest == source_manifest and source_hash == target_hash:
            return {'filename': book['filename'], 'path': str(source), 'existing_path': str(target),
                    'source_stamp': book['read_stamp'], 'target_stamp': target_stamp, 'verified_path': str(physical),
                    'page_count': len(source_manifest), 'sampled_pages': min(3, len(source_manifest)),
                    'sample_sha256': source_hash, 'algorithm': 'ZIP image size/CRC + first-three-page SHA-256'}
    return None


def queue_scan(project, library, reader):
    """Persist one scan intent per library before removing any duplicate input."""
    if not reader.enabled:
        return
    ident = hashlib.sha256(intake_reader.key(library).encode('utf-8')).hexdigest()
    journal_path = project / 'state/intake' / ('pending_scan_' + ident + '.json')
    if journal_path not in reader.pending_journals:
        operations = [{'book_id': None, 'library_root': str(library)}]
        meta.save_json(journal_path, {'schema': 'manga.intake-scan.v1', 'phase': 'scan_pending',
                                     'operations': operations})
        reader.queue(operations)
        reader.pending_journals.append(journal_path)


def reader_sync_failure(project, reader, error, recovery=None):
    candidates = ([recovery] if recovery else []) + [*reader.pending_journals,
                  project / 'state/intake/service_pause.json']
    recovery_path = next((str(path) for path in candidates if Path(path).is_file()), '')
    return {'filename': '阅读器同步', 'path': str(project / 'state/intake'), 'kind': 'reader_sync',
            'reason': '入库文件已保留；阅读器刷新待重试：' + str(error), 'recovery': recovery_path}


def delete_exact_duplicate(verified, library, incoming, reader, project):
    source = checked(verified['path'], library)
    target = checked(verified['existing_path'], library)
    if (not source.resolve().is_relative_to(Path(incoming).resolve())
            or target.resolve().is_relative_to(Path(library).resolve() / '【未分类】')):
        raise ValueError('只允许删除本次未分类输入，保留库内副本')
    if stamp(source) != verified['source_stamp'] or stamp(target) != verified['target_stamp']:
        raise ValueError('哈希核验后的文件发生变化，未删除')
    # Keep the matched library copy and its reader records.
    queue_scan(project, library, reader)
    source.unlink()


def scan(root, prefixed_only=False, *, image_folders=False):
    files, skipped = [], 0
    for directory, folders, names in os.walk(root, followlinks=False):
        parent = Path(directory)
        folders[:] = sorted(n for n in folders if not (parent / n).is_symlink()
                            and not getattr(parent / n, 'is_junction', lambda: False)())
        if image_folders and not folders and any(Path(n).suffix.casefold() in meta.IMAGE_EXTS for n in names) and not any(Path(n).suffix.casefold() in BOOK_EXTS for n in names):
            if not prefixed_only or matcher.GALLERY_SOURCE_PREFIX_RE.match(parent.name):
                files.append(parent)
            else:
                skipped += 1
            continue
        for name in sorted(names):
            path = parent / name
            if path.suffix.casefold() not in BOOK_EXTS:
                continue
            if prefixed_only and not matcher.GALLERY_SOURCE_PREFIX_RE.match(name):
                skipped += 1
                continue
            files.append(path)
    return files, skipped


def owner(metadata, rules):
    artists, groups = meta.unique(metadata['artists']), meta.unique(metadata['groups'])
    if len(artists) == 1:
        return 'artists', artists[0], meta.canonical(artists[0], 'artists', rules)
    if len(groups) == 1:
        return 'groups', groups[0], meta.canonical(groups[0], 'groups', rules)
    if artists or groups:
        return 'anthology', '【合刊】', 'anthology'
    raise ValueError('没有可确认的作者或社团，请人工补充署名')


def owner_folder(library, metadata, rules):
    role, name, identity = owner(metadata, rules)
    choices = []
    for path in library.iterdir():
        if not path.is_dir() or path.is_symlink() or getattr(path, 'is_junction', lambda: False)():
            continue
        literal = re.sub(r'^【社团】', '', path.name) if role == 'groups' else path.name
        if role == 'anthology' and path.name == name or role != 'anthology' and meta.canonical(literal, role, rules) == identity:
            choices.append(path)
    if len(choices) > 1:
        raise ValueError('有多个同作者／社团目录，请人工选择：' + '；'.join(str(p) for p in choices))
    return choices[0] if choices else library / safe_name(name)


def same_owner(left, right, rules):
    role, _, identity = owner(left, rules)
    if role in {'artists', 'groups'}:
        return any(meta.canonical(n, role, rules) == identity for n in right.get(role, []))
    # Contributors change between anthology issues. The publication title and
    # issue still have to match in the series/duplicate checks below.
    if bool(right.get('artists') or right.get('groups')) and owner(right, rules)[0] == 'anthology':
        return True
    return same_artists(left, right, rules)


def same_artists(left, right, rules):
    a = {meta.canonical(n, 'artists', rules) for n in left.get('artists', [])}
    b = {meta.canonical(n, 'artists', rules) for n in right.get('artists', [])}
    return bool(a) and a == b


def variants(metadata):
    primary = series.split_title(matcher.parse_title(metadata['title'])['core'])
    if primary['state'] == 'ambiguous_requires_review' and metadata.get('series') and metadata.get('number'):
        return [{'base': metadata['series'], 'key': matcher.normalize(metadata['series']),
                 'number': metadata['number'], 'part': ''}]
    if primary['state'] in {'range_requires_review', 'ambiguous_requires_review'}:
        return []
    result = []
    for text in [metadata['title'], *metadata.get('source_titles', {}).values()]:
        if not text:
            continue
        parsed = matcher.parse_title(text)
        for index, fragment in enumerate(re.split(r'[|｜︱]', parsed['core'])):
            scope = series.split_title(fragment)
            if scope['state'] in {'range_requires_review', 'date_requires_review', 'ambiguous_requires_review'}:
                continue
            if primary['number'] and scope['number'] and scope['number'] != primary['number']:
                continue
            base = scope['series'] or scope['title']
            number, part = scope['number'], scope['part']
            if index == 0 and metadata.get('number') and metadata.get('series') and matcher.normalize(text) == matcher.normalize(metadata['title']):
                base, number = metadata['series'], metadata['number']
            item = {'base': base, 'key': matcher.normalize(base), 'number': number, 'part': part}
            if item not in result:
                result.append(item)
    return result


def anchored_variants(metadata, anchors):
    result = variants(metadata)
    if not result:
        return result
    primary = series.split_title(matcher.parse_title(metadata['title'])['core'])
    for anchor in meta.unique(anchors):
        for text in [metadata['title'], *metadata.get('source_titles', {}).values()]:
            for fragment in re.split(r'[|｜︱]', matcher.parse_title(text)['core']):
                scope = series.match_title_anchor(fragment, anchor)
                if scope is None or primary['number'] and scope['number'] and primary['number'] != scope['number']:
                    continue
                item = {'base': anchor, 'key': matcher.normalize(anchor),
                        'number': scope['number'], 'part': scope['part']}
                if item not in result:
                    result.append(item)
    return result


def work_keys(metadata):
    primary = series.split_title(matcher.parse_title(metadata['title'])['core'])
    if primary['state'] == 'range_requires_review':
        return {('title:' + matcher.normalize(primary['title']), '', '')}
    manual_number = metadata.get('number', '')
    part = primary['part'] or (series.canonical_part(manual_number) if manual_number in series.PART_RANK else '')
    number = (manual_number if metadata.get('series') and manual_number not in series.PART_RANK else '') or primary['number'] or (manual_number if manual_number not in series.PART_RANK else '')
    keys = set()
    for variant in variants(metadata):
        if number and variant['number'] and variant['number'] != number:
            continue
        variant_number = '' if variant['number'] in series.PART_RANK else variant['number']
        keys.add((variant['key'], variant_number or number, variant['part'] or part))
    for text in [metadata['title'], *metadata.get('source_titles', {}).values()]:
        if not text:
            continue
        for fragment in re.split(r'[|｜︱]', matcher.parse_title(text)['core']):
            scope = series.split_title(fragment)
            if number and scope['number'] and scope['number'] != number:
                continue
            keys.add(('title:' + matcher.normalize(scope['title']), scope['number'] or number, scope['part'] or part))
    return keys


def same_source_work(left, right):
    if not set(meta.LINK.findall(left.get('web', ''))) & set(meta.LINK.findall(right.get('web', ''))):
        return False
    a, b = (series.split_title(matcher.parse_title(m['title'])['core']) for m in (left, right))
    if a['state'] == 'range_requires_review' or b['state'] == 'range_requires_review':
        return a['state'] == b['state'] and matcher.normalize(a['title']) == matcher.normalize(b['title'])
    same_family = matcher.normalize(a['series']) == matcher.normalize(b['series'])
    different_number = a['number'] and b['number'] and a['number'] != b['number']
    different_part = a['part'] and b['part'] and a['part'] != b['part']
    return not (different_number or same_family and different_part)


def report_existing(book, existing, rules):
    wanted = work_keys(book['metadata'])
    paths = [old.get('_virtual') or old['path'] for old in existing
             if intake_reader.key(old.get('_virtual') or old['path']) != intake_reader.key(book['path'])
             and same_owner(book['metadata'], old['metadata'], rules)
             and (wanted & work_keys(old['metadata']) or same_source_work(book['metadata'], old['metadata']))]
    if paths:
        raise ExistingBookError('已有同作品／同分册或相同来源条目；新输入保留原位，请人工选择版本', paths)


def filename(book):
    metadata = book['metadata']
    # Keep local language, translation and version annotations as readable suffixes.
    unknown = book['parsed'].get('unknown_suffixes', [])
    suffixes = meta.unique(book['parsed'].get('ignored_suffixes', []) + list(unknown))
    suffixes.sort(key=lambda s: book['parsed']['original'].rfind('[' + s + ']'))
    suffix = ''.join(' [' + s + ']' for s in meta.unique(suffixes)
                     if (matcher.NOISE_RE.search(s) or matcher.recognized_annotation(s) or s in unknown) and '[' + s + ']' not in metadata['title'])
    return safe_name(metadata['title'] + suffix) + '.cbz'


def operation(book, target, library, *, old=False):
    metadata = book['metadata']
    xml = meta.render_xml(book, metadata, None if old else book.get('dictionary'), series_only=old)
    return {'source': book['path'], 'target': str(target), 'library_root': str(library),
            'before': book['read_stamp'], 'xml': xml.decode('utf-8') if xml != book['old_xml'] or book.get('folder_files') else None,
            'old_xml': base64.b64encode(book['old_xml']).decode() if book['old_xml'] else None,
            'series': metadata.get('series', ''), 'title': metadata['title'],
            'number': metadata.get('number', ''), 'volume': metadata.get('volume', ''),
            'converted': bool(book.get('folder_files')) or Path(book['path']).suffix.casefold() in intake_archives.CONVERT_EXTS,
            **({'folder_files': book['folder_files']} if book.get('folder_files') else {})}


def visible_books(folder, virtual):
    books = []
    if folder.is_dir() and not folder.is_symlink() and not getattr(folder, 'is_junction', lambda: False)():
        for path in sorted(folder.iterdir()):
            if str(path) in virtual:
                continue
            if path.suffix.casefold() not in {'.zip', '.cbz'} or not path.is_file() or path.is_symlink():
                continue
            try:
                books.append(meta.read_archive(path))
            except (OSError, ValueError, zipfile.BadZipFile, meta.ET.ParseError):
                continue
    books.extend(previous for path, previous in virtual.items() if previous is not None and Path(path).parent == folder)
    return books


def occupied(path, virtual):
    return virtual[str(path)] is not None if str(path) in virtual else os.path.lexists(path)


def version_target(path, virtual):
    if not occupied(path, virtual):
        return path
    for number in range(2, 10000):
        candidate = path.with_name(path.stem + f' [版本{number}]' + path.suffix)
        if not occupied(candidate, virtual):
            return candidate
    raise ValueError('同名版本过多，请人工调整题名')


def placement(book, library, rules, *, metadata_only=False, in_place=False, virtual=None, merge_series=True, allow_versions=False):
    virtual = virtual or {}
    if in_place and not metadata_only:
        source = Path(book['path'])
        target = source.parent / filename(book)
        if target != source:
            target = version_target(target, virtual)
        return [operation(book, target, library)]
    if metadata_only:
        target = Path(book['path'])
        if book.get('folder_files'):
            target = version_target(target.parent / (target.name + '.cbz'), virtual)
        if target.suffix.casefold() in intake_archives.CONVERT_EXTS:
            target = version_target(target.with_suffix('.cbz'), virtual)
        return [operation(book, target, library)]
    metadata = book['metadata']
    scope = series.split_title(matcher.parse_title(metadata['title'])['core'])
    if scope['state'] == 'ambiguous_requires_review' and not (metadata.get('series') and metadata.get('number')):
        raise ExistingBookError('重复题名中的卷号互相冲突，请人工确认 Series／Number', [], kind='series_review')
    folder = owner_folder(library, metadata, rules)
    proposed = variants(metadata)
    candidates = {}
    # Only the current owner and explicitly credited groups; no full-library walk.
    folders = {str(folder): folder}
    if len(metadata['artists']) > 1:
        for group in metadata['groups']:
            alternative = owner_folder(library, {**metadata, 'artists': [], 'groups': [group]}, rules)
            folders[str(alternative)] = alternative
        alternative = library / '【合刊】'
        folders[str(alternative)] = alternative
    directories = []
    for parent in folders.values():
        if parent.is_dir():
            directories.extend(path for path in parent.iterdir()
                if path.is_dir() and path.name != '_oneshots' and not path.is_symlink()
                and not getattr(path, 'is_junction', lambda: False)())
    for path, previous in virtual.items():
        parent = Path(path).parent
        if previous is not None and str(parent.parent) in folders and parent.name != '_oneshots' and parent not in directories:
            directories.append(parent)
    proposed = anchored_variants(metadata, [path.name for path in directories])
    for path in directories:
        if metadata.get('series') and matcher.normalize(path.name) != matcher.normalize(metadata['series']):
            continue
        if any(matcher.normalize(path.name) == v['key'] for v in proposed):
            if path.parent != folder:
                registered = visible_books(path, virtual)
                if not registered:
                    raise ExistingBookError('相关社团存在同名系列，但没有可核对的作者信息，请人工确认归属', [path], kind='series_review')
                if not any(same_artists(metadata, old['metadata'], rules) for old in registered):
                    continue
                if any(not same_artists(metadata, old['metadata'], rules) for old in registered):
                    raise ExistingBookError('相关社团的同名系列作者不一致，请人工确认归属', [path], kind='series_review')
            candidates[str(path)] = path
    if len(candidates) > 1:
        raise ExistingBookError('新本对应多个已有系列目录，请人工指定 Series 和归属', list(candidates), kind='series_review')
    selected = next(iter(candidates.values()), None)
    related, best = [], None
    existing = []
    parents = {folder, selected.parent} if selected is not None else {folder}
    for parent in parents:
        singles = parent / '_oneshots'
        existing.extend(old for old in visible_books(singles, virtual)
                        if same_owner(metadata, old['metadata'], rules)
                        and (parent == folder or same_artists(metadata, old['metadata'], rules)))
    anchors = [v['base'] for v in proposed if v['number'] or v['part']]
    anchors.extend(v['base'] for old in existing for v in variants(old['metadata']) if v['number'] or v['part'])
    proposed = anchored_variants(metadata, [*anchors, *[path.name for path in candidates.values()]])
    if merge_series:
        choices = {}
        for candidate in proposed:
            matches = [(old, v) for old in existing for v in anchored_variants(old['metadata'], [candidate['base']])
                       if v['key'] == candidate['key']]
            scopes = {(candidate['number'], candidate['part']), *( (v['number'], v['part']) for _, v in matches )}
            anchored = selected is not None and matcher.normalize(selected.name) == candidate['key']
            if matches and (anchored or series.multiple_issues(scopes)):
                if selected is None or anchored:
                    choices[candidate['key']] = (candidate, matches)
        memberships = {frozenset(old['path'] for old, _ in matches) for _, matches in choices.values()}
        if len(memberships) > 1:
            raise ExistingBookError('题名可以匹配多个单篇家族，请人工指定 Series',
                                    [old['path'] for _, matches in choices.values() for old, _ in matches], kind='series_review')
        if choices:
            best, matches = next(iter(choices.values()))
            related = list({old['path']: (old, v) for old, v in matches}.values())
            if selected is None:
                selected = folder / safe_name(best['base'])
    if selected is not None:
        registered = visible_books(selected, virtual)
        if not allow_versions:
            report_existing(book, [*existing, *registered], rules)
        best = best or next(v for v in proposed if v['key'] == matcher.normalize(selected.name))
        book['metadata'].update(series=selected.name, number=best['number'] or best['part'])
        operations = []
        reserved = dict(virtual)
        for old, variant in related:
            old['metadata'].update(series=selected.name, number=variant['number'] or variant['part'])
            old_source = old.get('_virtual') or old['path']
            old_target = version_target(selected / Path(old_source).name, reserved)
            reserved[str(old_target)] = old
            if old.get('_virtual'):
                operations.append({'source': old['_virtual'], 'target': str(old_target),
                                   'series': selected.name, 'number': old['metadata']['number'], 'virtual_source': True})
            else:
                operations.append(operation(old, old_target, library, old=True))
        target = selected / filename(book)
    else:
        if not allow_versions:
            report_existing(book, existing, rules)
        book['metadata'].update(series='')
        operations = []
        target = folder / '_oneshots' / filename(book)
        reserved = virtual
    if allow_versions:
        target = version_target(target, reserved)
    operations.append(operation(book, target, library))
    targets = set()
    for entry in operations:
        checked(entry['source'], library)
        checked(entry['target'], library)
        target_key = intake_reader.key(entry['target'])
        if target_key in targets:
            raise ExistingBookError('本次系列组合有同名文件，请人工保留版本或重命名', [entry['target']], kind='name_conflict')
        targets.add(target_key)
        if target_key != intake_reader.key(entry['source']) and (os.path.lexists(entry['target']) and virtual.get(entry['target'], True) is not None
                                                               or virtual.get(entry['target']) is not None):
            raise ExistingBookError('目标文件名已存在；未判定为内容重复，请人工保留版本或重命名', [entry['target']], kind='name_conflict')
    return operations


def append_xml(path, xml):
    """Append a new directory and XML at EOF; original bytes remain recoverable."""
    raw = xml.encode('utf-8')
    original = Path(path).stat()
    with Path(path).open('r+b') as stream:
        stream.seek(0, 2)
        length = stream.tell()
        archive = None
        try:
            archive = zipfile.ZipFile(stream, 'a', allowZip64=True)
            archive.filelist = [i for i in archive.filelist if Path(i.filename.replace('\\', '/')).name.casefold() != 'comicinfo.xml']
            archive.NameToInfo = {i.filename: i for i in archive.filelist}
            archive.start_dir = length
            stream.seek(length)
            archive.writestr('ComicInfo.xml', raw, compress_type=zipfile.ZIP_STORED)
            archive.close()
            archive = None
            stream.flush()
            os.fsync(stream.fileno())
        except BaseException:
            if archive is not None:
                archive.close()
            stream.truncate(length)
            stream.flush()
            os.fsync(stream.fileno())
            os.utime(path, ns=(original.st_atime_ns, original.st_mtime_ns))
            raise


def rollback(operations):
    for entry in reversed(operations):
        source, target = Path(entry['source']), Path(entry['target'])
        if entry.get('converted'):
            intact = intake_inputs.files(source) == entry['folder_files'] if entry.get('folder_files') and source.is_dir() else source.is_file() and stamp(source) == entry['before']
            if not intact:
                raise ValueError('原输入被外部修改或移走，保留转换现场：' + str(source))
            temporary = checked(entry['conversion_temp'], entry['library_root']) if entry.get('conversion_temp') else None
            if temporary and not re.fullmatch(r'\.manga_convert_[0-9a-f]{32}\.tmp', temporary.name):
                raise ValueError('转换临时文件名不属于本程序，保留恢复记录')
            for current in [target, temporary]:
                if current and current.is_file():
                    if current == target and stamp(current) != entry.get('converted_stamp'):
                        raise ValueError('转换目标被外部修改，保留现场：' + str(current))
                    current.unlink()
            continue
        current = source if source.exists() else target
        if not current.is_file():
            raise ValueError('恢复时文件不存在：' + str(source))
        actual = stamp(current)
        before = entry['before']
        if actual[2:] != before[2:] or actual[0] < before[0]:
            raise ValueError('本次文件被外部替换，保留现场：' + str(current))
        if actual[0] != before[0]:
            if entry['xml'] is None or meta.read_archive(current)['old_xml'] != entry['xml'].encode('utf-8'):
                raise ValueError('本次文件被外部编辑，保留现场：' + str(current))
        elif actual != before:
            raise ValueError('本次文件被外部编辑，保留现场：' + str(current))
        if source.exists() and target.exists() and intake_reader.key(source) != intake_reader.key(target) and stamp(target)[2:] == before[2:]:
            target.unlink()  # Recover a interrupted link/unlink move on non-Windows.
        if intake_reader.key(current) != intake_reader.key(source):
            if source.exists():
                raise ValueError('原位置已有文件，保留现场：' + str(source))
            current.rename(source)
        if entry['xml'] is not None and source.stat().st_size != before[0]:
            with source.open('r+b') as stream:
                stream.truncate(before[0])
                stream.flush()
                os.fsync(stream.fileno())
            os.utime(source, ns=(source.stat().st_atime_ns, before[1]))


def finalize_conversions(operations):
    for entry in operations:
        if not entry.get('converted'):
            continue
        source, target = Path(entry['source']), Path(entry['target'])
        if not target.is_file():
            raise ValueError('转换结果不存在，保留原归档')
        if stamp(target) != entry.get('converted_stamp'):
            raise ValueError('转换目标在提交后被修改，保留恢复记录')
        if source.exists():
            if entry.get('folder_files'):
                intake_inputs.cleanup_original(source, target, entry['folder_files'], entry['folder_payloads'])
                continue
            if stamp(source) != entry['before']:
                raise ValueError('原归档在转换后被修改，保留原档及恢复记录：' + str(source))
            source.unlink()


def prepare_conversion(entry, project):
    target = checked(entry['target'], entry['library_root'])
    checked(target.parent, entry['library_root']).mkdir(parents=True, exist_ok=True)
    entry['conversion_temp'] = str(target.parent / ('.manga_convert_' + uuid.uuid4().hex + '.tmp'))
    pending = project / 'state/intake' / ('pending_' + uuid.uuid4().hex + '.json')
    entry['conversion_journal'] = str(pending)
    journal = {'schema': 'manga.intake-transaction.v2', 'phase': 'prepared', 'operations': [entry]}
    meta.save_json(pending, journal)
    try:
        print('自动转换并核验：' + Path(entry['source']).name, flush=True)
        if entry.get('folder_files'):
            entry['folder_payloads'] = intake_inputs.pack(entry['source'], entry['conversion_temp'], entry['folder_files'])
        else:
            intake_archives.convert(entry['source'], entry['conversion_temp'], expected=entry['before'])
        if entry['xml'] is not None:
            append_xml(entry['conversion_temp'], entry['xml'])
        entry['converted_stamp'] = stamp(entry['conversion_temp'])
        meta.save_json(pending, journal)
    except BaseException:
        rollback([entry])
        pending.unlink()
        raise


def execute(operations, project, reader):
    pending = project / 'state' / 'intake' / ('pending_' + uuid.uuid4().hex + '.json')
    for entry in operations:
        if stamp(entry['source']) != entry['before'] or entry.get('folder_files') and intake_inputs.files(entry['source']) != entry['folder_files']:
            raise ValueError('本次文件在准备后发生变化，请重试：' + entry['source'])
        if intake_reader.key(entry['source']) != intake_reader.key(entry['target']) and os.path.lexists(entry['target']):
            raise ExistingBookError('提交时目标文件名已被占用', [entry['target']], kind='name_conflict')
    for entry in operations:
        if entry.get('converted'):
            if not entry.get('conversion_temp'):
                prepare_conversion(entry, project)
            if stamp(entry['conversion_temp']) != entry['converted_stamp']:
                raise ValueError('已核验的转换临时文件发生变化，保留原归档')
    reader.bind(operations)
    journal = {'schema': 'manga.intake-transaction.v2', 'phase': 'prepared',
               'operations': operations, 'reader_required': reader.enabled}
    meta.save_json(pending, journal)
    for entry in operations:
        if entry.get('conversion_journal'):
            prepared_journal = Path(entry['conversion_journal'])
            if (prepared_journal.parent != project / 'state/intake'
                    or not re.fullmatch(r'pending_[0-9a-f]{32}\.json', prepared_journal.name)):
                raise ValueError('转换准备记录不属于本程序')
            prepared_journal.unlink(missing_ok=True)
    database_committed = False
    try:
        for entry in operations:
            source, target = Path(entry['source']), Path(entry['target'])
            if entry.get('converted'):
                temporary = checked(entry['conversion_temp'], entry['library_root'])
                if os.path.lexists(target):
                    raise ExistingBookError('提交时转换目标文件名已被占用', [str(target)], kind='name_conflict')
                temporary.rename(target)
                continue
            if entry['xml'] is not None:
                append_xml(source, entry['xml'])
            if intake_reader.key(source) != intake_reader.key(target):
                checked(target.parent, entry['library_root']).mkdir(parents=True, exist_ok=True)
                if os.path.lexists(target):
                    raise ExistingBookError('提交时目标文件名已被占用', [target], kind='name_conflict')
                if os.name == 'nt':
                    source.rename(target)
                else:
                    os.link(source, target)
                    source.unlink()
        journal['phase'] = 'files_ready'
        meta.save_json(pending, journal)
        outcome = reader.apply(operations)
        database_committed = True
        journal.update(phase='committed', series_ids=outcome.get('affected_series_ids', []))
        meta.save_json(pending, journal)
        finalize_conversions(operations)
        reader.queue(operations, journal['series_ids'])
        if reader.enabled:
            reader.pending_journals.append(pending)
        else:
            pending.unlink()
    except BaseException:
        if not database_committed:
            rollback(operations)
            pending.unlink()
        raise


def recover(project, library, reader):
    failures, blocked = [], set()
    for path in sorted((project / 'state' / 'intake').glob('pending_*.json')):
        journal = json.loads(path.read_bytes())
        operations = journal.get('operations', [])
        if not operations or intake_reader.key(operations[0]['library_root']) != intake_reader.key(library):
            continue
        if journal.get('phase') == 'scan_pending':
            if reader.enabled:
                reader.queue([{'book_id': None, 'library_root': str(library)}])
                reader.pending_journals.append(path)
            else:
                failures.append(reader_sync_failure(project, reader, '阅读器同步未启用，保留待同步任务', path))
            continue
        try:
            for entry in operations:
                checked(entry['source'], library)
                checked(entry['target'], library)
            if journal['phase'] == 'committed' or journal['phase'] == 'files_ready' and reader.committed(operations):
                # Older journals encode reader participation through bind()'s book_id keys.
                reader_required = journal.get('reader_required', any('book_id' in entry for entry in operations))
                if reader_required and not reader.enabled:
                    failures.append(reader_sync_failure(project, reader, '阅读器同步未启用，保留待同步任务', path))
                    continue
                finalize_conversions(operations)
                reader.queue(operations, journal.get('series_ids', []))
                if reader.enabled:
                    reader.pending_journals.append(path)
                    continue
            else:
                rollback(operations)
            path.unlink()
        except Exception as error:
            blocked.update(intake_reader.key(o['source']) for o in operations)
            failures.append({'filename': Path(operations[-1]['source']).name, 'path': operations[-1]['source'],
                             'reason': '本次中断恢复需人工处理：' + str(error), 'recovery': str(path)})
    return failures, blocked


def resolve_pairs(book, sources, root):
    keys = [book['path'], Path(book['path']).relative_to(root).as_posix(), book['filename']]
    for key in keys:
        if key in sources:
            values = sources[key] if isinstance(sources[key], list) else [sources[key]]
            pairs = [(int(g), t.lower()) for v in values if isinstance(v, str) for g, t in meta.LINK.findall(v)]
            nh_ids = list(dict.fromkeys(int(g) for v in values if isinstance(v, str) for g in meta.NH_LINK.findall(v)))
            if pairs and nh_ids:
                raise ValueError('人工来源请使用同一平台的链接')
            if nh_ids:
                book['nhentai_source_ids'] = nh_ids
                return []
            if not pairs:
                raise ValueError('人工提供的来源链接没有有效 EH gid/token 或 nhentai 编号')
            return pairs
    if book['source_pairs']:
        return book['source_pairs']
    nh_ids = book.get('nhentai_ids') or [int(g) for g in meta.NH_LINK.findall(book['metadata'].get('web', ''))]
    if nh_ids:
        book['nhentai_source_ids'] = list(dict.fromkeys(nh_ids))
        return []
    parsed = book['parsed']
    if parsed.get('source_url_hint'):
        return [(parsed['gid_hint'], parsed['gallery_token_hint'])]
    return []


def prepare(paths, args, rules, dictionary, sources, torrent_index, resolver):
    ready, failures, lookup_books = [], [], []
    for path in paths:
        try:
            if not path.is_dir() and path.suffix.casefold() not in {'.zip', '.cbz'} | intake_archives.CONVERT_EXTS:
                raise ValueError('当前入库支持 ZIP/CBZ，并自动转换 RAR/CBR/7z/CB7；该格式请人工处理')
            book = meta.read_archive(checked(path, args.library_root))
            book['dictionary'] = dictionary
            if getattr(args, 'collection_authors', None):
                import intake_collections
                ready.append(intake_collections.prepare(book, args._collection_authors[intake_reader.key(path)], rules))
                continue
            import intake_collections
            if intake_collections.known_collection(book, include_platform_title=args.metadata_only):
                ready.append(intake_collections.prepare_for_mode(book, rules, metadata_only=args.metadata_only))
                continue
            meta.fill_local_fields(book, dictionary)
            if args.in_place:
                intake_inputs.location_context(book, args.library_root)
            metadata = book['metadata']
            # Existing ComicInfo is authoritative, including manual changes.
            complete = (book['old_xml'] and metadata['title'] and (metadata['artists'] or metadata['groups'])
                        and metadata['language'] and metadata['tags'])
            supplied = any(k in sources for k in (book['path'], book['filename'], path.relative_to(args.root).as_posix()))
            if complete and not args.refresh and not supplied:
                ready.append(book)
                continue
            book['source_override'] = supplied
            book['pairs'] = resolve_pairs(book, sources, args.root)
            if not book['pairs'] and torrent_index:
                import torrent_sources
                decision = torrent_sources.match(path.name, path.stat().st_size, torrent_index)
                if decision['state'] == 'matched':
                    gallery = decision['gallery']
                    book['pairs'] = [(gallery['gid'], gallery['token'])]
            lookup_books.append(book)
        except Exception as error:
            failures.append({'filename': path.name, 'path': str(path), 'reason': str(error)})
    if args.plan_online:
        for book in lookup_books:
            ready.append(resolver.plan(book))
        return ready, failures
    if lookup_books:
        resolver.prefetch(lookup_books)
    for book in lookup_books:
        try:
            result = resolver.resolve(book, rules)
            if result['status'] == 'not_found' and intake_collections.known_collection(book):
                ready.append(intake_collections.prepare_for_mode(book, rules, metadata_only=args.metadata_only))
                continue
            if result['status'] != 'matched':
                raise ValueError(result['reason'])
            metadata = result['metadata']
            book['source_override'] = book.get('source_override', False) or result.get('replace_source', False)
            book['metadata_resolution'] = {k:v for k,v in result.items() if k != 'metadata'}
            book['metadata'] = metadata
            if not args.in_place:
                owner(metadata, rules)
            ready.append(book)
        except Exception as error:
            failures.append({'filename': book['filename'], 'path': book['path'], 'reason': str(error)})
    return ready, failures


def apply_virtual(operations, book, virtual):
    for entry in operations[:-1]:
        previous = virtual.get(entry['source']) or meta.read_archive(entry['source'])
        previous = {**previous, 'metadata': deepcopy(previous['metadata'])}
        previous['_origin'] = previous.get('_origin', previous['path'])
        previous['_virtual'] = entry['target']
        previous['metadata'].update(series=entry['series'], number=entry['number'])
        if entry.get('virtual_source'):
            previous['old_xml'] = previous.get('_planned_xml', previous['old_xml'])
            previous['_planned_xml'] = meta.render_xml(previous, previous['metadata'], series_only=True)
        else:
            previous['_planned_xml'] = entry['xml'].encode('utf-8') if entry['xml'] is not None else previous['old_xml']
        if entry['source'] != entry['target']:
            virtual[entry['source']] = None
        virtual[entry['target']] = previous
    previous = {**book, 'metadata': deepcopy(book['metadata'])}
    previous['_origin'] = book['path']
    previous['_virtual'] = operations[-1]['target']
    previous['_planned_xml'] = operations[-1]['xml'].encode('utf-8') if operations[-1]['xml'] is not None else book['old_xml']
    virtual[operations[-1]['target']] = previous


def plan_batch(ready, args, library, rules, virtual, hash_cache):
    """One planning and fingerprinting path for both preview and commit."""
    decisions, failures, copies = [], [], []
    for prepared in ready:
        book = {**prepared, 'metadata': deepcopy(prepared['metadata'])}
        versions = []
        try:
            options = dict(metadata_only=args.metadata_only, in_place=args.in_place, virtual=virtual, merge_series=not args.no_series_merge)
            try:
                operations = placement(book, library, rules, **options)
            except ExistingBookError as error:
                if error.kind != 'duplicate' or args.keep_duplicates:
                    raise
                verified = exact_duplicate(book, error.existing_paths, library, args.root, hash_cache, virtual)
                if verified:
                    copies.append(verified)
                    continue
                versions = error.existing_paths
                operations = placement(book, library, rules, allow_versions=True, **options)
            for entry in operations[:-1]:
                remap_existing_paths(entry['source'], entry['target'], failures, copies)
                for prior in decisions:
                    if prior['target'] == entry['source']:
                        prior['target'] = entry['target']
                    prior['existing_paths'] = [entry['target'] if path == entry['source'] else path for path in prior['existing_paths']]
            apply_virtual(operations, book, virtual)
            decisions.append({'filename': book['filename'], 'source': book['path'],
                'target': operations[-1]['target'], 'operations': operations, 'existing_paths': versions,
                'metadata_resolution': book.get('metadata_resolution', {})})
        except Exception as error:
            failures.append(failure_row(book['filename'], book['path'], error))
    return decisions, failures, copies


def materialize(operations, library, committed_stamps):
    actual = []
    for proposed in operations:
        entry = dict(proposed)
        if entry.get('virtual_source'):
            expected = committed_stamps.get(intake_reader.key(entry['source']))
            if expected is None or stamp(entry['source']) != expected:
                raise ValueError('本批先前归档的文件未提交或发生变化，保留新输入：' + entry['source'])
            old = meta.read_archive(entry['source'])
            old['metadata'].update(series=entry['series'], number=entry['number'])
            entry = operation(old, Path(entry['target']), library, old=True)
        actual.append(entry)
    return actual


def _run(args, *, project=None, reader_factory=None):
    project = Path(project or PROJECT)
    cfg = json.loads((project / 'config.json').read_bytes()) if (project / 'config.json').is_file() else {}
    if args.in_place and args.root is None:
        raise ValueError('--in-place 需要显式指定 --root 子目录')
    if args.root is None:
        name = getattr(args, 'library', 'H')
        configured = cfg.get('libraries', {}).get(name, {}).get('root')
        if not configured:
            raise ValueError('书库未配置，请复制 config.example.json 为 config.json 并修改路径，或指定 --root 和 --library-root：' + name)
        args.root = Path(configured) / '【未分类】'
    args.root = Path(args.root).resolve()
    if not args.root.is_dir():
        raise ValueError('输入目录不存在：' + str(args.root))
    libraries = [Path(v['root']).resolve() for v in cfg.get('libraries', {}).values()]
    library = Path(args.library_root).resolve() if args.library_root else next((p for p in libraries if args.root.is_relative_to(p)), args.root.parent)
    if args.root == library or not args.root.is_relative_to(library):
        raise ValueError('输入必须是库内指定子目录，不允许整库处理')
    if not args.in_place and not args.root.is_relative_to(library / '【未分类】'):
        raise ValueError('已归位目录请使用 --in-place；日常输入仍为【未分类】')
    args.library_root = library
    if getattr(args, 'collection_authors', None):
        if not (args.in_place and args.metadata_only and args.no_series_merge and args.keep_duplicates and args.offline):
            raise ValueError('图集作者清单需要 --in-place --metadata-only --no-series-merge --keep-duplicates --offline')
        if args.sources or args.sources_only or args.refresh or args.series_tags or args.hash_lookup or args.plan_online:
            raise ValueError('图集作者模式不能同时检索来源、借用标签或改动来源身份')
        if list((project / 'state/intake').glob('pending_*.json')) or (project / 'state/intake/service_pause.json').exists():
            raise ValueError('存在其他未完成维护事务，请先处理原任务')
        import intake_collections
        args._collection_authors = intake_collections.load_manifest(args.collection_authors, args.root)
    rules = meta.aliases([project / 'data/rules/creator_aliases.json', *args.creator_aliases])
    sources = json.loads(Path(args.sources).read_bytes()) if args.sources else {}
    if not isinstance(sources, dict):
        raise ValueError('来源文件须为 文件名或路径 -> 画廊链接 的映射')
    dictionary = meta.tag_translation.Dictionary(project / 'data/translations/db.text.json') if args.tag_language == 'zh' else None
    cache = Path(args.cache_root or project / 'cache/ehentai')
    client = meta.ApiClient(cache / 'api', offline=args.offline, refresh=args.refresh)
    searcher = meta.lookup.SearchClient(cache / 'search', meta.save_json, offline=args.offline,
                                      cache_hours=0 if args.refresh else 168, empty_hours=0 if args.refresh else 12)
    settings = dict(cfg.get('komga', {})) if intake_reader.key(library) in {intake_reader.key(p) for p in libraries} else {}
    settings['_state_dir'] = str(project / 'state/intake')
    reader = (reader_factory or intake_reader.Reader)(settings)
    nh_client = nhentai_api.Client(cache / 'nhentai' / 'api', offline=args.offline, refresh=args.refresh)
    resolver = intake_enrichment.Resolver(client, searcher, nh_client, series_tags=args.series_tags, hash_lookup=args.hash_lookup)
    paths, skipped = scan(args.root, args.prefixed_only, image_folders=args.in_place)
    failures, successes, plans, exact_copies, versions, conversions = [], [], [], [], [], []
    hash_cache = {}  # Only this run's matched candidates; never a library hash index.
    torrent_index = {}
    if args.torrent_dir and not args.plan_online and not getattr(args, 'collection_authors', None):
        import torrent_sources
        torrent_index, _, _ = torrent_sources.load_index(args.torrent_dir)
    blocked = set()
    virtual = {}
    moved_paths = {}
    pending_journals = list((project / 'state/intake').glob('pending_*.json'))
    if (project / 'state/intake/service_pause.json').exists() and not args.dry_run and not args.plan_online:
        with reader.paused():
            pass
    if pending_journals and not args.dry_run and not args.plan_online:
        with reader.paused():
            recovered, blocked = recover(project, library, reader)
            failures.extend(recovered)
    if pending_journals and not args.dry_run and not args.plan_online:
        paths, skipped = scan(args.root, args.prefixed_only, image_folders=args.in_place)
    paths = [p for p in paths if intake_reader.key(p) not in blocked]
    if getattr(args, 'collection_authors', None):
        selected = [p for p in paths if intake_reader.key(p) in args._collection_authors]
        skipped += len(paths) - len(selected)
        paths = selected
    if args.sources_only:
        if not args.sources:
            raise ValueError('--sources-only 需要同时提供 --sources')
        selected = [p for p in paths if any(k in sources for k in
                    (str(p), p.relative_to(args.root).as_posix(), p.name))]
        skipped += len(paths) - len(selected)
        paths = selected
    for offset in range(0, len(paths), 100):
        selection = paths[offset:offset + 100]
        print(f'准备第 {offset // 100 + 1} 批：{len(selection)} 本（共 {len(paths)} 本）。', flush=True)
        ready, rejected = prepare(selection, args, rules, dictionary, sources, torrent_index, resolver)
        failures.extend(rejected)
        if args.plan_online:
            plans.extend(ready)
            continue
        decisions, rejected, copies = plan_batch(ready, args, library, rules, virtual, hash_cache)
        failures.extend(rejected)
        plans.extend({'filename': row['filename'], 'operations': row['operations'],
                      'metadata_resolution': row.get('metadata_resolution', {})} for row in decisions)
        if args.dry_run:
            for row in decisions:
                for entry in row['operations']:
                    if entry['source'] != entry['target']:
                        moved_paths[entry['source']] = entry['target']
                for entry in row['operations'][:-1]:
                    remap_existing_paths(entry['source'], entry['target'], failures, exact_copies)
                    for previous in [*successes, *versions, *conversions]:
                        if previous['path'] == entry['source']:
                            previous['path'] = entry['target']
                        if 'existing_paths' in previous:
                            previous['existing_paths'] = [entry['target'] if path == entry['source'] else path
                                                          for path in previous['existing_paths']]
            successes.extend({'filename': row['filename'], 'path': row['target']} for row in decisions)
            versions.extend({'filename': row['filename'], 'path': row['target'], 'existing_paths': row['existing_paths']}
                            for row in decisions if row['existing_paths'])
            conversions.extend({'filename': row['filename'], 'path': row['target']}
                               for row in decisions if row['operations'][-1].get('converted'))
            exact_copies.extend(copies)
            continue
        committed_stamps = {}
        committed_moves = {}
        commit_decisions = []
        for row in decisions:
            try:
                if row['operations'][-1].get('converted'):
                    prepare_conversion(row['operations'][-1], project)
                commit_decisions.append(row)
            except Exception as error:
                failures.append(failure_row(row['filename'], row['source'], error))
        decisions = commit_decisions
        if decisions:
            handled = set()
            try:
                with reader.paused():
                    for row in decisions:
                        try:
                            operations = materialize(row['operations'], library, committed_stamps)
                            execute(operations, project, reader)
                            for entry in operations:
                                if entry['source'] != entry['target']:
                                    moved_paths[entry['source']] = entry['target']
                                    committed_moves[entry['source']] = entry['target']
                                    committed_stamps.pop(intake_reader.key(entry['source']), None)
                                    remap_existing_paths(entry['source'], entry['target'], failures, exact_copies)
                                    for success in successes:
                                        if success['path'] == entry['source']:
                                            success['path'] = entry['target']
                                    for version in [*versions, *conversions]:
                                        if version['path'] == entry['source']:
                                            version['path'] = entry['target']
                                        if 'existing_paths' in version:
                                            version['existing_paths'] = [entry['target'] if path == entry['source'] else path
                                                                         for path in version['existing_paths']]
                                committed_stamps[intake_reader.key(entry['target'])] = stamp(entry['target'])
                            successes.append({'filename': row['filename'], 'path': operations[-1]['target']})
                            if row['existing_paths']:
                                versions.append({'filename': row['filename'], 'path': operations[-1]['target'],
                                                 'existing_paths': row['existing_paths']})
                            if operations[-1].get('converted'):
                                conversions.append({'filename': row['filename'], 'path': operations[-1]['target']})
                        except Exception as error:
                            failures.append(failure_row(row['filename'], row['source'], error))
                        handled.add(row['filename'])
            except Exception as error:
                failures.extend({'filename': row['filename'], 'path': row['source'], 'reason': str(error)}
                                for row in decisions if row['filename'] not in handled)
        for row in decisions:
            entry = row['operations'][-1]
            conversion_journal = Path(entry['conversion_journal']) if entry.get('conversion_journal') else None
            if conversion_journal and conversion_journal.is_file():
                try:
                    rollback([entry])
                    conversion_journal.unlink()
                except Exception as error:
                    failures.append({'filename': row['filename'], 'path': row['source'],
                                     'reason': str(error), 'recovery': str(conversion_journal)})
        # Only committed moves may change a verified duplicate's physical location.
        def committed_path(path):
            seen = set()
            while path in committed_moves and path not in seen:
                seen.add(path)
                path = committed_moves[path]
            return path
        verified_copies = []
        for verified in copies:
            target = committed_path(verified['verified_path'])
            expected = committed_stamps.get(intake_reader.key(target), verified['target_stamp'])
            verified = {**verified, 'existing_path': target, 'target_stamp': expected}
            if not Path(target).is_file() or Path(target).resolve().is_relative_to(args.root):
                failures.append({'filename': verified['filename'], 'path': verified['path'],
                    'reason': '拟保留副本尚未完成归档，保留新输入', 'existing_paths': [target]})
            else:
                verified_copies.append(verified)
        deleted_rows = []
        if verified_copies:
            handled = set()
            try:
                with reader.paused():
                    for verified in verified_copies:
                        try:
                            delete_exact_duplicate(verified, library, args.root, reader, project)
                            exact_copies.append(verified)
                            deleted_rows.append(verified)
                        except Exception as error:
                            failures.append({'filename': verified['filename'], 'path': verified['path'],
                                             'reason': str(error), 'existing_paths': [verified['existing_path']]})
                        handled.add(verified['filename'])
            except Exception as error:
                failures.extend({'filename': verified['filename'], 'path': verified['path'], 'reason': str(error)}
                                for verified in verified_copies if verified['filename'] not in handled)
            try:
                housekeeping.record_deletions(project, deleted_rows)
            except (OSError, csv.Error) as error:
                failures.append({'filename': '删除记录', 'path': str(project / 'state/intake'),
                                 'kind': 'log_error', 'reason': '副本已删除，记录保存失败：' + str(error)})
        # The next formal batch reads committed files; preview retains its overlay.
        virtual.clear()
    reader_synced = False
    if not args.dry_run and not args.plan_online:
        retry_sync = any(housekeeping.is_reader_sync_failure(row, project)
                         and intake_reader.key(row.get('library_root') or library) == intake_reader.key(library)
                         for row in housekeeping.read_csv(project / 'state/intake/failures.csv'))
        if reader.outbox or retry_sync:
            try:
                if not reader.enabled:
                    raise ValueError('阅读器同步未启用，保留待同步任务')
                # Legacy failures may have lost their scan-only in-memory outbox.
                if retry_sync:
                    queue_scan(project, library, reader)
                with reader.paused():
                    reader.flush()
                reader_synced = True
            except Exception as error:
                # Recovery may already have reported the same library-wide issue.
                if not any(housekeeping.is_reader_sync_failure(row, project) for row in failures):
                    failures.append(reader_sync_failure(project, reader, error))
    finalize_locations(moved_paths, failures, successes, versions, conversions, exact_copies)
    duplicates = sum(f.get('kind') == 'duplicate' for f in failures)
    conflicts = sum(f.get('kind') == 'name_conflict' for f in failures)
    summary = {'success_count': len(successes), 'failure_count': len(failures), 'skipped_count': skipped,
               'duplicate_count': duplicates, 'name_conflict_count': conflicts,
               'exact_duplicate_count': len(exact_copies), 'deleted_duplicate_count': 0 if args.dry_run else len(exact_copies),
               'exact_duplicates': [{k: v for k, v in row.items() if k not in {'source_stamp', 'target_stamp'}} for row in exact_copies],
               'retained_version_count': len(versions), 'retained_versions': versions,
               'converted_count': len(conversions), 'conversions': conversions,
               'api_requests': client.calls, 'search_requests': searcher.calls, 'nhentai_requests': nh_client.calls, 'successes': successes,
               'failures': failures, 'plans': plans, 'dry_run': args.dry_run, 'library_root': str(library)}
    label = '预览可入库' if args.dry_run else '成功'
    deletion_label = '图页指纹一致将删除' if args.dry_run else '图页指纹一致已删除'
    lines = [f"{label} {len(successes)} 本；不同版本保留 {len(versions)} 本；自动转换 {len(conversions)} 本；{deletion_label} {len(exact_copies)} 本；同作品待人工 {duplicates} 本；重名冲突 {conflicts} 本；其他待人工处理 {len(failures)-duplicates-conflicts} 本；跳过 {skipped} 本。"]
    location_label = '拟归档' if args.dry_run else '已补 metadata' if args.metadata_only else '已归档'
    for success in successes:
        lines.append(f"{success['filename']}\n  {location_label}：{success['path']}")
    for plan in plans:
        resolved = plan.get('metadata_resolution', {})
        if resolved.get('references'):
            lines.append(plan['filename'] + '\n  metadata：' + resolved['match_scope'] + '；' + ' , '.join(resolved['references']))
    for duplicate in exact_copies:
        action = '将删除输入' if args.dry_run else '已删除输入'
        lines.append(f"{duplicate['filename']}\n  {action}：{duplicate['path']}\n  保留已有文件：{duplicate['existing_path']}\n  依据：{duplicate['page_count']} 页的大小及 CRC 相同，前 {duplicate['sampled_pages']} 页 SHA-256 相同")
    for version in versions:
        lines.append(f"{version['filename']}\n  不同版本另存：{version['path']}")
        lines.extend('  同时保留已有版本：' + path for path in version['existing_paths'])
    for failure in failures:
        lines.append(f"{failure['filename']}\n  原因：{failure['reason']}\n  新输入：{failure['path']}")
        lines.extend('  已有文件：' + path for path in failure.get('existing_paths', []))
    if reader.enabled and not args.dry_run and (successes or exact_copies or reader_synced):
        lines.append('Komga 更新任务已排队，启动 Komga 后由阅读器自动处理。' if not reader.outbox
                     else 'Komga 更新尚未完成排队，保留恢复记录，下次运行重试。')
    if not args.dry_run and not args.plan_online:
        output = project / 'state/intake'
        summary['pending_count'] = housekeeping.update_failures(
            project, library, paths, failures, libraries, moved_paths, reader_synced=reader_synced)
        housekeeping.text(output / 'latest.txt', '\n'.join([f'书库：{library}', *lines]) + '\n')
    # Success locations remain in the latest result; the console focuses on actionable items.
    success_lines = len(successes) + sum(bool(p.get('metadata_resolution', {}).get('references')) for p in plans)
    console = [lines[0], f'归档位置：{library}', *lines[1 if args.dry_run else 1 + success_lines:]]
    if args.dry_run:
        for plan in plans:
            for entry in plan.get('operations', [])[:-1]:
                console.append(f"同时调整已有分册：{entry['source']}\n  拟移动：{entry['target']}\n  系列：{entry['series']}；编号：{entry['number']}")
    if summary.get('pending_count', len(failures)) > len(failures):
        console.append(f"待处理清单共 {summary['pending_count']} 项，包含其他批次或书库尚未解决的问题。")
    print('\n'.join(console), flush=True)
    if args.plan_online:
        print(json.dumps(plans, ensure_ascii=False, indent=2))
    if args.report:
        report = Path(args.report)
        report.mkdir(parents=True, exist_ok=True)
        (report / 'result.txt').write_text('\n'.join(lines) + '\n', encoding='utf-8-sig')
        if args.dry_run or args.plan_online:
            meta.save_json(report / 'preview.json', plans)
    return summary


def run(args, *, project=None, reader_factory=None):
    project = Path(project or PROJECT)
    formal = not args.dry_run and not args.plan_online
    result = None
    with housekeeping.run_lock(project):
        try:
            result = _run(args, project=project, reader_factory=reader_factory)
            if formal and not result['failure_count']:
                housekeeping.clear_error(project)
            return result
        except BaseException as error:
            if formal:
                try:
                    housekeeping.record_error(project, error)
                except OSError as logging_error:
                    print('中断信息保存失败：' + str(logging_error), file=sys.stderr)
            raise
        finally:
            if formal:
                try:
                    cache_root = Path(args.cache_root or project / 'cache/ehentai')
                    cleaned = housekeeping.cleanup(project, cache_root, extra_caches=(cache_root / 'nhentai',))
                    if result is not None:
                        result['cleanup'] = cleaned
                    if cleaned['cache_removed'] or cleaned['temporary_removed']:
                        print(f"自动清理：缓存 {cleaned['cache_removed']} 个，临时文件 {cleaned['temporary_removed']} 个。", flush=True)
                    if cleaned['warnings']:
                        warning = '自动清理待重试：' + '；'.join(cleaned['warnings'][:3])
                        print(warning, file=sys.stderr)
                        latest = project / 'state/intake/latest.txt'
                        if latest.exists():
                            housekeeping.text(latest, latest.read_text(encoding='utf-8-sig') + warning + '\n')
                except (OSError, csv.Error) as cleanup_error:
                    print('自动清理待重试：' + str(cleanup_error), file=sys.stderr)


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description='日常整理：ComicInfo、作者/社团归档、Komga 同步及自动收尾')
    daily = parser.add_argument_group('日常功能')
    daily.add_argument('--library', choices=['H', 'E'], default='H', help='配置书库，默认 H；多库连续处理使用 PowerShell 主入口')
    daily.add_argument('--root', type=Path, help='输入子目录；默认【未分类】，已归位目录加 --in-place')
    daily.add_argument('--dry-run', action='store_true', help='预览计划，不改漫画或阅读器，也不清理既有记录')
    optional = parser.add_argument_group('可选功能')
    optional.add_argument('--collection-authors', type=Path, help='仅为显式确认清单中的图集补作者及本地基本字段，不查询 API 或补标签')
    optional.add_argument('--metadata-only', action='store_true', help='原位补 ComicInfo，不归档；需转换时输出同目录 CBZ')
    optional.add_argument('--in-place', action='store_true', help='处理库内已归位子目录，保留位置并改名；图片文件夹转CBZ')
    optional.add_argument('--series-tags', action='store_true', help='精确匹配失败时允许借用同作者同系列内容标签')
    optional.add_argument('--hash-lookup', action='store_true', help='授权向e-hentai发送首/中/末页SHA-1进行补充检索')
    optional.add_argument('--no-series-merge', action='store_true', help='关闭新系列组合和旧单篇移动；仍沿用已有系列')
    optional.add_argument('--keep-duplicates', action='store_true', help='同作品只报告，保留输入；关闭图页核验和自动删除')
    optional.add_argument('--offline', action='store_true', help='只使用现有缓存，可配合预览')
    optional.add_argument('--sources', type=Path, help='文件名或路径到画廊链接的 JSON 映射')
    optional.add_argument('--sources-only', action='store_true', help='只处理来源映射中的输入')
    optional.add_argument('--refresh', action='store_true', help='重新查询来源；保留已有人工内容字段')
    optional.add_argument('--report', type=Path, help='额外导出目录，建议反复使用固定目录')
    optional.add_argument('--tag-language', choices=['zh', 'raw'], default='zh', help='中文或原始标签，默认 zh')
    optional.add_argument('--library-root', type=Path, help='自定义库根，与 --root 配合使用')
    optional.add_argument('--cache-root', type=Path, help='查询缓存位置')
    optional.add_argument('--torrent-dir', type=Path, default=Path.home() / 'Desktop', help='辅助来源匹配的 torrent 目录，默认桌面')
    optional.add_argument('--creator-aliases', type=Path, action='append', default=[], help='附加作者/社团别名规则')
    optional.add_argument('--prefixed-only', action='store_true', help='只选择带画廊来源前缀的输入')
    optional.add_argument('--plan-online', action='store_true', help='仅列查询计划，不实际查询、改文件或清理')
    return parser.parse_args(argv)


def main():
    try:
        run(parse_args())
    except Exception as error:
        print('整理未完成：' + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
