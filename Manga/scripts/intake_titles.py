"""Match filename-only library inventory against an existing, read-only EH SQLite snapshot.

Exact normalized titles are indexed in a single streaming catalogue pass. Fuzzy
matches are deliberately excluded. Work identity and specific gallery edition
identity have different confirmation rules.
"""
from __future__ import annotations

import ast
from datetime import datetime, timedelta, timezone
from functools import lru_cache
import html
import json
from pathlib import Path
import re
import sys
import unicodedata
from annotation_evidence import recognized_annotation, STRUCTURAL_RE

SCRIPTS_DIRECTORY = str(Path(__file__).resolve().parent)
if SCRIPTS_DIRECTORY not in sys.path:
    sys.path.insert(0, SCRIPTS_DIRECTORY)

CHINA_TIME = timezone(timedelta(hours=8))
BOOK_EXTS = {'.zip', '.cbz', '.rar', '.cbr', '.7z', '.cb7', '.pdf', '.epub'}
EVENT_RE = re.compile(r'^(?:c\d{2,3}|comiket\s*\d+|comic1\s*[☆★*]?\s*\d+|コミケ\s*\d+|エアコミケ\s*\d*|コミティア\s*\d+|例大祭\s*\d*|サンクリ\s*\d+)$', re.I)
MEDIA_PREFIX_RE = re.compile(r'^(?:成年コミック|一般コミック|同人誌|同人CG集)$', re.I)
NOISE_RE = re.compile(r'汉化|漢化|翻訳|翻譯|翻译|中国語|中国语|中文|官方|日语社|chinese|english|japanese|korean|spanish|french|german|russian|portuguese|thai|vietnamese|indonesian|translation|translated|scanlation|digital|dl版|dl\s*ver|uncensored|decensored|censored|無修正|无修正|無碼|无码|無修正|complete|ongoing|incomplete|カラー化|colorized|full\s*colou?r|commission', re.I)
LEADING_GID_RE = re.compile(r'^\s*\[?(\d{5,7})\]?(?:\s*[-_]\s*|\s+)(?=\S)')
GALLERY_SOURCE_PREFIX_RE = re.compile(r'^\s*\[(?:(?:EH|EX)_)?([1-9]\d*)_([0-9a-f]{10})\]\s*(?=\S)', re.I)


def leading_source_identifier(value):
    return GALLERY_SOURCE_PREFIX_RE.match(value) or LEADING_GID_RE.match(value)


BRACKET_RE = re.compile(r'\[([^\[\]]*)\]')
TRAILING_SQUARE_RE = re.compile(r'\s*\[([^\[\]]*)\]\s*$')
TRAILING_ROUND_RE = re.compile(r'\s*\(([^()]*)\)\s*$')
MEANINGFUL_CONTEXT_RE = re.compile(r'前編|後編|前篇|后篇|後篇|上巻|下巻|第\s*\d|vol|part|chapter|extra|after|後日|后日|番外|続編|续篇|総集|合集|合本|完結|\d', re.I)
COLLECTION_RE = re.compile(r'雑図|雑图|杂图|圖集|图集|fanbox|patreon|pixiv|合集|合本|全集|総集|總集|matome|compilation|collection|\d\s*[-~～]\s*\d', re.I)
CREATOR_SPLIT_RE = re.compile(r'[,、&＋+]')
LANGUAGE_PATTERNS = {
    'chinese': r'中国翻訳|中国翻譯|中国翻译|中国語|中国语|中國語|中國语|中文|官方中文|\bchinese\b|\bchn\b',
    'english': r'\benglish\b|英語|英语',
    'japanese': r'\bjapanese\b|日本語|日语原版',
    'korean': r'\bkorean\b|韓国語|韩语',
    'spanish': r'\bspanish\b', 'french': r'\bfrench\b',
    'german': r'\bgerman\b', 'russian': r'\brussian\b',
    'portuguese': r'\bportuguese\b', 'thai': r'\bthai\b',
    'vietnamese': r'\bvietnamese\b', 'indonesian': r'\bindonesian\b',
}
ACTUAL_LANGUAGES = set(LANGUAGE_PATTERNS) | {'speechless', 'italian', 'polish', 'arabic', 'dutch', 'hungarian', 'ukrainian', 'turkish'}
EDITION_TAG_RE = re.compile(r'^language:|(?:^|:)(?:uncensored|decensored|censored|mosaic censorship|full censorship|rewrite|colorized)$', re.I)


@lru_cache(maxsize=100000)
def normalize(value: str) -> str:
    value = unicodedata.normalize('NFKC', html.unescape(value)).casefold()
    value = re.sub(r'[○◯〇]', '〇', value)
    # Preserve decimal and range semantics even when a filename inserts spaces.
    value = re.sub(r'(?<=\d)\s*([.\-/～~〜–—])\s*(?=\d)', r'\1', value)
    value = re.sub(r'(?<=\d)[～~〜–—](?=\d)', '-', value)
    result = []
    for index, character in enumerate(value):
        if character.isalnum() or character == '〇':
            result.append(character)
        elif character in '.-/' and index and index+1 < len(value) and value[index-1].isdigit() and value[index+1].isdigit():
            result.append(character)
    return ''.join(result)


def language_hint(value: str) -> str | None:
    # Language is taken from bracketed edition annotations, never arbitrary plot text.
    text = unicodedata.normalize('NFKC', value).replace('【', '[').replace('】', ']')
    blocks = BRACKET_RE.findall(text)
    # A missing final bracket is accepted only for an explicit translation credit.
    tail = re.search(r'\[([^\[\]]+)$', text)
    if tail and re.search(r'汉化|漢化|官中', tail[1]):
        blocks.append(tail[1])
    annotations = ' '.join(blocks)
    choices = {language for language, pattern in LANGUAGE_PATTERNS.items()
               if re.search(pattern, annotations, re.I)}
    if re.search(r'汉化|漢化|官中|台版|翻译|翻譯|机翻|機翻', annotations):
        choices.add('chinese')
    return next(iter(choices)) if len(choices) == 1 else None


def placeholder_creator(value: str) -> bool:
    return normalize(value) in {'よろず','よろす','various','variousartists','multipleartists','多人','众人','眾人','多人合作'}


def creator_block(value: str) -> dict:
    value = unicodedata.normalize('NFKC', value).strip(' []')
    paired = re.match(r'^(.+?)\s*\((.+?)\)\s*$', value)
    if paired:
        return {'groups': [paired.group(1).strip()], 'artists': [x.strip() for x in CREATOR_SPLIT_RE.split(paired.group(2)) if x.strip() and not placeholder_creator(x)], 'generic': []}
    return {'groups': [], 'artists': [], 'generic': [value] if value and not placeholder_creator(value) else []}


def leading_is_noise(value: str) -> bool:
    if re.search(r'汉化|漢化|翻訳|翻譯|翻译|中国語|中国语|中文|官方|日语社|無修正|无修正|無碼|无码', value):
        return True
    return bool(re.fullmatch(r'(?:chinese|english|japanese|korean|spanish|french|german|russian|portuguese|thai|vietnamese|indonesian)(?:\s+translation)?|translated|translation|digital(?:\s+edition)?|dl(?:\s+ver(?:sion)?)?|full\s*colou?r|uncensored|decensored|censored|complete|ongoing|incomplete', value.strip(), re.I))


@lru_cache(maxsize=65000)
def parse_title(value: str) -> dict:
    original = unicodedata.normalize('NFKC', html.unescape(value)).strip().replace('【', '[').replace('】', ']')
    if Path(original).suffix.casefold() in BOOK_EXTS:
        original = original[:original.rfind('.')].strip()
    source_match = GALLERY_SOURCE_PREFIX_RE.match(original)
    gid_match = leading_source_identifier(original)
    token_hint = source_match.group(2).lower() if source_match else None
    source_host = 'exhentai.org' if original.lstrip().upper().startswith('[EX_') else 'e-hentai.org'
    source_url_hint = f'https://{source_host}/g/{source_match.group(1)}/{token_hint}/' if source_match else None
    gid_hint = int(gid_match.group(1)) if gid_match else None
    body = original[gid_match.end():].strip() if gid_match else original
    # A downloaded name can lose the opening bracket of [Circle (Artist)].
    if re.match(r'^[^\[\]]+\([^()]+\)\]\s*', body):
        body = '[' + body
    full = body
    events, creators, ignored, unsafe_ignored = [], {'groups': [], 'artists': [], 'generic': []}, [], []
    while body:
        leading_event = re.match(r'^\(([^()]*)\)\s*', body)
        if leading_event and EVENT_RE.fullmatch(leading_event.group(1).strip()):
            events.append(leading_event.group(1).strip())
            body = body[leading_event.end():].strip()
            continue
        if leading_event and MEDIA_PREFIX_RE.fullmatch(leading_event.group(1).strip()):
            ignored.append(leading_event.group(1).strip())
            body = body[leading_event.end():].strip()
            continue
        leading = re.match(r'^\[([^\[\]]*)\]\s*', body)
        if not leading:
            break
        content = leading.group(1).strip()
        if EVENT_RE.fullmatch(content):
            events.append(content)
        elif (re.match(r'^.+?\s*\(.+?\)\s*$', content) or not leading_is_noise(content)) and content.casefold() not in {'pixiv', 'fanbox', 'patreon', 'fanbox _ patreon', 'fanbox patreon', 'r18', 'r18g'}:
            part = creator_block(content)
            for key in creators:
                creators[key].extend(part[key])
        else:
            ignored.append(content)
        body = body[leading.end():].strip()
    # Strip known edition/translator suffixes. Unknown suffixes are retained in strict keys.
    strict = body
    while True:
        trailing = TRAILING_SQUARE_RE.search(strict)
        if not trailing:
            break
        content = trailing.group(1).strip()
        if EVENT_RE.fullmatch(content) or recognized_annotation(content) or (not STRUCTURAL_RE.search(content) and NOISE_RE.search(content)):
            if EVENT_RE.fullmatch(content):
                events.append(content)
            ignored.append(content)
            strict = strict[:trailing.start()].rstrip()
        else:
            break
    # An event suffix may appear before the language annotations.
    trailing = TRAILING_ROUND_RE.search(strict)
    if trailing and EVENT_RE.fullmatch(trailing.group(1).strip()):
        events.append(trailing.group(1).strip())
        strict = strict[:trailing.start()].rstrip()
    relaxed = strict
    while True:
        trailing = TRAILING_SQUARE_RE.search(relaxed)
        if not trailing:
            break
        unsafe_ignored.append(trailing.group(1).strip())
        relaxed = relaxed[:trailing.start()].rstrip()
    contexts = []
    contextless = relaxed
    while True:
        trailing = TRAILING_ROUND_RE.search(contextless)
        if not trailing or MEANINGFUL_CONTEXT_RE.search(trailing.group(1)):
            break
        contexts.append(trailing.group(1).strip())
        contextless = contextless[:trailing.start()].rstrip()
    keys = {}
    def add_key(text: str, strength: str) -> None:
        for fragment in re.split(r'[|｜︱]', text):
            key = normalize(fragment)
            if key and key not in keys:
                keys[key] = strength
    add_key(strict, 'strict')
    if relaxed != strict:
        add_key(relaxed, 'unknown_suffix_removed')
    if contextless != relaxed:
        add_key(contextless, 'context_removed')
    return {'original': original, 'full': full, 'full_key': normalize(full), 'core': strict,
            'keys': keys, 'creators': creators, 'events': events, 'ignored_suffixes': ignored,
            'unknown_suffixes': unsafe_ignored, 'contexts': contexts, 'gid_hint': gid_hint,
            'gallery_token_hint': token_hint, 'source_url_hint': source_url_hint,
            'language_hint': language_hint(original), 'collection_hint': bool(COLLECTION_RE.search(original))}


def parse_tags(value: str) -> list[str]:
    try:
        tags = ast.literal_eval(value)
        return [tag for tag in tags if isinstance(tag, str)] if isinstance(tags, (list, tuple)) else []
    except (ValueError, SyntaxError, TypeError):
        return []


def namespace_tags(tags: list[str], namespace: str) -> list[str]:
    return sorted(set(tag.split(':', 1)[1] for tag in tags if tag.startswith(namespace+':')))


def gallery_from_row(row: tuple) -> dict:
    gid, token, title, title_jpn, category, posted, filecount, raw_tags = row
    tags = parse_tags(raw_tags or '[]')
    english, japanese = parse_title(title or ''), parse_title(title_jpn or '')
    raw_creators = {'groups': [], 'artists': [], 'generic': []}
    for parsed in [english, japanese]:
        for key in raw_creators:
            raw_creators[key].extend(parsed['creators'][key])
    languages = [language for language in namespace_tags(tags, 'language') if language in ACTUAL_LANGUAGES]
    if not languages:
        hint = english['language_hint'] or japanese['language_hint']
        if hint:
            languages = [hint]
    artists, groups = namespace_tags(tags, 'artist'), namespace_tags(tags, 'group')
    creator_keys = {
        'artists': set(normalize(x) for x in artists+raw_creators['artists']),
        'groups': set(normalize(x) for x in groups+raw_creators['groups']),
        'generic': set(normalize(x) for x in raw_creators['generic']),
    }
    # A single raw creator can name an artist or a circle; match it without inventing a role.
    creator_keys['all'] = set().union(*creator_keys.values())
    result = {'gid': int(gid), 'token': token, 'title': title or '', 'title_jpn': title_jpn or '',
              'category': category, 'posted': int(posted) if posted is not None else None,
              'filecount': int(filecount) if filecount is not None else None,
              'tags': tags, 'artists': artists, 'groups': groups, 'languages': languages,
              '_parsed': [english, japanese], '_creator_keys': creator_keys}
    return result


def candidate_evidence(book: dict, local: dict, gallery: dict) -> dict:
    title_matches = []
    full_exact = False
    for parsed in gallery['_parsed']:
        if local['full_key'] and local['full_key'] == parsed['full_key']:
            full_exact = True
        for key in local['keys'].keys() & parsed['keys'].keys():
            title_matches.append({'local_key': key, 'local_strength': local['keys'][key], 'database_strength': parsed['keys'][key]})
    strict = any(x['local_strength'] == x['database_strength'] == 'strict' for x in title_matches)
    creator_matches, creator_conflicts = [], []
    for namespace in ['artists', 'groups', 'generic']:
        local_names = local['creators'][namespace]
        # Single creator names in source titles do not have a known namespace.
        allowed = gallery['_creator_keys'][namespace] | gallery['_creator_keys']['generic'] if namespace != 'generic' else gallery['_creator_keys']['all']
        for name in local_names:
            if normalize(name) in allowed:
                creator_matches.append({'role': namespace, 'name': name})
    for namespace in ['artists', 'groups']:
        filename_names = local['filename_creators'][namespace]
        allowed = gallery['_creator_keys'][namespace] | gallery['_creator_keys']['generic']
        if filename_names and allowed and not any(normalize(name) in allowed for name in filename_names):
            creator_conflicts.append(namespace)
    hint = local['language_hint']
    language_match = bool(hint and hint in gallery['languages'])
    language_conflict = bool(hint and gallery['languages'] and hint not in gallery['languages'])
    page_difference = abs(book['page_count']-gallery['filecount']) if book.get('page_count') is not None and gallery['filecount'] is not None else None
    local_events = set(normalize(value) for value in local['events'])
    remote_events = set(normalize(value) for parsed in gallery['_parsed'] for value in parsed['events'])
    event_match = bool(local_events & remote_events)
    event_conflict = bool(local_events and remote_events and not event_match)
    return {'full_title_exact': full_exact, 'strict_title_exact': strict, 'title_matches': title_matches,
            'creator_matches': creator_matches, 'creator_conflicts': creator_conflicts,
            'gid_hint_match': local['gid_hint'] == gallery['gid'],
            'language_match': language_match, 'language_conflict': language_conflict,
            'page_difference': page_difference, 'event_match': event_match, 'event_conflict': event_conflict}


