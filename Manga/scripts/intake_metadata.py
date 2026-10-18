"""Metadata for incoming archives. ComicInfo is the only book metadata store."""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import json
import re
import time
import urllib.request
import intake_archives
import xml.etree.ElementTree as ET
import zipfile

import eh_metadata_lookup as lookup
import intake_titles as matcher
import series_identity as series
import tag_translation

IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif', '.jxl'}
API = 'https://api.e-hentai.org/api.php'
LINK = re.compile(r'https?://(?:e-hentai\.org|exhentai\.org)/g/([1-9]\d*)/([0-9a-f]{10})', re.I)
NH_LINK = re.compile(r'https?://(?:www\.)?nhentai\.net/g/([1-9]\d*)(?:/|(?=$|[?#\s]))', re.I)
LANGUAGES = {'chinese': 'zh', 'japanese': 'ja', 'english': 'en', 'korean': 'ko',
             'french': 'fr', 'spanish': 'es', 'german': 'de', 'russian': 'ru', 'portuguese': 'pt',
             'thai': 'th', 'vietnamese': 'vi', 'indonesian': 'id', 'italian': 'it', 'polish': 'pl',
             'arabic': 'ar', 'dutch': 'nl', 'hungarian': 'hu', 'ukrainian': 'uk', 'turkish': 'tr', 'speechless': 'zxx'}


def save_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


def unique(values):
    return list(dict.fromkeys(v.strip() for v in values if isinstance(v, str) and v.strip()))


def aliases(paths):
    result = {}
    for path in paths:
        if Path(path).is_file():
            for row in json.loads(Path(path).read_bytes()).get('entries', []):
                if row.get('role') in {'artists', 'groups'} and row.get('alias') and row.get('canonical'):
                    result[(row['role'], matcher.normalize(row['alias']))] = row['canonical']
    return result


def canonical(value, role, rules):
    return matcher.normalize(rules.get((role, matcher.normalize(value)), value))


def xml_values(raw):
    root = ET.fromstring(raw) if raw else ET.Element('ComicInfo')
    return root, {n.tag.rsplit('}', 1)[-1]: (n.text or '').strip() for n in root}


def read_archive(path):
    """Read ZIP directory and small ComicInfo only; no image reads or hashes."""
    if Path(path).is_dir():
        import intake_inputs
        return intake_inputs.read_folder(path)
    before = Path(path).stat()
    if Path(path).suffix.casefold() in intake_archives.CONVERT_EXTS:
        pages, raw, xml_name = intake_archives.directory(path, IMAGE_EXTS)
    else:
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist()
            xml_entries = [e for e in entries if Path(e.filename.replace('\\', '/')).name.casefold() == 'comicinfo.xml']
            if len(xml_entries) > 1:
                raise ValueError('压缩包内有多个 ComicInfo.xml，请人工处理')
            if xml_entries and xml_entries[0].file_size > 1024 * 1024:
                raise ValueError('ComicInfo.xml 超过 1 MiB，请人工处理')
            raw = archive.read(xml_entries[0]) if xml_entries else None
            xml_name = xml_entries[0].filename if xml_entries else None
            pages = sum(not e.is_dir() and Path(e.filename).suffix.casefold() in IMAGE_EXTS for e in entries)
    if not pages:
        raise ValueError('压缩包中没有支持的图页')
    after = Path(path).stat()
    read_stamp = [before.st_size, before.st_mtime_ns, before.st_dev, before.st_ino]
    if read_stamp != [after.st_size, after.st_mtime_ns, after.st_dev, after.st_ino]:
        raise ValueError('本次文件在读取时发生变化，请重试')
    _, fields = xml_values(raw)
    parsed = deepcopy(matcher.parse_title(Path(path).name))
    parsed['filename_creators'] = deepcopy(parsed['creators'])
    parsed['directory_creators'] = {'artists': [], 'groups': [], 'generic': []}
    artists = next((names for field in ('Penciller', 'Writer')
                    if (names := [n for n in unique(re.split(r'[,，;；]', fields.get(field, '')))
                                  if not matcher.placeholder_creator(n)])), [])
    groups = unique(re.split(r'[,，;；]', fields.get('MangaGroups', '')))
    if not groups:
        groups = unique(re.findall(r'(?:^|[,\n])\s*(?:circle:|group:|社团：|社團：)([^,\n]+)', fields.get('Tags', '')))
    # Notes are user prose; former audit text is not source/creator metadata.
    source_titles = {'title': fields.get('MangaSourceTitle', ''), 'title_jpn': fields.get('MangaSourceTitleJpn', '')}
    metadata = {'title': fields.get('Title') or parsed['core'], 'artists': artists, 'groups': groups,
                'language': fields.get('LanguageISO', ''), 'tags': unique(fields.get('Tags', '').split(',')),
                'raw_tags': unique(fields.get('MangaTagKeys', '').split(',')),
                'series': fields.get('Series', ''), 'number': fields.get('Number', ''),
                'volume': fields.get('Volume', ''), 'source_titles': source_titles,
                'web': fields.get('Web', ''), 'page_count': pages}
    return {'path': str(path), 'filename': Path(path).name, 'parsed': parsed, 'old_xml': raw,
            'metadata': metadata, 'page_count': pages, 'source_pairs': [(int(g), t.lower()) for g, t in LINK.findall(fields.get('Web', ''))],
            'nhentai_ids': [int(g) for g in NH_LINK.findall(fields.get('Web', ''))],
            'xml_name': xml_name, 'read_stamp': read_stamp}


def fill_local_fields(book, dictionary=None):
    """Use embedded fields and raw tags before looking for an external source."""
    metadata = book['metadata']
    keys = metadata['raw_tags'] or [t for t in metadata['tags']
                                   if re.match(r'^(artist|group|language|female|male|mixed|other|parody|character|cosplayer):', t)]
    metadata['raw_tags'] = metadata['raw_tags'] or keys
    metadata['artists'] = metadata['artists'] or unique(t.partition(':')[2] for t in keys if t.startswith('artist:') and not matcher.placeholder_creator(t.partition(':')[2]))
    metadata['groups'] = metadata['groups'] or unique(t.partition(':')[2] for t in keys if t.startswith('group:'))
    if not metadata['language']:
        metadata['language'] = next((LANGUAGES[t.partition(':')[2].casefold()] for t in keys
                                     if t.startswith('language:') and t.partition(':')[2].casefold() in LANGUAGES), '')
        metadata['language'] = metadata['language'] or LANGUAGES.get(book['parsed'].get('language_hint'), '')
    if not metadata['tags'] and keys:
        metadata['tags'] = [row['label'] for row in dictionary.project(keys)] if dictionary else list(keys)
    scope = series.split_title(metadata['title'])
    if scope['state'] == 'range_requires_review':
        metadata.update(number='', series='', volume='')
    elif not metadata['number']:
        metadata['number'] = scope['number'] or scope['part']


def lookup_context(book):
    """Search missing fields using local metadata, retaining filename source hints."""
    parsed = deepcopy(book['parsed'])
    _, fields = xml_values(book['old_xml'])
    if fields.get('Title'):
        local = matcher.parse_title(fields['Title'])
        for key in ('full', 'full_key', 'core', 'keys', 'events', 'contexts', 'collection_hint'):
            parsed[key] = local[key]
    metadata = book['metadata']
    if metadata['artists'] or metadata['groups']:
        parsed['creators'] = {'artists': metadata['artists'], 'groups': metadata['groups'], 'generic': []}
        parsed['filename_creators'] = deepcopy(parsed['creators'])
    return {**book, 'parsed': parsed}


class ApiClient:
    def __init__(self, cache, *, offline=False, refresh=False, timeout=20, opener=None, sleeper=time.sleep):
        self.cache, self.offline, self.refresh = Path(cache), offline, refresh
        self.timeout, self.opener, self.sleep = timeout, opener or urllib.request.urlopen, sleeper
        self.results, self.calls, self.last_call = {}, 0, 0

    def fetch(self, pairs):
        pending = []
        for pair in sorted(set(map(tuple, pairs))):
            if pair in self.results:
                continue
            cached = None
            try:
                cached = json.loads((self.cache / f'{pair[0]}_{pair[1]}.json').read_bytes())
                self.validate(cached['gallery'], pair)
                if cached.get('schema') != 'mangah.eh-api-cache':
                    cached = None
            except (OSError, KeyError, ValueError, TypeError):
                cached = None
            if cached and (self.offline or not self.refresh and time.time() - cached.get('fetched_at_unix', 0) < 168 * 3600):
                self.results[pair] = {'gallery': cached['gallery'], 'state': 'cached'}
            elif self.offline:
                self.results[pair] = {'state': 'offline', 'error': '离线缓存没有该来源的可用元数据'}
            else:
                pending.append(pair)
        for offset in range(0, len(pending), 25):
            batch = pending[offset:offset + 25]
            error = ''
            for attempt in range(2):
                self.sleep(max(0, (5 if self.calls and self.calls % 4 == 0 else 2) - (time.monotonic() - self.last_call)))
                request = urllib.request.Request(API, data=json.dumps({'method': 'gdata', 'gidlist': batch, 'namespace': 1}).encode(),
                                                 headers={'Content-Type': 'application/json', 'User-Agent': 'MangaMetadata/2.0'})
                self.calls += 1
                self.last_call = time.monotonic()
                try:
                    with self.opener(request, timeout=self.timeout) as response:
                        raw = response.read(2 * 1024 * 1024 + 1)
                    if len(raw) > 2 * 1024 * 1024:
                        raise ValueError('API 响应过大')
                    records = json.loads(raw)['gmetadata']
                    if not isinstance(records, list):
                        raise ValueError('API 响应缺少元数据列表')
                    by_gid = {int(g['gid']): g for g in records if isinstance(g, dict) and str(g.get('gid', '')).isdigit()}
                    for pair in batch:
                        try:
                            gallery = by_gid.get(pair[0], {})
                            self.validate(gallery, pair)
                            save_json(self.cache / f'{pair[0]}_{pair[1]}.json', {'schema': 'mangah.eh-api-cache',
                                      'endpoint': API, 'fetched_at_unix': time.time(), 'gallery': gallery})
                            self.results[pair] = {'state': 'fetched', 'gallery': gallery}
                        except (ValueError, KeyError, TypeError) as problem:
                            self.results[pair] = {'state': 'not_found' if re.search(r'gallery not found|does not exist|expunged', str(problem), re.I) else 'failed', 'error': str(problem)}
                    break
                except (OSError, ValueError, KeyError, TypeError) as problem:
                    error = str(problem)
            else:
                for pair in batch:
                    self.results[pair] = {'state': 'failed', 'error': error}
        return self.results

    @staticmethod
    def validate(gallery, pair):
        if gallery.get('error'):
            raise ValueError(gallery['error'])
        if int(gallery.get('gid', 0)) != pair[0] or gallery.get('token', '').lower() != pair[1]:
            raise ValueError('API 来源编号或 token 不对应')
        if not gallery.get('title') and not gallery.get('title_jpn'):
            raise ValueError('API 未提供题名')
        if not isinstance(gallery.get('tags'), list):
            raise ValueError('API 未提供标签')


def choose_gallery(book, galleries, rules, *, direct=False):
    """Direct IDs identify the source. Name search requires matching evidence."""
    comparison = lookup_context(book)['parsed']
    if not any(comparison['creators'].values()):
        comparison['creators'] = {'artists': book['metadata']['artists'], 'groups': book['metadata']['groups'], 'generic': []}
    for role, names in comparison['creators'].items():
        def resolve(name):
            if role == 'generic':
                choices = {rules[(r, matcher.normalize(name))] for r in ('artists', 'groups') if (r, matcher.normalize(name)) in rules}
                return next(iter(choices)) if len(choices) == 1 else name
            return rules.get((role, matcher.normalize(name)), name)
        comparison['creators'][role] = [resolve(n) for n in names]
    matched, failures = [], []
    for raw in galleries:
        row = (int(raw['gid']), raw['token'], raw.get('title', ''), raw.get('title_jpn', ''), raw.get('category', ''),
               raw.get('posted', 0), raw.get('filecount', 0), json.dumps(raw['tags']))
        gallery = matcher.gallery_from_row(row)
        evidence = matcher.candidate_evidence(book, comparison, gallery)
        for role in ('artists', 'groups'):
            wanted = comparison['creators'].get(role, [])
            tagged = gallery[role]
            if wanted and tagged and {canonical(n, role, rules) for n in wanted} & {canonical(n, role, rules) for n in tagged}:
                evidence['creator_matches'].append({'role': role, 'name': wanted[0]})
                evidence['creator_conflicts'] = [c for c in evidence['creator_conflicts'] if c != role]
        if not direct and not (evidence['strict_title_exact'] or evidence['full_title_exact']):
            failures.append('来源题名或分篇范围与本地题名不一致')
            continue
        if not direct and (evidence['creator_conflicts'] or any(comparison['creators'].values()) and not evidence['creator_matches']):
            failures.append('来源作者／社团与本地署名不一致')
            continue
        local = series.split_title(comparison['core'])
        scopes = [series.split_title(fragment) for p in gallery['_parsed']
                  for fragment in re.split(r'[|｜︱]', p['core'])]
        # Translation numbers and publication codes can be different domains.
        # Only a number attached to the same title family contradicts the input.
        numbers = {s['number'] for s in scopes if s['number']
                   and matcher.normalize(s['series']) == matcher.normalize(local['series'])}
        if local['number'] and numbers and numbers != {local['number']}:
            failures.append('题名中的来源系列编号与本地编号不一致')
            continue
        matched.append((raw, gallery))
    identities = {(tuple(sorted(canonical(n, 'artists', rules) for n in g['artists'])),
                   tuple(sorted(canonical(n, 'groups', rules) for n in g['groups']))) for _, g in matched}
    if len(identities) > 1:
        raise ValueError('同题名候选的作者／社团不同，请补充准确来源链接')
    if not matched:
        raise ValueError('；'.join(unique(failures)) or '没有找到题名、作者及编号一致的元数据')
    raw, gallery = matched[0]
    metadata = deepcopy(book['metadata'])
    metadata['artists'] = metadata['artists'] or [n for n in gallery['artists'] if not matcher.placeholder_creator(n)]
    metadata['groups'] = metadata['groups'] or gallery['groups']
    # Many galleries have no artist/group tags but do provide a signed title.
    signed = next((p['creators'] for p in reversed(gallery['_parsed'])
                   if any(p['creators'].values())), {'artists': [], 'groups': [], 'generic': []})
    metadata['artists'] = metadata['artists'] or signed['artists']
    metadata['groups'] = metadata['groups'] or signed['groups']
    if not metadata['artists'] and not metadata['groups']:
        generic = unique(signed['generic'])
        if any(re.search(r'anthology|アンソロジー|合同誌|合刊', n, re.I) for n in generic):
            metadata['groups'] = ['【合刊】']
        else:
            metadata['artists'] = generic
    _, local_fields = xml_values(book['old_xml'])
    if not local_fields.get('Title'):
        metadata['title'] = series.clean_title(comparison['core'])
    local_scope = series.split_title(metadata['title'])
    if local_scope['state'] == 'range_requires_review':
        metadata.update(number='', series='', volume='')
    elif not metadata['number'] and local_scope['state'] == 'numbered':
        metadata['number'] = local_scope['number']
    # Filename language describes the local version even when referencing another upload.
    metadata['language'] = metadata['language'] or LANGUAGES.get(comparison.get('language_hint'), '') or next(
        (LANGUAGES[n] for n in gallery['languages'] if n in LANGUAGES), '')
    if not metadata['language']:
        if re.search(r'[\u3040-\u30ff]', raw.get('title_jpn', '')) and not gallery['languages']:
            metadata['language'] = 'ja'
        else:
            raise ValueError('本地语言和来源语言均不明确，请人工补充 LanguageISO')
    common = set(gallery['tags'])
    for _, candidate in matched[1:]:
        common.intersection_update(candidate['tags'])
    metadata['raw_tags'] = metadata['raw_tags'] or sorted(t for t in common if not t.startswith('language:') and not matcher.EDITION_TAG_RE.search(t))
    if local_scope['state'] != 'range_requires_review':
        metadata['source_titles'] = {k: metadata['source_titles'].get(k) or raw.get(k, '') for k in ('title', 'title_jpn')}
    if not metadata['web'] or book.get('source_override'):
        metadata['web'] = raw.get('url') or f"https://e-hentai.org/g/{raw['gid']}/{raw['token']}/"
    metadata['page_difference'] = int(raw.get('filecount', 0)) - book['page_count']
    return metadata


def render_xml(book, metadata, dictionary=None, *, series_only=False):
    if book.get('collection_author_only'):
        import intake_collections
        return intake_collections.render_xml(book, metadata)
    root, fields = xml_values(book['old_xml'])
    namespace = root.tag[:root.tag.rfind('}') + 1] if '}' in root.tag else ''
    def set_field(name, value):
        nodes = [n for n in root if n.tag.rsplit('}', 1)[-1] == name]
        for n in nodes[1:]:
            root.remove(n)
        if value is None or str(value) == '':
            for n in nodes[:1]:
                root.remove(n)
            return
        node = nodes[0] if nodes else ET.SubElement(root, namespace + name)
        node.text = str(value)
    def fill_field(name, value):
        if not fields.get(name):
            set_field(name, value)
    for field, key in (('Series', 'series'), ('Number', 'number'), ('Volume', 'volume')):
        set_field(field, metadata.get(key, ''))
    set_field('PageCount', book['page_count'])
    if not series_only:
        fill_field('Title', metadata['title'])
        for name in ('Penciller', 'Writer'):
            names = unique(re.split(r'[,，;；]', fields.get(name, '')))
            if names and all(matcher.placeholder_creator(n) for n in names):
                set_field(name, '')
        credits = unique(re.split(r'[,，;；]', fields.get('Penciller', '') + ',' + fields.get('Writer', '')))
        if not credits or all(matcher.placeholder_creator(n) for n in credits):
            set_field('Penciller', ', '.join(metadata['artists']))
        fill_field('MangaGroups', ', '.join(metadata['groups']))
        fill_field('LanguageISO', metadata['language'])
        if book.get('source_override'):
            set_field('Web', metadata['web'])
        else:
            fill_field('Web', metadata['web'])
        keys = unique(metadata.get('raw_tags', []) + ['artist:' + n for n in metadata['artists']]
                      + ['group:' + n for n in metadata['groups']])
        if not fields.get('Tags'):
            labels = metadata.get('tags') or ([r['label'] for r in dictionary.project(keys)] if dictionary else keys)
            set_field('Tags', ', '.join(unique(labels)))
        fill_field('MangaTagKeys', ', '.join(keys))
        for field, key in (('MangaSourceTitle', 'title'), ('MangaSourceTitleJpn', 'title_jpn')):
            fill_field(field, metadata['source_titles'].get(key, ''))
    ET.indent(root, space='  ')
    return ET.tostring(root, encoding='utf-8', xml_declaration=True)
