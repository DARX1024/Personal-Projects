from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from types import SimpleNamespace
from contextlib import redirect_stdout
import io,sys,unittest,zipfile
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import daily_intake as intake
import intake_metadata as meta
import intake_collections as collections
import intake_enrichment as enrich

class CollectionCompletion(unittest.TestCase):
    def exercise(self, author=True):
        with TemporaryDirectory() as folder:
            base=Path(folder);project=base/'tool';project.mkdir();library=base/'library';root=library/'artist';root.mkdir(parents=True)
            path=root/'2026年10月 Fanbox.cbz'
            xml='<ComicInfo><Title>本地题名</Title><PageCount>99</PageCount><Notes>手写简介</Notes>'
            if author:xml+='<Penciller>confirmed artist</Penciller>'
            xml+='</ComicInfo>'
            with zipfile.ZipFile(path,'w') as z:z.writestr('1.png',b'page');z.writestr('ComicInfo.xml',xml)
            before=path.read_bytes()
            args=intake.parse_args(['--root',str(root),'--library-root',str(library),'--in-place','--metadata-only','--no-series-merge','--keep-duplicates','--offline','--tag-language','raw','--torrent-dir',str(base/'empty')])
            with patch.object(intake.intake_enrichment.Resolver,'resolve',side_effect=AssertionError('Collection must not query API')),redirect_stdout(io.StringIO()):
                result=intake.run(args,project=project)
            if author:
                self.assertEqual(result['failure_count'],0)
                _,f=meta.xml_values(meta.read_archive(path)['old_xml'])
                self.assertEqual(f['PageCount'],'1');self.assertEqual(f['Notes'],'手写简介')
                for name in ('Tags','Web','Series','Number','LanguageISO'):self.assertNotIn(name,f)
            else:
                self.assertEqual(result['failure_count'],1);self.assertEqual(path.read_bytes(),before)
    def test_marked_collection_with_credit_is_complete_without_tags_or_web(self):self.exercise()
    def test_unconfirmed_collection_author_does_not_fall_back_to_api(self):self.exercise(False)
    def test_plain_compilation_and_numbers_are_not_artwork_markers(self):
        for title in ('Story 1-4 総集編','Story 2026年10月号','No. 123'):
            book={'path':title+'.cbz','old_xml':None}
            self.assertFalse(collections.known_collection(book))

    def test_platform_tag_alone_does_not_reclassify_ordinary_comic(self):
        book={'path':'Story.cbz','old_xml':b'<ComicInfo><Title>Story</Title><MangaTagKeys>other:fanbox</MangaTagKeys></ComicInfo>'}
        self.assertFalse(collections.known_collection(book))
        book['path']='Artist/Fanbox/2026-10.cbz'
        self.assertTrue(collections.known_collection(book))

    def test_complete_comic_with_platform_title_uses_normal_archive_flow(self):
        with TemporaryDirectory() as folder:
            base=Path(folder);project=base/'tool';project.mkdir();library=base/'library';root=library/'【未分类】';root.mkdir(parents=True)
            path=root/'Story -FANBOX0.5まとめ-.zip'
            xml='<ComicInfo><Title>Story -FANBOX0.5まとめ-</Title><Penciller>confirmed artist</Penciller><LanguageISO>zh</LanguageISO><Tags>manual tag</Tags><Notes>手写简介</Notes></ComicInfo>'
            with zipfile.ZipFile(path,'w') as archive:
                archive.writestr('1.png',b'page');archive.writestr('ComicInfo.xml',xml)
            args=intake.parse_args(['--root',str(root),'--library-root',str(library),'--offline','--tag-language','raw','--torrent-dir',str(base/'empty')])
            with patch.object(enrich.Resolver,'resolve',side_effect=AssertionError('Complete ComicInfo must be reused')),redirect_stdout(io.StringIO()):
                result=intake.run(args,project=project)
            self.assertEqual((result['success_count'],result['failure_count']),(1,0))
            target=Path(result['successes'][0]['path'])
            self.assertEqual(target.parent,library/'confirmed artist'/'_oneshots')
            _,fields=meta.xml_values(meta.read_archive(target)['old_xml'])
            self.assertEqual(fields['Tags'],'manual tag');self.assertEqual(fields['Notes'],'手写简介')

    def test_platform_filename_reaches_torrent_source_and_metadata_before_archiving(self):
        with TemporaryDirectory() as folder:
            library=Path(folder);root=library/'【未分类】';root.mkdir()
            path=root/'[Artist] Story -FANBOX0.5まとめ- [Chinese].zip'
            with zipfile.ZipFile(path,'w') as archive:archive.writestr('1.png',b'page')
            args=intake.parse_args(['--root',str(root),'--library-root',str(library),'--offline','--tag-language','raw'])
            raw={'gid':42,'token':'0123456789','title':'[Artist] Story -FANBOX0.5まとめ- [Chinese]',
                 'title_jpn':'','category':'Doujinshi','filecount':'1','tags':['artist:artist','language:chinese','female:glasses']}
            client=SimpleNamespace(fetch=lambda pairs:None,results={(42,'0123456789'):{'state':'cached','gallery':raw}})
            resolver=enrich.Resolver(client,SimpleNamespace(),SimpleNamespace())
            with patch('torrent_sources.match',return_value={'state':'matched','gallery':raw}):
                ready,failures=intake.prepare([path],args,{},None,{}, {'fixture':True},resolver)
            self.assertEqual(failures,[]);self.assertEqual(len(ready),1)
            book=ready[0]
            self.assertEqual(book['metadata_resolution']['match_scope'],'direct')
            self.assertEqual(book['metadata']['artists'],['artist'])
            self.assertEqual(book['metadata']['web'],'https://e-hentai.org/g/42/0123456789/')
            self.assertIn('female:glasses',book['metadata']['raw_tags'])
            target=Path(intake.placement(book,library,{})[-1]['target'])
            self.assertEqual(target.parent,library/'artist'/'_oneshots')
            self.assertFalse(book.get('collection_author_only'))

    def test_platform_hint_falls_back_only_after_confirmed_no_match(self):
        with TemporaryDirectory() as folder:
            library=Path(folder);root=library/'【未分类】';root.mkdir()
            path=root/'[Artist] Story -FANBOX0.5まとめ-.zip'
            with zipfile.ZipFile(path,'w') as archive:archive.writestr('1.png',b'page')
            args=intake.parse_args(['--root',str(root),'--library-root',str(library)])
            for status,reason in (('not_found','no confirmed work'),('error','network timeout'),('ambiguous','different creators')):
                with self.subTest(status=status):
                    seen=[]
                    def resolve(book,rules):
                        seen.append(book['path'])
                        return {'status':status,'reason':reason}
                    resolver=SimpleNamespace(prefetch=lambda books:None,resolve=resolve)
                    ready,failures=intake.prepare([path],args,{},None,{}, {},resolver)
                    self.assertEqual(seen,[str(path)]);self.assertEqual(ready,[]);self.assertEqual(len(failures),1)
                    expected='已识别图集' if status=='not_found' else reason
                    self.assertIn(expected,failures[0]['reason'])

    def test_confirmed_collection_markers_keep_local_only_routing(self):
        for path,xml in (
            ('Artist/FANBOX/2026-10.cbz',None),
            ('【订阅图集】/Artist/complete.cbz',b'<ComicInfo><Title>Story</Title><Penciller>artist</Penciller><LanguageISO>zh</LanguageISO><Tags>manual tag</Tags></ComicInfo>'),
            ('Artist/art.cbz',b'<ComicInfo><MangaTagKeys>other:imageset</MangaTagKeys></ComicInfo>'),
        ):
            with self.subTest(path=path):
                self.assertTrue(collections.known_collection({'path':path,'old_xml':xml},include_platform_title=False))
        for platform in ('FANBOX','Patreon','Fantia'):
            book={'path':f'[Artist] Story -{platform}0.5まとめ-.zip','old_xml':None}
            self.assertTrue(collections.known_collection(book))
            self.assertFalse(collections.known_collection(book,include_platform_title=False))

if __name__=='__main__':unittest.main()
