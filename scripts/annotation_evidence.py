"""Explain safe filename-annotation matches without reading book content.

This module intentionally has no dependency on match_metadata. Callers provide
the existing normalizer/parser and are responsible for checking uniqueness
against *all* candidates, not the report's truncated candidate display.
"""
from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
import re
import unicodedata

BOOK_EXTS = {'.zip', '.cbz', '.rar', '.cbr', '.7z', '.cb7', '.pdf', '.epub'}
SQUARE_RE = re.compile(r'\[([^\[\]]*)\]')
STRUCTURAL_RE = re.compile(
    r'\d|前編|後編|前篇|后篇|後篇|上巻|中巻|下巻|巻|卷|第|番外|後日|后日|'
    r'続編|續編|续篇|续编|総集|總集|合集|合本|全集|選集|选集|完結|完结|'
    r'(?<![a-z])(?:part|extra|after|omake|appendix|bonus|epilogue|prologue|'
    r'vol(?:ume)?|ch(?:apter)?|arc|story|sequel|prequel|collection|compilation|'
    r'anthology|book|issue)(?![a-z])', re.I)
LANGUAGE_EDITION_RE = re.compile(
    r'^(?:(?:chinese|english|japanese|korean|spanish|french|german|russian|'
    r'portuguese|thai|vietnamese|indonesian)(?:\s+translation)?|'
    r'中国翻訳|中国翻譯|中国翻译|中国語|中国语|中文|官方中文|台版|台版官中|'
    r'日原版|日文|日本語|日语原版|英語|英语|韓国語|韩语|'
    r'digital(?:\s+edition)?|dl\s*(?:版|ver(?:sion)?)?|'
    r'uncensored|decensored|censored|無修正|无修正|無碼|无码|無修版|'
    r'カラー化|colorized|full\s+colou?r|ai\s+generated|'
    r'translation|translated|scanlation|mtl|complete|ongoing|incomplete|進行中|'
    r'別スキャン|修正版|r18|r18g)$', re.I)
SIGNATURE_MARKER_RE = re.compile(
    r'汉化|漢化|官中|翻訳|翻譯|翻译|机翻|機翻|重嵌|渣嵌|掃圖|扫图|'
    r'scanlation|translation|translated|translator|扫描|掃描|制作|製作|'
    r'出版|去码|去碼|润色|潤色', re.I)

# Only names for the same franchise are joined. Related series, sequels, and
# individual characters deliberately do not share an alias family.
CONTEXT_ALIASES = (
    ('Original', 'オリジナル', '原创', '原創'),
    ('Blue Archive', 'ブルーアーカイブ', '蔚蓝档案', '碧藍檔案'),
    ('Genshin Impact', '原神'),
    ('Touhou Project', '東方Project', '東方プロジェクト'),
    ('Azur Lane', 'アズールレーン', '碧蓝航线', '碧藍航線'),
    ('Granblue Fantasy', 'グランブルーファンタジー'),
    ('Princess Connect Re Dive', 'プリンセスコネクト!Re:Dive', '公主连接Re:Dive'),
    ('Kantai Collection', '艦隊これくしょん -艦これ-', '艦隊これくしょん', '艦これ'),
    ('Hololive', 'ホロライブ'),
    ('Honkai Star Rail', '崩壊 スターレイル', '崩坏星穹铁道', '崩壞星穹鐵道'),
    ('Fate Grand Order', 'Fate/Grand Order'),
    ('Fate Stay Night', 'Fate/stay night'),
)


def recognized_annotation(value: str) -> str | None:
    """Return a named harmless annotation rule; never discard numbered scope."""
    value = unicodedata.normalize('NFKC', value).strip()
    # Digits inside an explicit translator handle are not a volume number.
    if re.fullmatch(r'[a-z][a-z0-9_.-]{0,48}(?:个人|個人)?(?:翻译|翻譯|翻訳|汉化|漢化)(?:组|組)?', value, re.I):
        return 'explicit_translation_or_scan_signature'
    if STRUCTURAL_RE.search(value):
        return None
    if LANGUAGE_EDITION_RE.fullmatch(value):
        return 'explicit_language_or_edition_annotation'
    if SIGNATURE_MARKER_RE.search(value):
        return 'explicit_translation_or_scan_signature'
    return None


def extract_trailing_gid(filename: str, *, parse_title: Callable[[str], dict]) -> dict | None:
    """Find an explicit trailing [5-7 digit GID], followed only by known blocks.

    This does not confirm the GID. The caller must compare its catalogue row
    with the returned parsed title, creator, language, and page count.
    """
    text = unicodedata.normalize('NFKC', filename)
    extension = Path(text).suffix.casefold()
    body = text[:text.rfind('.')] if extension in BOOK_EXTS else text
    blocks = list(SQUARE_RE.finditer(body))
    gid_blocks = [b for b in blocks if re.fullmatch(r'\d{5,7}', b.group(1).strip())]
    if len(gid_blocks) != 1:
        return None
    block = gid_blocks[0]
    suffix = body[block.end():]
    suffix_blocks = list(SQUARE_RE.finditer(suffix))
    if SQUARE_RE.sub('', suffix).strip() or any(
            not recognized_annotation(b.group(1)) for b in suffix_blocks):
        return None
    if not body[:block.start()].strip():
        return None
    stripped = (body[:block.start()] + body[block.end():]).strip()
    parsed = dict(parse_title(stripped))
    gid = int(block.group(1).strip())
    if parsed.get('gid_hint') is not None and parsed['gid_hint'] != gid:
        return None
    parsed['gid_hint'] = gid
    parsed['trailing_gid_hint'] = gid
    return {'gid_hint': gid, 'parsed': parsed,
            'filename_without_gid': stripped,
            'removed_annotations': [{'side': 'local', 'value': block.group(1).strip(),
                                     'rule': 'explicit_trailing_gallery_id'}]}


def _plain_signature(value: str) -> bool:
    """Infer a free-form signature only under independently unique edition evidence."""
    value = unicodedata.normalize('NFKC', value).strip()
    return bool(value and len(value) <= 64 and not STRUCTURAL_RE.search(value)
                and not re.search(r'[\[\]（）()|｜:：!?！？]', value))


def _context_identity(value: str, normalize: Callable[[str], str]) -> str:
    key = normalize(value)
    for family in CONTEXT_ALIASES:
        normalized = [normalize(v) for v in family]
        if key in normalized:
            return normalized[0]
    return key


def annotation_evidence(book: dict, local: dict, gallery: dict, evidence: dict, *,
                        normalize: Callable[[str], str],
                        same_edition_unique: bool = False) -> dict:
    """Validate *both sides* of a weak exact title match.

    Unknown signature blocks require a caller-proven unique candidate with the
    same creator, explicitly known language, and exactly equal page count.
    Parenthetical original-work contexts require corroboration by parody tags
    or a second title/context, including the small explicit alias table above.
    No new title similarity, creator alias, or candidate uniqueness is invented.
    """
    result = {'safe_title': False, 'safe_for_work': False, 'safe_for_source': False,
              'rules': [], 'removed_annotations': [], 'rejections': []}
    if evidence.get('creator_conflicts') or evidence.get('event_conflict'):
        result['rejections'].append('creator_or_event_conflict')
        return result
    if not evidence.get('creator_matches'):
        result['rejections'].append('missing_creator_support')
        return result
    matches = [m for m in evidence.get('title_matches', [])
               if len(m.get('local_key', '')) >= 4]
    if not matches:
        result['rejections'].append('short_or_missing_core_title')
        return result
    if len([k for k, v in local.get('keys', {}).items() if v == 'strict']) > 1:
        result['rejections'].append('multiple_distinct_title_fragments')
        return result
    edition_ready = bool(local.get('language_hint') and evidence.get('language_match')
                         and not evidence.get('language_conflict')
                         and evidence.get('page_difference') == 0)
    infer_signature = bool(same_edition_unique and edition_ready)
    parsed_titles = gallery.get('_parsed', [])
    parity = {_context_identity(t.split(':', 1)[1], normalize)
              for t in gallery.get('tags', []) if t.startswith('parody:')}
    # Only contexts are used for corroboration; unrelated title substrings are
    # not accepted as proof of a franchise.
    database_contexts = {_context_identity(v, normalize)
                         for p in parsed_titles for v in p.get('contexts', [])}
    local_contexts = {_context_identity(v, normalize) for v in local.get('contexts', [])
                      if not recognized_annotation(v)}

    for title_match in matches:
        key = title_match['local_key']
        for remote in parsed_titles:
            if key not in remote.get('keys', {}):
                continue
            local_strength = local.get('keys', {}).get(key)
            remote_strength = remote['keys'][key]
            if local_strength == remote_strength == 'strict':
                continue
            removed, rejects, rules = [], [], []
            for side, parsed, strength in [('local', local, local_strength),
                                            ('database', remote, remote_strength)]:
                if strength == 'strict':
                    continue
                suffixes = parsed.get('unknown_suffixes', [])
                # A parser can stop on an unknown outer block, causing already
                # known inner edition blocks to appear in unknown_suffixes.
                for value in suffixes:
                    rule = recognized_annotation(value)
                    if rule is None and infer_signature and _plain_signature(value):
                        rule = 'signature_inferred_from_unique_creator_language_pages'
                    if rule is None:
                        rejects.append('unverified_or_structural_square_suffix')
                    else:
                        removed.append({'side': side, 'value': value, 'rule': rule})
                        rules.append(rule)
                if strength == 'context_removed':
                    for value in parsed.get('contexts', []):
                        rule = recognized_annotation(value)
                        identity = _context_identity(value, normalize)
                        if rule is None:
                            if STRUCTURAL_RE.search(value):
                                rejects.append('structural_parenthetical_scope')
                                continue
                            # Explicit parody tags take precedence over a title
                            # alias that would conflict with the named franchise.
                            if parity and identity not in parity:
                                rejects.append('parody_context_conflict')
                                continue
                            corroborating = parity | (database_contexts if side == 'local'
                                                      else local_contexts | {
                                _context_identity(v, normalize)
                                for other in parsed_titles if other is not remote
                                for v in other.get('contexts', [])})
                            if identity not in corroborating:
                                rejects.append('unverified_parenthetical_context')
                                continue
                            rule = 'parody_or_bilingual_title_context'
                        removed.append({'side': side, 'value': value, 'rule': rule})
                        rules.append(rule)
            if rejects:
                result['rejections'].extend(rejects)
                continue
            result.update(safe_title=True,
                          safe_for_work=not local.get('collection_hint', False),
                          safe_for_source=edition_ready,
                          matched_key=key,
                          rules=sorted(set(rules)), removed_annotations=removed,
                          rejections=[])
            return result
    result['rejections'] = sorted(set(result['rejections'])) or ['no_validated_weak_title_branch']
    return result
