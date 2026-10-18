"""Explicit, local-only collection author updates through the daily intake."""
from pathlib import Path
import json,re
import xml.etree.ElementTree as ET
import intake_metadata as meta
import intake_reader


def known_collection(book, *, include_platform_title=True):
    # Explicit local markers only; a bare date/number or creator is insufficient.
    _,fields=meta.xml_values(book['old_xml'])
    text=' '.join((str(book['path']),fields.get('Title','')))
    explicit=bool(re.search(r'【订阅图集】|图集|圖集|画集|畫集|杂图|雑図|雑图|artbook',text,re.I))
    platform=re.compile(r'fanbox|patreon|fantia',re.I)
    # Platform directories express local collection intent. A platform name in
    # a comic's filename/title is only a fallback hint after normal lookup.
    platform_directory=any(platform.search(part) for part in Path(book['path']).parent.parts)
    platform_title=include_platform_title and bool(platform.search(text))
    # A platform tag alone can belong to an ordinary comic.
    art_tag=bool(re.search(r'(?:^|[,;\s])other:(?:artbook|(?:non-h |western |3d )?imageset)(?:$|[,;\n])',fields.get('MangaTagKeys',''),re.I))
    return explicit or platform_directory or platform_title or art_tag


def prepare_for_mode(book, rules, *, metadata_only):
    if not metadata_only:
        raise ValueError('已识别图集，请使用 --metadata-only 按本地基本字段维护，或用图集作者清单确认署名')
    return prepare_existing(book, rules)


def prepare_existing(book, rules):
    authors=book['metadata']['artists']
    if not authors or any(meta.matcher.placeholder_creator(n) for n in authors):
        raise ValueError('图集缺少已确认署名，请使用图集作者清单补充；不自动检索标签或来源')
    result=prepare(book,{'authors':authors,'expected_stamp':book['read_stamp']},rules)
    result['metadata_resolution']['match_scope']='existing_collection_credit'
    return result


def load_manifest(path, root):
    data=json.loads(Path(path).read_bytes())
    if not isinstance(data,dict) or not data:raise ValueError('图集作者清单须为非空路径映射')
    result={}
    for name,row in data.items():
        source=Path(name)
        if not source.is_absolute() or not source.resolve().is_relative_to(Path(root).resolve()):
            raise ValueError('图集作者清单包含指定子目录以外的路径')
        if not isinstance(row,dict) or not isinstance(row.get('authors'),list) or not row['authors']:
            raise ValueError('每个图集必须提供已确认的作者列表')
        if any(not isinstance(n,str) or not n.strip() or meta.matcher.placeholder_creator(n) for n in row['authors']):
            raise ValueError('图集作者不能为空或使用占位名')
        if not isinstance(row.get('expected_stamp'),list) or len(row['expected_stamp'])!=4:
            raise ValueError('图集作者清单缺少核验后的文件状态')
        result[intake_reader.key(source)]=row
    return result


def prepare(book, approved, rules):
    if Path(book['path']).suffix.casefold() not in {'.cbz','.zip'} or book.get('folder_files'):
        raise ValueError('图集作者补全仅处理已核验的 ZIP/CBZ，不转换或移动原件')
    if book['read_stamp']!=approved['expected_stamp']:
        raise ValueError('图集在作者确认后发生变化，未写入')
    metadata=book['metadata'];authors=meta.unique(approved['authors'])
    if metadata['artists'] and {meta.canonical(n,'artists',rules) for n in metadata['artists']}!={meta.canonical(n,'artists',rules) for n in authors}:
        raise ValueError('已填写作者与确认清单冲突，保留现有署名')
    metadata['artists']=metadata['artists'] or authors
    _,fields=meta.xml_values(book['old_xml'])
    metadata['title']=fields.get('Title') or Path(book['path']).stem
    metadata['language']=fields.get('LanguageISO') or meta.LANGUAGES.get(book['parsed'].get('language_hint'),'')
    book['collection_author_only']=True
    book['metadata_resolution']={'status':'matched','match_scope':'approved_collection_author',
                                'evidence':approved.get('evidence',{})}
    return book


def render_xml(book, metadata):
    root,fields=meta.xml_values(book['old_xml'])
    namespace=root.tag[:root.tag.rfind('}')+1] if '}' in root.tag else ''
    def put(name,value):
        nodes=[n for n in root if n.tag.rsplit('}',1)[-1]==name]
        for extra in nodes[1:]:root.remove(extra)
        node=nodes[0] if nodes else ET.SubElement(root,namespace+name)
        node.text=str(value)
    if not fields.get('Title'):put('Title',metadata['title'])
    existing=meta.unique(__import__('re').split(r'[,，;；]',fields.get('Penciller','')+','+fields.get('Writer','')))
    if not existing or all(meta.matcher.placeholder_creator(n) for n in existing):put('Penciller',', '.join(metadata['artists']))
    if not fields.get('LanguageISO') and metadata['language']:put('LanguageISO',metadata['language'])
    put('PageCount',book['page_count'])
    ET.indent(root,space='  ')
    return ET.tostring(root,encoding='utf-8',xml_declaration=True)
