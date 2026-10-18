"""Metadata routing and match policy. Returns data; never changes library files."""
from copy import deepcopy
import re
from urllib.parse import urlencode, urlsplit

import intake_metadata as meta
import intake_titles as titles
import series_identity as series

UPLOAD_TAGS={'extraneous ads','scanmark','watermarked','rough translation','rough grammar',
             'incomplete','missing cover','out of order','sample','already uploaded','defaced','replaced'}

class AmbiguousMatch(ValueError):
    pass


def core(text):
    text=re.sub(r'^\[(?:\d{2}|\d{4})\.\d{2}\]\s*','',text or '')
    return series.clean_title(text)


def scope(text):
    return series.split_title(core(text))


def credits(raw):
    artists=[t[7:] for t in raw['tags'] if t.startswith('artist:')]
    groups=[t[6:] for t in raw['tags'] if t.startswith('group:')]
    for text in (raw.get('title',''),raw.get('title_jpn','')):
        signed=titles.parse_title(text)['creators']
        artists=artists or signed['artists']
        groups=groups or signed['groups']
    return {'artists':artists,'groups':groups,'generic':[]}


def matches(book,raw,rules,*,family=False):
    context=meta.lookup_context(book)['parsed']
    wanted=context['creators']
    if not any(wanted.values()):
        wanted=context.get('directory_creators',wanted)
    tagged=credits(raw)
    # Signed native and translated names within one gallery are match evidence,
    # while the primary credit spelling remains stable in output metadata.
    variants=deepcopy(tagged)
    for text in (raw.get('title',''),raw.get('title_jpn','')):
        signed=titles.parse_title(text)['creators']
        for role in ('artists','groups'):
            variants[role].extend(signed[role]+signed.get('generic',[]))
    owner_confirmed=False
    for role in ('artists','groups'):
        names=wanted.get(role,[])
        if names:
            left={meta.canonical(n,role,rules) for n in names}
            right={meta.canonical(n,role,rules) for n in variants[role]}
            if not left.intersection(right): return False
            owner_confirmed=True
            if role=='artists': break
    if wanted.get('generic') and not owner_confirmed:
        left={meta.canonical(n,role,rules) for n in wanted['generic'] for role in ('artists','groups')}
        right={meta.canonical(n,role,rules) for role in ('artists','groups') for n in variants[role]}
        if not left.intersection(right): return False
        owner_confirmed=True
    if family and not owner_confirmed:
        return False
    local=scope(book['metadata']['title'])
    wanted_key=titles.normalize(local['series'] if family else local['title'])
    if len(wanted_key)<2 or family and not local['series']:
        return False
    def publication(text):
        return {(int(y),int(m)) for y,m in re.findall(r'((?:19|20)\d{2})\s*(?:年|[-./])\s*(0?[1-9]|1[0-2])(?:月|\b)',text)}
    local_pub=publication(book['parsed']['original'])
    source_pub=publication(raw.get('title','')+' '+raw.get('title_jpn',''))
    if not family and local_pub and source_pub and not local_pub.intersection(source_pub):
        return False
    if not family and context.get('contexts'):
        source_text=titles.normalize(' '.join([raw.get('title',''),raw.get('title_jpn','')]
            +[t.partition(':')[2] for t in raw['tags'] if t.startswith('parody:')]))
        if any(titles.normalize(value) not in source_text for value in context['contexts']):
            return False
    for text in (raw.get('title_jpn',''),raw.get('title','')):
        other=scope(text)
        key=titles.normalize((other['series'] or other['title']) if family else other['title'])
        if wanted_key==key and (family or local['number']==other['number']):
            return True
    return False


def selected_metadata(book,rows,rules,*,family=False):
    identities={tuple(sorted(meta.canonical(n,'artists',rules) for n in credits(row)['artists']))
                or tuple(sorted(meta.canonical(n,'groups',rules) for n in credits(row)['groups'])) for row in rows}
    if len(identities)!=1 or not next(iter(identities)):
        raise AmbiguousMatch('同名候选署名有歧义，请人工确认来源')
    if family and not book['metadata']['language']:
        raise ValueError('同系列参考不能推断本地语言，请补充 LanguageISO 或文件名语言注释')
    def content_tags(row):
        return sorted(meta.unique(t for t in row['tags'] if not t.startswith('language:')
            and not titles.EDITION_TAG_RE.search(t) and t.partition(':')[2].casefold() not in UPLOAD_TAGS))
    primary=max(rows,key=lambda r:(len(content_tags(r)),
                                  'language:'+next((k for k,v in meta.LANGUAGES.items() if v==book['metadata']['language']), '') in r['tags'],
                                  -abs(int(r.get('filecount',0))-book['page_count'])))
    if family:
        metadata=deepcopy(book['metadata'])
        signed=credits(primary)
        metadata['artists']=metadata['artists'] or signed['artists']
        metadata['groups']=metadata['groups'] or signed['groups']
    else:
        metadata=meta.choose_gallery(book,[primary],rules,direct=True)
    keys=content_tags(primary)
    metadata['raw_tags']=book['metadata']['raw_tags'] or keys
    metadata['tags']=book['metadata']['tags']
    if family:
        # References supply tags, never current-volume identity or placement.
        metadata.update(title=book['metadata']['title'],series=book['metadata']['series'],
                        number=book['metadata']['number'],volume=book['metadata']['volume'],
                        web=book['metadata']['web'],source_titles=deepcopy(book['metadata']['source_titles']))
    return metadata


class Resolver:
    def __init__(self,client,searcher,nhentai,*,series_tags=False,hash_lookup=False):
        self.client,self.searcher,self.nhentai=client,searcher,nhentai
        self.series_tags,self.hash_lookup=series_tags,hash_lookup

    def prefetch(self,books):
        self.client.fetch(pair for book in books for pair in book.get('pairs',[]))

    def queries(self,book,*,family=False):
        context=meta.lookup_context(book)
        values=meta.lookup.discovery_queries(context)
        if family:
            name=scope(book['metadata']['title'])['series']
            return ['title:"'+name.replace('"',' ')+'"'] if name else []
        simple=core(book['metadata']['title']).replace('"',' ')
        if len(titles.normalize(simple))>=2:
            values=meta.unique(['title:"'+simple+'"',*values])
        return values[:3]

    def plan(self,book):
        return {'filename':book['filename'],'pairs':book.get('pairs',[]),
                'queries':[] if book.get('pairs') else self.queries(book),
                'providers':['ehentai','nhentai'],'series_tags':self.series_tags,'hash_lookup':self.hash_lookup}

    def resolve(self,book,rules):
        if book.get('nhentai_source_ids'):
            rows=[self.nhentai.gallery(gid) for gid in book['nhentai_source_ids']]
            metadata=meta.choose_gallery(book,rows,rules,direct=True)
            return {'status':'matched','metadata':metadata,'match_scope':'direct_nhentai',
                    'references':[source_url(row) for row in rows]}
        errors,reference_rows=[],[]
        replace_source=False
        pairs=book.get('pairs',[])
        if pairs:
            self.client.fetch(pairs)
            results=[self.client.results.get(tuple(p),{}) for p in pairs]
            rows=[r['gallery'] for r in results if r.get('gallery')]
            if rows:
                metadata=meta.choose_gallery(book,rows,rules,direct=True)
                return {'status':'matched','metadata':metadata,'match_scope':'direct','references':[metadata['web']]}
            # A network error or invalid token is not an absent work.
            if book.get('source_override') or not all(r.get('state')=='not_found' for r in results):
                raise ValueError('；'.join(meta.unique(r.get('error','来源查询失败') for r in results)))
            book={**book,'source_override':True}
            replace_source=True
        for provider in ('ehentai','nhentai'):
            for query in self.queries(book):
                try:
                    rows,complete=self.discover(provider,query,book)
                    if not complete:
                        errors.append(provider+' 名称检索未完成')
                        continue
                    reference_rows.extend(rows)
                    matched=[r for r in rows if matches(book,r,rules)]
                    if matched:
                        return {'status':'matched','metadata':selected_metadata(book,matched,rules),
                                'match_scope':'exact','references':[source_url(r) for r in matched],
                                'replace_source':replace_source}
                except AmbiguousMatch as error:
                    return {'status':'ambiguous','metadata':None,'match_scope':'','references':[],'reason':str(error)}
                except ValueError as error:
                    errors.append(str(error))
        if self.hash_lookup and not self.searcher.offline:
            import intake_inputs
            for sha in intake_inputs.hash_samples(book):
                try:
                    rows=self.hash_rows(sha)
                except ValueError as error:
                    errors.append(str(error))
                    break
                matched=[r for r in rows if matches(book,r,rules)]
                if matched:
                    return {'status':'matched','metadata':selected_metadata(book,matched,rules),
                            'match_scope':'hash','references':[source_url(r) for r in matched],
                            'replace_source':replace_source}
        if self.series_tags:
            for provider in ('ehentai','nhentai'):
                for query in self.queries(book,family=True):
                    try:
                        rows,complete=self.discover(provider,query,book,family=True)
                        if complete: reference_rows.extend(rows)
                    except ValueError as error: errors.append(str(error))
            matched=[r for r in reference_rows if matches(book,r,rules,family=True)]
            if matched:
                return {'status':'matched','metadata':selected_metadata(book,matched,rules,family=True),
                        'match_scope':'series_reference','references':meta.unique(source_url(r) for r in matched)}
        return {'status':'error' if errors else 'not_found','metadata':None,'match_scope':'',
                'references':[],'reason':'；'.join(meta.unique(errors)) or '各数据源未找到可确认的作品，原位保留'}

    def discover(self,provider,query,book=None,*,family=False):
        if provider=='ehentai':
            result=self.searcher.search(query)
            if result['state'] in {'failed','offline'}:
                raise ValueError(result.get('error') or 'e-hentai 检索失败')
            self.client.fetch(result['pairs'])
            results=[self.client.results[tuple(p)] for p in result['pairs']]
            rows=[r['gallery'] for r in results if r.get('gallery')]
            return rows,result['complete'] and all(r.get('gallery') for r in results)
        # The official search API uses plain phrases rather than EH's title namespace.
        query=re.sub(r'\btitle:', '',query)
        summaries,complete=self.nhentai.search(query)
        if not complete:
            return [],False
        if book:
            local=scope(book['metadata']['title'])
            wanted=titles.normalize(local['series'] if family else local['title'])
            summaries=[r for r in summaries if any(wanted==titles.normalize(
                (scope(r.get(k,''))['series'] or scope(r.get(k,''))['title']) if family else scope(r.get(k,''))['title'])
                for k in ('english_title','japanese_title'))]
        return [self.nhentai.gallery(r['id']) for r in summaries],complete

    def hash_rows(self,sha):
        raw,final_url=self.searcher.read_page(meta.lookup.SEARCH_ORIGIN+'?'+urlencode({'f_shash':sha,'fs_covers':'0','fs_similar':'0'}))
        if urlsplit(final_url).netloc!='e-hentai.org' or len(raw)>2*1024*1024:
            raise ValueError('e-hentai 哈希响应地址或大小异常，原位保留')
        text=raw.decode('utf-8',errors='replace')
        page=meta.lookup.SearchPage(); page.feed(text)
        if not page.has_search_form or meta.lookup.BLOCKED.search(text) or not page.pairs and not meta.lookup.EMPTY.search(text):
            raise ValueError('e-hentai 哈希响应未确认，原位保留')
        self.client.fetch(page.pairs)
        return [self.client.results[p]['gallery'] for p in page.pairs if self.client.results.get(p,{}).get('gallery')]


def source_url(row):
    return row.get('url') or f"https://e-hentai.org/g/{row['gid']}/{row['token']}/"
