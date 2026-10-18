"""Bounded anonymous EH title discovery, with persistent positive/empty caches.

Search results supply gallery links only. Work identity and tags are validated
later against gdata; HTML titles, snippets and result order never confirm a book.
"""
from __future__ import annotations

import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import time
from urllib.parse import parse_qs, urlencode, urljoin, urlsplit
import urllib.error
import urllib.request

import annotation_evidence
import intake_titles as matcher

SEARCH_ORIGIN = 'https://e-hentai.org/'
LINK = re.compile(r'^https?://(?:e-hentai\.org|exhentai\.org)/g/([1-9]\d*)/([0-9a-fA-F]{10})/?$')
EMPTY = re.compile(r'no hits found|no galleries found|no results found', re.I)
INVALID_SEARCH = re.compile(r'unsupported syntax|terms.{0,60}too short|otherwise not valid|invalid search',re.I)
EMPTY_VALIDATION='recognized-empty-without-query-warning.v1'
BLOCKED = re.compile(r'please log in|please login|sign in to continue|sad panda|'
                     r'checking your browser|just a moment|captcha|temporarily banned|'
                     r'exceeded.*(?:limit|requests)|access denied', re.I)


def query_syntax_issue(query):
    # A standalone one/two-digit quoted term is rejected by the search engine.
    # Combine a volume with its title phrase rather than issuing that term.
    if any(re.fullmatch(r'\d{1,2}',term) for term in re.findall(r'\btitle:"([^"]*)"',query)):
        return 'standalone_short_numeric_title_term'
    return None


def searchable_title(value, book):
    key = matcher.normalize(value)
    creators = book['parsed'].get('filename_creators', book['parsed'].get('creators', {}))
    return (len(key) >= 4 or bool(re.fullmatch(r'[\u3040-\u30ff\u3400-\u9fff]{2,3}', key)
                                  and any(creators.values())))


def title_queries(book):
    """Remove retrieval annotations while retaining volume and collection scope."""
    core = book['parsed']['core'].strip()
    while (tail := matcher.TRAILING_SQUARE_RE.search(core)):
        if annotation_evidence.STRUCTURAL_RE.search(tail.group(1)):
            break
        core = core[:tail.start()].strip()
    variants = [core]
    tail = matcher.TRAILING_ROUND_RE.search(core)
    if tail and not annotation_evidence.STRUCTURAL_RE.search(tail.group(1)):
        variants.append(core[:tail.start()].strip())
    # Phrase searches are sensitive to punctuation in translated/upload titles.
    # This is retrieval only; the matcher still checks full title and scope.
    punctuated = re.split(r'[。!?！？]+', core)
    if len(punctuated) > 1:
        variants.append([part.strip() for part in punctuated if part.strip()])
    queries = []
    for value in variants:
        parts = value if isinstance(value, list) else [value]
        parts = [part.replace('"', ' ').strip() for part in parts]
        if any(re.fullmatch(r'\d{1,2}',part) for part in parts):
            parts=[' '.join(parts)]
        if parts and searchable_title(' '.join(parts), book) and sum(map(len, parts)) <= 180:
            query = ' '.join('title:"' + part + '"' for part in parts)
            if query not in queries:
                queries.append(query)
    return queries[:2]


def creator_query(book):
    """One bounded retrieval fallback for translations with an unknown title."""
    if not title_queries(book):
        return None
    creators = book['parsed'].get('filename_creators', book['parsed'].get('creators', {}))
    for role in ('artists', 'generic', 'groups'):
        for name in creators.get(role, []):
            name = name.replace('"', ' ').strip()
            if len(matcher.normalize(name)) >= 2 and len(name) <= 80:
                return 'title:"' + name + '"'
    return None


def discovery_queries(book):
    queries = title_queries(book)
    fallback = creator_query(book)
    if fallback and fallback not in queries:
        queries.append(fallback)
    return queries


class SearchPage(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.pairs, self.next_url, self.has_search_form = set(), None, False

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == 'input' and values.get('name') == 'f_search':
            self.has_search_form = True
        if tag != 'a':
            return
        href = values.get('href', '')
        absolute = urljoin(SEARCH_ORIGIN, href)
        if match := LINK.fullmatch(absolute):
            self.pairs.add((int(match.group(1)), match.group(2).lower()))
        if values.get('id') in {'unext', 'dnext'} and href and not href.startswith('#'):
            self.next_url = absolute


def valid_next_url(url, query):
    if not url:
        return None
    parsed = urlsplit(url)
    values = parse_qs(parsed.query)
    if (parsed.scheme != 'https' or parsed.netloc != 'e-hentai.org' or parsed.path != '/'
            or values.get('f_search') != [query] or not values.get('next')):
        return None
    marker = values['next'][0]
    if not re.fullmatch(r'\d+', marker):
        return None
    return SEARCH_ORIGIN + '?' + urlencode({'f_search': query, 'next': marker})


class SearchClient:
    def __init__(self, cache, writer, *, offline=False, cache_hours=168, empty_hours=12,
                 timeout=20, max_pages=2, max_candidates=50, opener=None,
                 sleeper=time.sleep, monotonic=time.monotonic, attempts=2):
        self.cache, self.writer = Path(cache), writer
        self.offline, self.ttl, self.empty_ttl = offline, cache_hours * 3600, empty_hours * 3600
        self.timeout, self.max_pages, self.max_candidates = timeout, max_pages, max_candidates
        self.opener, self.sleep, self.monotonic = opener or urllib.request.urlopen, sleeper, monotonic
        self.last_call, self.calls, self.memo, self.queries = None, 0, {}, []
        self.blocked_reason = None
        self.attempts = max(1, attempts)

    def read_page(self, url):
        for attempt in range(self.attempts):
            if self.last_call is not None:
                self.sleep(max(0, 3.2 - (self.monotonic() - self.last_call)))
            request = urllib.request.Request(url, headers={'User-Agent': 'MangaHMetadata/1.1',
                                                          'Accept': 'text/html'})
            self.calls += 1
            self.last_call = self.monotonic()
            try:
                with self.opener(request, timeout=self.timeout) as response:
                    return response.read(2 * 1024 * 1024 + 1), getattr(response, 'url', url)
            except (OSError, urllib.error.URLError) as error:
                if (attempt + 1 == self.attempts or
                        isinstance(error, urllib.error.HTTPError) and error.code < 500):
                    raise
                self.sleep(5 * (attempt + 1))

    def search(self, query):
        if query in self.memo:
            return self.memo[query]
        if issue:=query_syntax_issue(query):
            return self._save({'query':query,'pairs':[],'complete':False,'state':'failed',
                              'error_code':'invalid_query','error':issue})
        path = self.cache / (hashlib.sha256(query.encode('utf-8')).hexdigest() + '.json')
        try:
            value = json.loads(path.read_text(encoding='utf-8-sig'))
            age = time.time() - float(value['fetched_at_unix'])
            ttl = self.ttl if value['pairs'] else self.empty_ttl
            if (value.get('schema') != 'mangah.eh-search-cache' or value['query'] != query
                    or not isinstance(value['pairs'], list)
                    or any(len(p) != 2 or type(p[0]) is not int or p[0] < 1
                           or not re.fullmatch(r'[0-9a-f]{10}', p[1]) for p in value['pairs'])):
                raise ValueError('Invalid search cache')
            if not value['pairs'] and value.get('empty_validation')!=EMPTY_VALIDATION:
                raise ValueError('Legacy empty cache lacks query-warning validation')
            if 0 <= age < ttl:
                return self._save({**value, 'state': 'cached'})
            if self.offline:
                return self._save({**value, 'state': 'stale'})
        except (OSError, KeyError, ValueError, TypeError):
            pass
        if self.offline:
            return self._save({'query': query, 'pairs': [], 'complete': False, 'state': 'offline',
                               'error': 'Online title discovery is disabled and has no usable cache'})
        if self.blocked_reason:
            return self._save({'query': query, 'pairs': [], 'complete': False, 'state': 'failed',
                               'error': 'Further searches suspended for this run: ' + self.blocked_reason})
        url = SEARCH_ORIGIN + '?' + urlencode({'f_search': query})
        pairs, pages, visited = set(), 0, set()
        complete = False
        try:
            while url and pages < self.max_pages:
                if url in visited:
                    raise ValueError('Repeated search pagination URL')
                visited.add(url)
                raw, final_url = self.read_page(url)
                if urlsplit(final_url).netloc != 'e-hentai.org':
                    raise ValueError('Search redirected outside the public EH site')
                if len(raw) > 2 * 1024 * 1024:
                    raise ValueError('Search response exceeds the size limit')
                text = raw.decode('utf-8', errors='replace')
                page = SearchPage()
                page.feed(text)
                if BLOCKED.search(text):
                    self.blocked_reason = 'Search requires login or was blocked'
                    raise ValueError(self.blocked_reason + '; no empty result inferred')
                if not page.has_search_form:
                    raise ValueError('Search requires login or was blocked; no empty result inferred')
                if INVALID_SEARCH.search(text):
                    return self._save({'query':query,'pairs':sorted(pairs),'complete':False,'pages':pages,
                        'state':'failed','error_code':'invalid_query','error':'Search engine rejected the query; not an empty search result'})
                if not page.pairs and not EMPTY.search(text):
                    raise ValueError('Unrecognized search page; no empty result inferred')
                pairs.update(page.pairs)
                pages += 1
                next_url = valid_next_url(page.next_url, query)
                if page.next_url and next_url is None:
                    raise ValueError('Unrecognized search pagination; candidate completeness unknown')
                url = next_url
                complete = not url and len(pairs) <= self.max_candidates
                if len(pairs) > self.max_candidates:
                    break
            value = {'schema': 'mangah.eh-search-cache', 'query': query,
                     'fetched_at_unix': time.time(), 'pairs': sorted(pairs)[:self.max_candidates],
                     'complete': complete, 'pages': pages, 'state': 'searched'}
            if not pairs:value['empty_validation']=EMPTY_VALIDATION
            self.writer(path, value)
            return self._save(value)
        except (OSError, ValueError, urllib.error.URLError) as error:
            if isinstance(error, urllib.error.HTTPError) and error.code in {401, 403, 429}:
                self.blocked_reason = 'Search returned HTTP ' + str(error.code)
            return self._save({'query': query, 'pairs': sorted(pairs)[:self.max_candidates],
                               'complete': False, 'pages': pages, 'state': 'failed', 'error': str(error)})

    def _save(self, value):
        self.memo[value['query']] = value
        self.queries.append(value)
        return value

    def find(self, book):
        observations = []
        for query in discovery_queries(book):
            value = self.search(query)
            observations.append(value)
            if value['pairs'] or value['state'] in {'failed', 'offline'}:
                break
        pairs = {tuple(pair) for value in observations for pair in value['pairs']}
        complete = bool(observations) and all(value['complete'] for value in observations)
        return sorted(pairs), complete, observations
