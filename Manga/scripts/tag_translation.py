"""Offline, reversible EH tag labels. Canonical keys never change."""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re

DEFAULT_DATABASE = Path(__file__).resolve().parents[1] / 'data' / 'translations' / 'db.text.json'
POLICY = 'ehtag-zh-v1'
SOURCE = 'https://github.com/EhTagTranslation/Database'
IDENTITY_NAMESPACES = {'artist', 'group', 'cosplayer'}


def unique(values):
    return list(dict.fromkeys(values))


def safe_label(value):
    if not isinstance(value, str) or not value.strip() or len(value) > 300:
        raise ValueError('Invalid translation label')
    # ComicInfo splits ASCII commas. Never let a label create extra tags.
    if re.search(r'[<>\x00-\x1f]', value):
        raise ValueError('Translation name is not plain text')
    return value.strip().replace(',', '，')


class Dictionary:
    def __init__(self, path=DEFAULT_DATABASE, overrides=None):
        raw = Path(path).read_bytes()
        if len(raw) > 64 * 1024 * 1024:
            raise ValueError('Translation database exceeds 64 MiB')
        value = json.loads(raw)
        if value.get('version') != 7 or not isinstance(value.get('data'), list):
            raise ValueError('Unsupported EhTagTranslation database schema')
        self.namespaces, self.entries = {}, {}
        for row in value['data']:
            namespace = row['namespace']
            if namespace in self.namespaces:
                raise ValueError('Duplicate translation namespace')
            self.namespaces[namespace] = safe_label(row['frontMatters']['name'])
            for key, entry in row['data'].items():
                if isinstance(entry.get('name'), str) and entry['name'].strip():
                    self.entries[namespace + ':' + key] = safe_label(entry['name'])
        if not self.entries or 'language:chinese' not in self.entries:
            raise ValueError('Translation database is incomplete')
        overrides = Path(overrides) if overrides else Path(path).with_name('overrides.json')
        override_raw = overrides.read_bytes() if overrides.exists() else b'{}'
        custom = json.loads(override_raw)
        if not isinstance(custom, dict):
            raise ValueError('Translation overrides must map canonical keys to labels')
        self.overrides = {key: safe_label(label) for key, label in custom.items()}
        self.entries.update(self.overrides)
        self.flat = {}
        for canonical, label in self.entries.items():
            ns, _, name = canonical.partition(':')
            if ns in {'male', 'female', 'mixed', 'other', 'location'}:
                self.flat.setdefault(name, set()).add(label)
        self.identity = {'policy': POLICY, 'source': SOURCE, 'schema_version': value['version'],
            'commit': value.get('head', {}).get('sha'), 'sha256': hashlib.sha256(raw).hexdigest(),
            'overrides_sha256': hashlib.sha256(override_raw).hexdigest()}

    def label(self, canonical):
        namespace, separator, key = canonical.partition(':')
        if namespace == 'tag':
            labels = self.flat.get(key, set())
            return ('标签：' + next(iter(labels)), 'translated') if len(labels) == 1 else (canonical, 'unmapped')
        if namespace == 'category':
            return self.label('reclass:' + key)
        if separator and namespace in {'circle', 'event', 'platform'}:
            return {'circle': '社团', 'event': '展会', 'platform': '平台'}[namespace] + '：' + key, 'identity_preserved'
        if not separator or namespace not in self.namespaces:
            return canonical, 'unmapped'
        # Keep creator spelling stable; translating a credit isn't identity proof.
        if namespace in IDENTITY_NAMESPACES and canonical not in self.overrides:
            return self.namespaces[namespace] + '：' + key, 'identity_preserved'
        translated = self.entries.get(canonical)
        if not translated:
            return canonical, 'unmapped'
        return self.namespaces[namespace] + '：' + translated, 'translated'

    def project(self, canonical):
        rows = []
        for key in unique(canonical):
            label, state = self.label(key)
            rows.append({'key': key, 'label': label, 'state': state})
        # Homonyms remain distinct in Komga's otherwise flat set of strings.
        labels = {}
        for row in rows:
            labels.setdefault(row['label'], []).append(row)
        for collisions in labels.values():
            if len(collisions) > 1:
                for row in collisions:
                    row['label'] += ' [' + row['key'] + ']'
        return rows


