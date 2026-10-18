"""Official v2 transport and bounded cache. No book, naming or library rules."""
from pathlib import Path
import hashlib
import json
import os
import time
from urllib.parse import urlencode, urlsplit
import urllib.error
import urllib.request

ORIGIN = 'https://nhentai.net/api/v2/'

class SameOriginRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        if (urlsplit(newurl).scheme,urlsplit(newurl).netloc)!=('https','nhentai.net'):
            raise ValueError('nhentai 拒绝跨站重定向，密钥不会转发')
        return super().redirect_request(request,fp,code,msg,headers,newurl)


class Client:
    def __init__(self, cache, *, offline=False, refresh=False, key=None,
                 opener=None, sleeper=time.sleep, timeout=25):
        self.cache, self.offline, self.refresh = Path(cache), offline, refresh
        self.key = key if key is not None else os.environ.get('NHENTAI_API_KEY', '')
        self.open, self.sleep, self.timeout = opener or urllib.request.build_opener(SameOriginRedirect()).open, sleeper, timeout
        self.calls, self.last, self.memo = 0, None, {}
        self.blocked = ''

    def get(self, endpoint, **params):
        url = ORIGIN + endpoint + ('?' + urlencode(params) if params else '')
        if url in self.memo:
            return self.memo[url]
        path = self.cache / (hashlib.sha256(url.encode()).hexdigest() + '.json')
        try:
            cached = json.loads(path.read_bytes())
            data = cached['response']
            ttl = 12 if endpoint in {'search','galleries/tagged'} and not data.get('result') else 168
            if (cached.get('schema') == 'manga.nh-v2-cache' and cached['url'] == url
                    and (self.offline or not self.refresh and 0 <= time.time()-cached['time'] < ttl*3600)):
                self.memo[url] = data
                return data
        except (OSError, ValueError, KeyError, TypeError):
            pass
        if self.offline:
            raise ValueError('nhentai 离线缓存没有可用结果')
        if self.blocked:
            raise ValueError(self.blocked)
        # Official /api/v2/openapi.json: anonymous search 10/min; tagged and
        # tag lookup 15/min; gallery details 20/min. Keep a conservative global
        # 15/min for documented metadata routes and 10/min for search.
        metadata_route = (endpoint == 'galleries/tagged' or endpoint.startswith('tags/')
                          or endpoint.startswith('galleries/') and endpoint[len('galleries/'):].isdigit())
        interval = (4.2 if endpoint == 'tags/ids' else 3.2) if self.key else (4.2 if metadata_route else 6.2)
        for attempt in range(3):
            if self.last is not None:
                self.sleep(max(0, interval - (time.monotonic()-self.last)))
            headers = {'Accept':'application/json', 'User-Agent':'MangaMetadata/3.0'}
            if self.key:
                headers['Authorization'] = 'Key ' + self.key
            self.last = time.monotonic()
            self.calls += 1
            try:
                with self.open(urllib.request.Request(url, headers=headers), timeout=self.timeout) as response:
                    raw = response.read(8*1024*1024+1)
                if len(raw) > 8*1024*1024:
                    raise ValueError('nhentai 响应超过大小上限')
                data = json.loads(raw)
                if endpoint == 'tags/ids':
                    if not isinstance(data,list) or any(not isinstance(t,dict)
                            or type(t.get('id')) is not int or not isinstance(t.get('name'),str)
                            or not isinstance(t.get('type'),str) for t in data):
                        raise ValueError('nhentai 标签批量响应结构不正确')
                else:
                    if (not isinstance(data, dict) or data.get('error')
                            or endpoint in {'search','galleries/tagged'} and (not isinstance(data.get('result'), list)
                                or type(data.get('num_pages')) is not int or data['num_pages']<0)
                            or endpoint.startswith('galleries/') and endpoint != 'galleries/tagged' and (not data.get('id')
                                or not isinstance(data.get('tags'),list) or not isinstance(data.get('title'),dict))):
                        raise ValueError('nhentai 响应结构不正确')
                path.parent.mkdir(parents=True, exist_ok=True)
                temporary = path.with_name(path.name+'.tmp')
                try:
                    temporary.write_text(json.dumps({'schema':'manga.nh-v2-cache','url':url,
                        'time':time.time(),'response':data},ensure_ascii=False),encoding='utf-8')
                    temporary.replace(path)
                finally:
                    temporary.unlink(missing_ok=True)
                self.memo[url] = data
                return data
            except urllib.error.HTTPError as error:
                if attempt < 2 and (error.code == 429 or error.code >= 500):
                    try: delay = float(error.headers.get('Retry-After', '10'))
                    except (ValueError, TypeError): delay = 10
                    self.sleep(min(60, max(3.2, delay)))
                    continue
                if error.code == 404:
                    raise ValueError('nhentai 来源已不存在') from None
                message='nhentai 请求失败 HTTP '+str(error.code)
                if error.code in {401,403,429} or error.code>=500:
                    self.blocked=message+'；本轮暂停该数据源，已有缓存仍可使用'
                raise ValueError(self.blocked or message) from None
            except (urllib.error.URLError, TimeoutError):
                if attempt < 2:
                    self.sleep(3.2*(attempt+1))
                    continue
                self.blocked='nhentai 连接重试失败；本轮暂停该数据源，已有缓存仍可使用'
                raise ValueError(self.blocked) from None

    def search(self, query, *, max_pages=2, max_candidates=50):
        rows = []
        for page in range(1,max_pages+1):
            data = self.get('search', query=query, page=page)
            rows.extend(data['result'])
            if page >= int(data.get('num_pages',1)):
                return rows[:max_candidates], len(rows) <= max_candidates
            if len(rows) >= max_candidates:
                break
        return rows[:max_candidates], False

    def gallery(self, gid):
        raw = self.get('galleries/'+str(int(gid)))
        if int(raw.get('id',0)) != int(gid) or not isinstance(raw.get('tags'),list):
            raise ValueError('nhentai 详情编号或标签不对应')
        title = raw.get('title',{})
        if not title.get('english') and not title.get('japanese'):
            raise ValueError('nhentai 详情没有题名')
        return {'gid':int(gid),'token':'','title':title.get('english',''),
                'title_jpn':title.get('japanese',''),'category':'Doujinshi',
                'filecount':int(raw['num_pages']),'posted':raw.get('upload_date',0),
                'tags':[t['type']+':'+t['name'] for t in raw['tags']],
                'url':f'https://nhentai.net/g/{int(gid)}/','provider':'nhentai'}
