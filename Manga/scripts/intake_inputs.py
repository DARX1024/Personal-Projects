"""Read image folders and pack verified CBZs; independent of API and placement."""
from pathlib import Path
from copy import deepcopy
import hashlib
import re
import zipfile
import zlib

import intake_metadata as meta
import intake_titles as titles
import series_identity as series


def files(folder):
    folder = Path(folder)
    result = []
    for path in sorted(folder.iterdir(),key=lambda p:p.name.casefold()):
        if path.is_symlink() or path.is_junction() or not path.is_file():
            raise ValueError('图片目录包含子目录或链接，请先分开处理：'+str(folder))
        if any(c in path.name for c in '\r\n'):
            raise ValueError('图片目录含不可确认的文件名')
        stat = path.stat()
        result.append({'name':path.name,'size':stat.st_size,'mtime_ns':stat.st_mtime_ns})
    return result


def read_folder(folder):
    folder = Path(folder)
    listing = files(folder)
    pages = sum(Path(f['name']).suffix.casefold() in meta.IMAGE_EXTS for f in listing)
    if not pages:
        raise ValueError('图片目录没有支持的图页')
    xmls = [f for f in listing if f['name'].casefold() == 'comicinfo.xml']
    if len(xmls)>1 or xmls and xmls[0]['size']>1024*1024:
        raise ValueError('图片目录 ComicInfo 不唯一或超过1MiB')
    raw = (folder/xmls[0]['name']).read_bytes() if xmls else None
    name = re.sub(r'^\[(?:\d{2}|\d{4})\.\d{2}\]\s*','',folder.name)
    parsed = deepcopy(titles.parse_title(name))
    parsed['filename_creators'] = deepcopy(parsed['creators'])
    parsed['directory_creators'] = {'artists':[],'groups':[],'generic':[]}
    _, fields = meta.xml_values(raw)
    metadata = {'title':fields.get('Title') or series.clean_title(parsed['core']),
        'artists':meta.unique(re.split(r'[,，;；]',fields.get('Penciller','') or fields.get('Writer',''))),
        'groups':meta.unique(re.split(r'[,，;；]',fields.get('MangaGroups',''))),
        'language':fields.get('LanguageISO',''),'tags':meta.unique(fields.get('Tags','').split(',')),
        'raw_tags':meta.unique(fields.get('MangaTagKeys','').split(',')),
        'series':fields.get('Series',''),'number':fields.get('Number',''),'volume':fields.get('Volume',''),
        'source_titles':{'title':fields.get('MangaSourceTitle',''),'title_jpn':fields.get('MangaSourceTitleJpn','')},
        'web':fields.get('Web',''),'page_count':pages}
    if listing != files(folder):
        raise ValueError('图片目录在读取期间发生变化')
    stat = folder.stat()
    return {'path':str(folder),'filename':folder.name,'parsed':parsed,'old_xml':raw,'metadata':metadata,
            'page_count':pages,'source_pairs':[(int(g),t.lower()) for g,t in meta.LINK.findall(metadata['web'])],
            'xml_name':xmls[0]['name'] if xmls else None,
            'read_stamp':[stat.st_size,stat.st_mtime_ns,stat.st_dev,stat.st_ino],'folder_files':listing}


def digest(stream):
    sha, size, crc = hashlib.sha256(),0,0
    while block:=stream.read(1024*1024):
        sha.update(block); size+=len(block); crc=zlib.crc32(block,crc)
    return {'size':size,'sha256':sha.hexdigest(),'crc':crc&0xffffffff}


def verify_target(target, manifest):
    with zipfile.ZipFile(target) as book:
        for name, expected in manifest.items():
            with book.open(name) as stream:
                if digest(stream)!=expected:
                    raise ValueError('CBZ与原文件内容不一致：'+name)


def pack(folder,target,expected):
    folder,target = Path(folder),Path(target)
    if files(folder)!=expected:
        raise ValueError('图片目录在准备后发生变化，保留原图')
    manifest, created = {},False
    try:
        with zipfile.ZipFile(target,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=1,allowZip64=True) as book:
            created=True
            for info in expected:
                path=folder/info['name']
                if path.name.casefold()=='comicinfo.xml':
                    continue
                with path.open('rb') as stream: manifest[info['name']]=digest(stream)
                book.write(path,info['name'])
        verify_target(target,manifest)
        if files(folder)!=expected:
            raise ValueError('图片目录在压缩期间发生变化，保留原图')
        return manifest
    except BaseException:
        if created: target.unlink(missing_ok=True)
        raise


def cleanup_original(folder,target,expected,manifest):
    folder=Path(folder)
    if not folder.exists(): return
    remaining=files(folder)
    expected_names={f['name'] for f in expected}
    if any(f['name'] not in expected_names for f in remaining):
        raise ValueError('原目录出现新文件，保留恢复记录')
    verify_target(target,manifest)
    for info in remaining:
        path=folder/info['name']
        if info not in expected:
            raise ValueError('原图被修改，保留原目录')
        if info['name'] in manifest:
            with path.open('rb') as stream:
                if digest(stream)!=manifest[info['name']]:
                    raise ValueError('原图字节变化，保留原目录')
    for info in remaining: (folder/info['name']).unlink()
    folder.rmdir()


def hash_samples(book):
    """Only called when hash lookup is explicitly enabled."""
    def order(name):
        return tuple((1,int(p)) if p.isdigit() else (0,p.casefold()) for p in re.split(r'(\d+)',name))
    path=Path(book['path'])
    if path.is_dir():
        pages=sorted((f['name'] for f in files(path) if Path(f['name']).suffix.casefold() in meta.IMAGE_EXTS),key=order)
        return [hashlib.sha1((path/pages[n]).read_bytes()).hexdigest() for n in sorted({0,len(pages)//2,len(pages)-1})]
    if path.suffix.casefold() not in {'.zip','.cbz'}:
        return []
    with zipfile.ZipFile(path) as archive:
        pages=sorted((n for n in archive.namelist() if Path(n).suffix.casefold() in meta.IMAGE_EXTS),key=order)
        return [hashlib.sha1(archive.read(pages[n])).hexdigest() for n in sorted({0,len(pages)//2,len(pages)-1})]


def location_context(book,library):
    """Local owner hints help matching; they never become asserted credits."""
    path=Path(book['path'])
    parent=path.parent
    relative=path.relative_to(library)
    if len(relative.parts)>1 and relative.parts[0] not in {'【未分类】','_oneshots'} and not any(book['parsed']['creators'].values()):
        owner_name=re.sub(r'^【署名】', '', relative.parts[0])
        owner=deepcopy(titles.parse_title('['+owner_name+'] Owner')['creators'])
        if not any(owner.values()):
            owner={'artists':[],'groups':[],'generic':[owner_name]}
        # A folder may name a circle or an artist; the API must confirm the role.
        book['parsed']['directory_creators']=owner
    local=series.split_title(book['metadata']['title'])
    if local['number']:
        book['metadata']['number']=book['metadata']['number'] or local['number']
        if parent.name not in {'_oneshots',relative.parts[0]}:
            book['metadata']['series']=book['metadata']['series'] or parent.name
