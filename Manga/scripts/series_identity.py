"""Shared conservative title segmentation, independent of historical library rules.

No author aliases, per-book overrides, old database or expected series as inputs.
It proposes structured fields; untouched raw titles remain available for review.
"""
import html,re,unicodedata

PART_RANK={'前編':1,'中編':2,'後編':3,'上':1,'中':2,'下':3}
PART_TOKEN=r'(?:前[編篇]|中[編篇]|後[編篇]|[上中下](?:巻|卷|編|篇))'
SCOPED_STATES={'numbered','named_part'}
PUBLICATION_CATEGORIES={'Doujinshi','Manga','Artist CG'}
RANGE_RE=re.compile(r'(?<![\d.])(\d+(?:\.\d+)?)\s*[-–—~～〜/+&_,，、]\s*(\d+(?:\.\d+)?)(?![\d.])')

def intrinsic_number(tail):
    return bool(re.match(r'\s*(?:号室|號室|号技|號技|分[の之]|人|にん|つ|個|个|[ヶケか箇个個]?月|週間|週|泊|日|年|時間|時|分|秒|歳|才)',tail)
                or re.match(r'[\s-]*(?:years?|months?|weeks?|days?|hours?|minutes?|seconds?|bun|nin|tsu|goushitsu)\b',tail,re.I))

def collection_range(title):
    for match in RANGE_RE.finditer(title):
        tail=title[match.end():]
        if intrinsic_number(tail) or re.match(r'[a-zA-Z]',tail):continue
        if len(normal(title[:match.start()]))>=2:return match
    return None

def canonical_part(value):
    value=(value or '').replace('篇','編')
    if value=='中編':return value
    return re.sub(r'^(上|中|下)(?:巻|卷|編)$',r'\1',value)

def multiple_issues(scopes):
    """Different editions of a volume/part do not establish a new series."""
    values={(str(number),canonical_part(part)) for number,part in scopes}
    numbers={number for number,part in values if number}
    if len(numbers)>1:return True
    if ('','') in values and any(re.fullmatch(r'\d+(?:\.\d+)?',n) and float(n)>1 for n in numbers):return True
    ranks={PART_RANK.get(part,part) for number,part in values if part}
    return len(ranks)>1

def normal(text):
    return ''.join(c for c in unicodedata.normalize('NFKC',text or '').casefold() if c.isalnum())

def clean_title(text):
    text=unicodedata.normalize('NFKC',html.unescape(text or ''))
    # API convention: (event) [creator] title. No event-name dictionary.
    text=re.sub(r'^\s*\([^)]*\)\s*(?=\[)','',text)
    def annotation(match):
        value=match[0][1:-1]
        # Brackets may contain a chapter/volume, not merely an upload annotation.
        if (re.search(r'第?\d+\s*(?:巻|卷|話|话|章)|(?:vol(?:ume)?|chapter)\.?\s*\d+',value,re.I)
                or (text[:match.start()].strip() and re.fullmatch(PART_TOKEN+r'|[上中下]',value.strip()))):
            return ' '+value+' '
        return ' '
    text=re.sub(r'\[[^\]]*\]|【[^】]*】',annotation,text)
    text=text.split('|')[0].strip()
    while (m:=re.search(r'\s*\(([^()]*)\)\s*$',text)):
        if m.start()==0 or re.fullmatch(PART_TOKEN+r'|[上中下]',m[1].strip()):break
        text=text[:m.start()].strip()
    return re.sub(r'\s+',' ',text).strip()

def split_title(text):
    title=clean_title(text)
    ordinal=re.fullmatch(r'(.+?)\s*其ノ([一二三四五六七八九十])(?![一二三四五六七八九十])(.*)',title)
    if ordinal:
        return {'title':title,'series':ordinal[1].strip(),
                'number':str('一二三四五六七八九十'.index(ordinal[2])+1),
                'part':'','subtitle':ordinal[3].strip(),'state':'numbered'}
    month_issue=re.fullmatch(r'(.+?)\s*((?:19|20)\d{2})\s*(?:年|[-./])\s*(0?[1-9]|1[0-2])\s*(?:月(?:号|號)?)?',title)
    if month_issue:
        base,year,month=month_issue.groups()
        return {'title':title,'series':base.strip(),'number':f'{year}.{int(month):02d}',
                'part':'','subtitle':'','state':'numbered'}
    hits=list(re.finditer(r'\d+(?:\.\d+)?',title))
    # A collection range is one book, not its rightmost volume.
    range_match=collection_range(title)
    if range_match:
        base=title[:range_match.start()].rstrip(' -~～〜—–+_/#').strip()
        if len(normal(base))>=2:
            return {'title':title,'series':base,'number':'','part':'',
                    'subtitle':title[range_match.start():],'state':'range_requires_review'}
    # Repeated language titles can repeat the same numbered heading after a subtitle.
    # Only identical headings are collapsed; contradictory copies need review.
    usable=[m for m in hits if not intrinsic_number(title[m.end():])]
    if len(usable)>1:
        first,last=usable[0],usable[-1]
        heading=title[:first.start()].strip()
        repeated=re.search(r'(?:^|[\s~～〜|｜:：—–-])'+re.escape(heading)+r'\s*$',title[:last.start()],re.I) if heading else None
        if repeated and len(normal(heading))>=2:
            if first[0]!=last[0]:
                return {'title':title,'series':heading,'number':'','part':'','subtitle':title[first.end():],
                        'state':'ambiguous_requires_review'}
            hits=[first]
    # An explicit chapter/volume marker outranks a subtitle counter (その1).
    # Multiple explicit markers retain the existing conservative handling.
    explicit=[m for m in hits
              if (re.search(r'第\s*$',title[:m.start()])
                  and re.match(r'\s*(?:巻|卷|話|话|章)',title[m.end():]))
              or re.search(r'(?:^|\s)(?:vol(?:ume)?|chapter)\.?\s*$',title[:m.start()],re.I)]
    # A local double-hyphen suffix identifies a chapter inside a named volume.
    compound_chapter=re.search(r'\s--\s*\d+(?:\.\d+)?\s*$',title)
    if len(explicit)==1 and not compound_chapter:hits=explicit
    for match in reversed(hits):
        tail=title[match.end():]
        series=title[:match.start()].strip()
        series=re.sub(r'(?:vol(?:ume)?\.?|#|第)\s*$','',series,flags=re.I)
        series=re.sub(r'(?:\s+season|\s*シーズン)\s*$','',series,flags=re.I)
        series=series.rstrip(' -~～〜—–+_/#').strip()
        if len(normal(series))<2:continue
        # A year plus season code is a publication date, not a volume number.
        if (re.fullmatch(r'(?:\d{2}|(?:19|20)\d{2})',match[0])
                and re.match(r'\s*(?:SS|FW|AW)(?=$|[\s()\[\]{}:：_+~～〜—–-])',tail,re.I)):
            return {'title':title,'series':series,'number':'','part':'','subtitle':tail.strip(),'state':'date_requires_review'}
        if re.match(r'(?:19|20)\d{2}(?:\.\d{1,2})?$',match[0]) and re.match(r'\s*(?:[年月./-]|$)',tail):
            if len(hits)>1:continue
            return {'title':title,'series':series,'number':'','part':'','subtitle':tail.strip(),'state':'date_requires_review'}
        if re.fullmatch(r'(?:19|20)\d{2}',match[0]) and re.match(r'\s*(?:総集|總集|合集|春|夏|秋|冬|SS|FW|AW)',tail,re.I):continue
        # Numbers inside ordinary title phrases (e.g. 7日間) are not volumes.
        if intrinsic_number(tail):continue
        # A part is a scope token, not a word embedded inside a subtitle.
        part=re.search(r'(?:^|[\s(【\[~～:：-])(前[編篇]|中[編篇]|後[編篇]|(?:上|中|下)(?:巻|卷|編|篇))(?=$|[\s)】\]~～:：-])',tail)
        named=part[1] if part else ''
        if not named:
            part=re.search(r'\((上|中|下)\)',tail)
            named=part[1] if part else ''
        if not named:
            end=re.search(r'(?:^|\s)(上|中|下)\s*$',tail)
            named=end[1] if end else ''
        integer,dot,fraction=match[0].partition('.')
        return {'title':title,'series':series,'number':(integer.lstrip('0') or '0')+dot+fraction,'part':canonical_part(named),
                'subtitle':tail.strip(' -~～〜—–'),'state':'numbered'}
    part=re.fullmatch(r'(.*?)\s*[\(\[【]?('+PART_TOKEN+r')[\)\]】]?\s*',title)
    if not part:
        part=re.fullmatch(r'(.*?)(?:\s+|\s*[\(\[【])([上中下])[\)\]】]?\s*',title)
    if part:
        base=part[1].strip();marker=canonical_part(part[2])
        if re.search(r'(?:'+PART_TOKEN+r'|[上中下])\s*[+&/,，、~～〜-]\s*$',base):
            return {'title':title,'series':base,'number':'','part':'','subtitle':'','state':'range_requires_review'}
        base=base.rstrip(' -~～〜—–+_/#').strip()
        if len(normal(base))>=2:
            return {'title':title,'series':base,'number':'','part':marker,'subtitle':'','state':'named_part'}
    return {'title':title,'series':'','number':'','part':'','subtitle':'','state':'unscoped'}

def match_title_anchor(text,anchor):
    """A known publication heading must end at a title boundary, never a raw prefix."""
    scope=split_title(text)
    if scope['state'] not in SCOPED_STATES|{'unscoped'}:return None
    if normal(scope['series'] or scope['title'])==normal(anchor):return scope
    title=scope['title']
    match=re.match(re.escape(unicodedata.normalize('NFKC',anchor))+r'(?=$|[\s×~～〜:：—–-])',title,re.I)
    if not match:return None
    remainder=title[match.end():]
    tail=remainder.strip(' ~～〜:：—–-')
    if re.match(r'(?:IF|SP|EX|extra|special|番外|総集|總集|合集)(?:\b|$)',tail,re.I):return None
    if scope['state']=='unscoped' and re.match(r'\s*(?:[×~～〜:：—–-]|x\s)',remainder,re.I):
        return {**scope,'series':anchor}
    # Anchors do not authorize discarding a number hidden in an unrelated subtitle.
    return None

def parse_gallery(gallery):
    result=split_title(gallery.get('title_jpn') or gallery.get('title',''))
    tags=gallery.get('tags',[])
    result.update(artists=[t.partition(':')[2] for t in tags if t.startswith('artist:')],
                  groups=[t.partition(':')[2] for t in tags if t.startswith('group:')],
                  languages=[t.partition(':')[2] for t in tags if t.startswith('language:') and t!='language:translated'],
                  filecount=int(gallery.get('filecount',0)))
    result['creator_role']='artist' if len(result['artists'])==1 else 'group' if not result['artists'] and len(result['groups'])==1 else 'review'
    result['creator_key']=result['artists'][0] if result['creator_role']=='artist' else result['groups'][0] if result['creator_role']=='group' else ''
    return result

def compatible(local_title,proposal):
    local=split_title(local_title)
    if proposal['state']=='unnumbered_base':
        return local['state']=='unscoped' and normal(local['title'])==normal(proposal['series'])
    return (local['state'] in SCOPED_STATES and proposal['state'] in SCOPED_STATES
            and normal(local['series'])==normal(proposal['series'])
            and local['number']==proposal['number'] and local['part']==proposal['part'])

def index_api_families(galleries):
    """Learn title anchors only from this batch's API records, within a creator."""
    parsed=[parse_gallery(g) for g in galleries]
    families={}
    for p in parsed:
        if p['state'] not in SCOPED_STATES or not p['creator_key']:continue
        key=(p['creator_role'],normal(p['creator_key']),normal(p['series']))
        family=families.setdefault(key,{'series':p['series'],'scopes':set()})
        family['scopes'].add((p['number'],p['part']))
    bare={(p['creator_role'],normal(p['creator_key']),normal(p['title'])) for p in parsed if p['state']=='unscoped' and p['creator_key']}
    return {k:v['series'] for k,v in families.items()
            if multiple_issues(v['scopes'] | ({('','')} if k in bare else set()))}

def match_api_family(proposal,families):
    """Recognize a subtitle before a stable series; never merge by author alone."""
    p=dict(proposal)
    if p['state'] not in SCOPED_STATES|{'unscoped'} or not p['creator_key']:return p
    creator_keys={normal(p['creator_key']),normal(p.get('api_creator_key',''))}-{''}
    if p['state']=='unscoped':
        choices={series for (role,creator,key),series in families.items()
                 if role==p['creator_role'] and creator in creator_keys and normal(p['title'])==key}
        if len(choices)==1:
            p.update(series=next(iter(choices)),state='unnumbered_base',title_family_match='exact_base_in_same_creator_numbered_family')
        return p
    choices=[series for (role,creator,key),series in families.items()
             if role==p['creator_role'] and creator in creator_keys
             and normal(p['series']).endswith(key)]
    if len(choices)!=1 or normal(p['series'])==normal(choices[0]):return p
    parts={canonical_part(v) for v in re.findall(r'(?:^|\s)(前[編篇]|中[編篇]|後[編篇])(?=\s|$)',p['series'])}
    if len(parts)>1 or (p['part'] and parts and p['part'] not in parts):return p
    p.update(series=choices[0],part=p['part'] or next(iter(parts),''),
             title_family_match='same_creator_multi_volume_api_anchor')
    return p

