import xml.etree.ElementTree as ET
"""Routes, metadata identity and folder transaction behavior using local fixtures."""
from contextlib import redirect_stdout, contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch
import io
import json
import os
import sys
import unittest
import urllib.error
import zipfile

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import daily_intake as intake
import intake_enrichment as enrich
import intake_inputs as inputs
import intake_metadata as meta
import intake_reader
import intake_housekeeping
import nhentai_api
from test_daily_intake import xml, TEST_ROOT


def gallery(title='Story 2',artist='artist',gid=1,language='english'):
    return {'gid':gid,'token':'0123456789','title':f'[Circle ({artist})] {title}',
            'title_jpn':'','category':'Doujinshi','filecount':'1',
            'tags':['artist:'+artist,'group:circle','language:'+language,'female:glasses']}


class Routes(unittest.TestCase):
    def setUp(self):
        self.temp=TemporaryDirectory(dir=TEST_ROOT)
        self.base=Path(self.temp.name)
        self.path=self.base/'[Circle (Artist)] Story 2 [Chinese].zip'
        with zipfile.ZipFile(self.path,'w') as z: z.writestr('001.png',b'page')
        self.book=meta.read_archive(self.path); meta.fill_local_fields(self.book)
        self.book['pairs']=[]

    def tearDown(self): self.temp.cleanup()

    def resolver(self,rows=(),nh_rows=(),*,direct=None,**flags):
        pairs=[(r['gid'],r['token']) for r in rows]
        results={p:{'gallery':r,'state':'cached'} for p,r in zip(pairs,rows)}
        if direct: results.update(direct)
        client=SimpleNamespace(results=results,fetch=lambda pairs:None)
        self.queries=[]
        def search(query):
            self.queries.append(query)
            return {'pairs':pairs,'complete':True,'state':'cached'}
        searcher=SimpleNamespace(search=search,offline=True)
        nh=SimpleNamespace(search=lambda q:([{'id':r['gid'],'english_title':r['title'],'japanese_title':r['title_jpn']} for r in nh_rows],True),
                           gallery=lambda gid:next(r for r in nh_rows if r['gid']==gid))
        return enrich.Resolver(client,searcher,nh,**flags)

    def test_direct_prefix_avoids_discovery(self):
        raw=gallery()
        self.book['pairs']=[(1,'0123456789')]
        result=self.resolver([raw]).resolve(self.book,{})
        self.assertEqual(result['match_scope'],'direct')
        self.assertEqual(self.queries,[])

    def test_nhentai_source_map_avoids_eh_discovery_and_keeps_local_language(self):
        raw=gallery(gid=42)
        raw.update(token='',url='https://nhentai.net/g/42/',provider='nhentai')
        self.book['source_override']=True
        pairs=intake.resolve_pairs(self.book,{self.book['path']:raw['url']},self.base)
        self.assertEqual(pairs,[])
        self.assertEqual(self.book['nhentai_source_ids'],[42])
        result=self.resolver(nh_rows=[raw]).resolve(self.book,{})
        self.assertEqual(result['match_scope'],'direct_nhentai')
        self.assertEqual(result['metadata']['web'],raw['url'])
        self.assertEqual(result['metadata']['language'],'zh')
        self.assertEqual(self.queries,[])

    def test_embedded_nhentai_web_is_a_direct_source(self):
        with zipfile.ZipFile(self.path,'a') as archive:
            archive.writestr('ComicInfo.xml','<ComicInfo><Web>https://nhentai.net/g/42/</Web></ComicInfo>')
        book=meta.read_archive(self.path)
        self.assertEqual(book['nhentai_ids'],[42])
        self.assertEqual(intake.resolve_pairs(book,{},self.base),[])
        self.assertEqual(book['nhentai_source_ids'],[42])

    def test_image_folder_nhentai_web_is_a_direct_source(self):
        folder=self.base/'[Circle (Artist)] Story 2 [Chinese]'
        folder.mkdir()
        (folder/'001.png').write_bytes(b'page')
        (folder/'ComicInfo.xml').write_text('<ComicInfo><Web>https://nhentai.net/g/42/</Web></ComicInfo>',encoding='utf-8')
        book=inputs.read_folder(folder)
        self.assertEqual(intake.resolve_pairs(book,{},self.base),[])
        self.assertEqual(book['nhentai_source_ids'],[42])

    def test_machine_translation_brackets_identify_local_chinese(self):
        for label in ('ai机翻','六FA AI机翻','机翻','機翻'):
            with self.subTest(label=label):
                self.assertEqual(meta.matcher.language_hint('Story ['+label+']'),'chinese')
        self.assertEqual(meta.matcher.language_hint('Story [English MTL]'),'english')
        self.assertIsNone(meta.matcher.language_hint('机翻 is part of this title'))

    def test_machine_translation_hint_preserves_existing_manual_language(self):
        with zipfile.ZipFile(self.path,'a') as archive:
            archive.writestr('ComicInfo.xml','<ComicInfo><LanguageISO>en</LanguageISO></ComicInfo>')
        book=meta.read_archive(self.path)
        book['parsed']['language_hint']='chinese'
        meta.fill_local_fields(book)
        self.assertEqual(book['metadata']['language'],'en')

    def test_legacy_notes_are_preserved_without_becoming_source_or_credit(self):
        notes='Circle credit: \nLiteral creator hints (role unverified): stale\nSource titles: {"title":"Old audit title","title_jpn":"旧记录"}'
        root=ET.Element('ComicInfo');ET.SubElement(root,'Title').text='Story 2';ET.SubElement(root,'Notes').text=notes
        with zipfile.ZipFile(self.path,'a') as archive:archive.writestr('ComicInfo.xml',ET.tostring(root))
        book=meta.read_archive(self.path)
        self.assertEqual(book['metadata']['groups'],[])
        self.assertEqual(book['metadata']['source_titles'],{'title':'','title_jpn':''})
        value=meta.choose_gallery(book,[gallery()],{},direct=True)
        _,fields=meta.xml_values(meta.render_xml(book,value))
        self.assertEqual(fields['Notes'],notes)
        self.assertEqual(fields['MangaGroups'],'circle')
        self.assertEqual(fields['MangaSourceTitle'],gallery()['title'])

    def test_explicit_source_and_group_fields_remain_authoritative(self):
        root=ET.Element('ComicInfo')
        for key,value in {'Title':'Story 2','Notes':'Circle credit: stale','MangaGroups':'manual group','MangaSourceTitle':'manual source title'}.items():ET.SubElement(root,key).text=value
        with zipfile.ZipFile(self.path,'a') as archive:archive.writestr('ComicInfo.xml',ET.tostring(root))
        book=meta.read_archive(self.path)
        self.assertEqual(book['metadata']['groups'],['manual group'])
        self.assertEqual(book['metadata']['source_titles']['title'],'manual source title')

    def test_direct_network_failure_does_not_become_title_fallback(self):
        self.book['pairs']=[(1,'0123456789')]
        resolver=self.resolver(direct={(1,'0123456789'):{'state':'failed','error':'timeout'}})
        with self.assertRaisesRegex(ValueError,'timeout'): resolver.resolve(self.book,{})
        self.assertEqual(self.queries,[])

    def test_confirmed_missing_direct_source_allows_fallback(self):
        self.book['pairs']=[(9,'0123456789')]
        resolver=self.resolver([gallery()],direct={(9,'0123456789'):{'state':'not_found','error':'gallery not found'}})
        self.assertEqual(resolver.resolve(self.book,{})['match_scope'],'exact')

    def test_nhentai_fallback_has_correct_source_and_local_language(self):
        raw=gallery(gid=2); raw.update(url='https://nhentai.net/g/2/',token='',provider='nhentai')
        result=self.resolver(nh_rows=[raw]).resolve(self.book,{})
        self.assertEqual(result['metadata']['web'],'https://nhentai.net/g/2/')
        self.assertEqual(result['metadata']['language'],'zh')
        self.assertEqual(result['metadata']['page_count'],1)

    def test_different_volume_and_author_not_accepted(self):
        self.assertEqual(self.resolver([gallery('Story 3')]).resolve(self.book,{})['status'],'not_found')
        self.assertEqual(self.resolver([gallery(artist='different')]).resolve(self.book,{})['status'],'not_found')

    def test_series_reference_only_supplies_tags(self):
        raw=gallery('Story 3',language='korean')
        result=self.resolver([raw],series_tags=True).resolve(self.book,{})
        value=result['metadata']
        self.assertEqual(result['match_scope'],'series_reference')
        self.assertEqual(value['title'],'Story 2')
        self.assertEqual(value['number'],'2')
        self.assertEqual(value['language'],'zh')
        self.assertEqual(value['web'],'')
        self.assertEqual(value['source_titles'],{'title':'','title_jpn':''})
        self.assertIn('female:glasses',value['raw_tags'])
        self.assertNotIn('language:korean',value['raw_tags'])

    def test_ambiguous_authors_require_review(self):
        self.book['parsed']['creators']={'artists':[],'groups':[],'generic':[]}
        result=self.resolver([gallery(),gallery(artist='different',gid=2)]).resolve(self.book,{})
        self.assertEqual(result['status'],'ambiguous')

    def test_most_complete_candidate_supplies_metadata(self):
        local=gallery(gid=1,language='chinese')
        local['tags'].append('female:short hair')
        richer=gallery(gid=2)
        richer['filecount']='99'
        richer['tags']+=['female:ponytail','female:long hair','other:story arc']
        result=self.resolver([local,richer]).resolve(self.book,{})
        value=result['metadata']
        self.assertIn('/g/2/',value['web'])
        self.assertIn('female:ponytail',value['raw_tags'])
        self.assertNotIn('female:short hair',value['raw_tags'])
        self.assertEqual(value['language'],'zh')
        self.assertEqual(value['page_count'],1)
        self.assertEqual(value['title'],'Story 2')

    def test_upload_status_and_duplicates_do_not_win_tag_ranking(self):
        noisy=gallery(gid=1,language='chinese')
        noisy['tags']+=['female:glasses']*10+['other:watermarked','other:scanmark','other:sample']
        richer=gallery(gid=2)
        richer['tags'].append('female:ponytail')
        result=self.resolver([noisy,richer]).resolve(self.book,{})
        self.assertIn('/g/2/',result['metadata']['web'])
        self.assertNotIn('other:watermarked',result['metadata']['raw_tags'])

    def test_manual_tags_survive_more_complete_candidate(self):
        self.book['metadata']['raw_tags']=['female:manual']
        self.book['metadata']['tags']=['手工标签']
        richer=gallery(gid=2)
        richer['tags'].append('female:ponytail')
        value=self.resolver([gallery(),richer]).resolve(self.book,{})['metadata']
        self.assertEqual(value['raw_tags'],['female:manual'])
        self.assertEqual(value['tags'],['手工标签'])

    def test_hash_is_not_read_without_explicit_flag(self):
        with patch.object(inputs,'hash_samples',side_effect=AssertionError('hash is opt in')):
            self.assertEqual(self.resolver().resolve(self.book,{})['status'],'not_found')

    def test_unknown_local_edition_annotation_survives_naming(self):
        book={**self.book,'parsed':{**self.book['parsed'],'unknown_suffixes':['手工重嵌']}}
        self.assertIn('[手工重嵌]',intake.filename(book))

    def test_book_context_does_not_mutate_parser_cache(self):
        self.book['parsed']['creators']={'artists':['changed'],'groups':[],'generic':[]}
        another=meta.read_archive(self.path)
        self.assertEqual(another['parsed']['creators']['artists'],['Artist'])

    def test_native_signature_is_matching_evidence(self):
        raw=gallery(artist='different romanization')
        raw['title_jpn']='[Circle (Artist)] Story 2'
        self.assertEqual(self.resolver([raw]).resolve(self.book,{})['status'],'matched')

    def test_missing_direct_source_replacement_is_explicit(self):
        self.book['pairs']=[(9,'0123456789')]
        self.book['metadata']['web']='https://e-hentai.org/g/9/0123456789/'
        resolver=self.resolver([gallery()],direct={(9,'0123456789'):{'state':'not_found'}})
        result=resolver.resolve(self.book,{})
        self.assertTrue(result['replace_source'])
        self.assertIn('/g/1/',result['metadata']['web'])

    def test_kanji_ordinal_collection_is_not_one_volume(self):
        self.assertEqual(enrich.scope('Example 其ノ三 フルカラー版')['number'],'3')
        self.assertEqual(enrich.scope('Example 其ノ一二三四')['number'],'')

    def test_same_title_in_different_parody_is_not_accepted(self):
        self.book['parsed']['contexts']=['Known Game']
        raw=gallery('Story 2 (Other Game)')
        self.assertEqual(self.resolver([raw]).resolve(self.book,{})['status'],'not_found')


class OfficialAPI(unittest.TestCase):
    def test_source_caches_share_the_existing_cleanup_budget(self):
        with TemporaryDirectory(dir=TEST_ROOT) as directory:
            base=Path(directory); cache=base/'cache'
            old=cache/'api'/('1'*64+'.json')
            new=cache/'nhentai/api'/('2'*64+'.json')
            for path in (old,new):
                path.parent.mkdir(parents=True,exist_ok=True)
                path.write_text('{}')
            os.utime(old,(100,100)); os.utime(new,(101,101))
            result=intake_housekeeping.cleanup(base/'project',cache,now=102,max_files=1,
                                               extra_caches=(cache/'nhentai',))
            self.assertEqual(result['cache_removed'],1)
            self.assertFalse(old.exists())
            self.assertTrue(new.exists())

    def test_authenticated_cache_can_be_reused_offline_without_key(self):
        with TemporaryDirectory(dir=TEST_ROOT) as folder:
            seen=[]
            def opener(request,**kwargs):
                seen.append(request)
                return io.BytesIO(json.dumps({'result':[],'num_pages':0}).encode())
            client=nhentai_api.Client(folder,key='dummy-test-key',opener=opener,sleeper=lambda n:None)
            self.assertEqual(client.search('"Story"'),([],True))
            self.assertEqual(seen[0].get_header('Authorization'),'Key dummy-test-key')
            cached=next(Path(folder).glob('*.json')).read_text()
            self.assertNotIn('dummy-test-key',cached)
            offline=nhentai_api.Client(folder,offline=True,key='',opener=lambda *a,**k:None)
            self.assertEqual(offline.search('"Story"'),([],True))
            self.assertEqual(offline.calls,0)

    def test_invalid_and_limited_responses_are_not_cached_as_empty(self):
        for mode in ('invalid','limited'):
            with self.subTest(mode=mode),TemporaryDirectory(dir=TEST_ROOT) as folder:
                def opener(request,**kwargs):
                    if mode=='limited': raise urllib.error.HTTPError(request.full_url,429,'limited',{},None)
                    return io.BytesIO(b'{"wrong": []}')
                client=nhentai_api.Client(folder,key='',opener=opener,sleeper=lambda n:None)
                with self.assertRaises(ValueError): client.search('"Story"')
                self.assertEqual(list(Path(folder).glob('*.json')),[])

    def test_tagged_list_is_validated_as_a_list_not_a_gallery(self):
        with TemporaryDirectory(dir=TEST_ROOT) as folder:
            payload={'result':[{'id':42,'english_title':'Story 2'}],'num_pages':1}
            client=nhentai_api.Client(folder,key='',opener=lambda *a,**k:io.BytesIO(json.dumps(payload).encode()),sleeper=lambda n:None)
            self.assertEqual(client.get('galleries/tagged',tag_id=7,page=1,per_page=100),payload)
            offline=nhentai_api.Client(folder,offline=True,key='')
            self.assertEqual(offline.get('galleries/tagged',tag_id=7,page=1,per_page=100),payload)

    def test_malformed_tagged_list_is_not_cached(self):
        with TemporaryDirectory(dir=TEST_ROOT) as folder:
            client=nhentai_api.Client(folder,key='',opener=lambda *a,**k:io.BytesIO(b'{"result":[],"num_pages":"unknown"}'),sleeper=lambda n:None)
            with self.assertRaises(ValueError):client.get('galleries/tagged',tag_id=7,page=1,per_page=100)
            self.assertEqual(list(Path(folder).glob('*.json')),[])

    def test_tag_ids_response_accepts_official_array_and_reuses_cache(self):
        with TemporaryDirectory(dir=TEST_ROOT) as folder:
            payload=[{'id':7,'type':'artist','name':'unit artist'}]
            client=nhentai_api.Client(folder,key='',opener=lambda *a,**k:io.BytesIO(json.dumps(payload).encode()),sleeper=lambda n:None)
            self.assertEqual(client.get('tags/ids',ids='7'),payload)
            self.assertEqual(nhentai_api.Client(folder,offline=True,key='').get('tags/ids',ids='7'),payload)

    def test_tag_ids_malformed_response_is_not_cached(self):
        with TemporaryDirectory(dir=TEST_ROOT) as folder:
            client=nhentai_api.Client(folder,key='',opener=lambda *a,**k:io.BytesIO(b'[{"id":"wrong"}]'),sleeper=lambda n:None)
            with self.assertRaises(ValueError):client.get('tags/ids',ids='7')
            self.assertEqual(list(Path(folder).glob('*.json')),[])

    def test_documented_metadata_and_search_limits_are_respected(self):
        with TemporaryDirectory(dir=TEST_ROOT) as folder:
            waits=[]
            def opener(request,**kwargs):
                data=[] if '/tags/ids' in request.full_url else {'result':[],'num_pages':0}
                return io.BytesIO(json.dumps(data).encode())
            client=nhentai_api.Client(folder,key='',opener=opener,sleeper=waits.append)
            client.last=0
            with patch.object(nhentai_api.time,'monotonic',return_value=0):
                client.get('tags/ids',ids='7')
                client.get('search',query='unit',page=1)
            self.assertEqual(waits,[4.2,6.2])

    def test_key_is_never_forwarded_to_another_host(self):
        with self.assertRaises(ValueError):
            nhentai_api.SameOriginRedirect().redirect_request(None,None,302,'',{},'https://example.com/')

    def test_rate_limit_stops_repeated_requests_for_the_batch(self):
        with TemporaryDirectory(dir=TEST_ROOT) as folder:
            def opener(request,**kwargs):
                raise urllib.error.HTTPError(request.full_url,429,'limited',{},None)
            client=nhentai_api.Client(folder,key='',opener=opener,sleeper=lambda n:None)
            with self.assertRaises(ValueError): client.search('first')
            previous=client.calls
            with self.assertRaises(ValueError): client.search('second')
            self.assertEqual(client.calls,previous)


class FolderTransactions(unittest.TestCase):
    def setUp(self):
        self.temp=TemporaryDirectory(dir=TEST_ROOT)
        self.base=Path(self.temp.name)
        self.project=self.base/'project'; self.project.mkdir()
        self.library=self.base/'library'
        self.owner=self.library/'unit artist'
        self.source=self.owner/'_oneshots'/'[19.02] old name [手工重嵌]'
        self.source.mkdir(parents=True)
        (self.source/'001.png').write_bytes(b'first page')
        (self.source/'002.png').write_bytes(b'second page')
        (self.source/'attachment.txt').write_bytes(b'keep attachment')
        (self.source/'ComicInfo.xml').write_bytes(xml('Story 2'))
        self.original={p.name:p.read_bytes() for p in self.source.iterdir()}

    def tearDown(self): self.temp.cleanup()

    def run_intake(self,*flags,reader_factory=None,root=None):
        args=intake.parse_args(['--root',str(root or self.owner),'--library-root',str(self.library),
            '--in-place','--offline','--tag-language','raw','--torrent-dir',str(self.base/'no-torrents'),*flags])
        with redirect_stdout(io.StringIO()):
            return intake.run(args,project=self.project,reader_factory=reader_factory)

    def test_preview_commit_keep_location_and_all_payloads(self):
        preview=self.run_intake('--dry-run')
        self.assertTrue(self.source.is_dir())
        result=self.run_intake()
        self.assertEqual(preview['successes'],result['successes'])
        self.assertEqual(result['failure_count'],0)
        self.assertFalse(self.source.exists())
        target=Path(result['successes'][0]['path'])
        self.assertEqual(target.parent,self.source.parent)
        self.assertIn('手工重嵌',target.name)
        with zipfile.ZipFile(target) as archive:
            for name,raw in self.original.items():
                if name!='ComicInfo.xml': self.assertEqual(archive.read(name),raw)
        _,fields=meta.xml_values(meta.read_archive(target)['old_xml'])
        self.assertEqual(fields['Notes'],'用户手写备注')
        self.assertEqual(fields['UserField'],'保留')
        self.assertEqual(fields['PageCount'],'2')
        self.assertEqual(list(self.project.glob('state/intake/pending_*')),[])

    def test_selected_image_folder_itself_is_supported(self):
        result=self.run_intake('--dry-run',root=self.source)
        self.assertEqual(result['success_count'],1)

    def test_name_conflict_retains_existing_cbz(self):
        target=self.source.parent/'Story 2 [手工重嵌].cbz'
        target.write_bytes(b'existing untouched file')
        result=self.run_intake(root=self.source)
        self.assertEqual(result['failure_count'],0)
        self.assertIn('[版本2]',result['successes'][0]['path'])
        self.assertEqual(target.read_bytes(),b'existing untouched file')

    def test_reader_pause_failure_rolls_back_prepared_cbz(self):
        class Reader(intake_reader.Reader):
            @contextmanager
            def paused(self): raise RuntimeError('pause failed'); yield
        result=self.run_intake(reader_factory=Reader)
        self.assertEqual(result['failure_count'],1)
        self.assertEqual({p.name:p.read_bytes() for p in self.source.iterdir()},self.original)
        self.assertEqual(list(self.owner.rglob('.manga_convert_*.tmp')),[])
        self.assertEqual(list(self.project.glob('state/intake/pending_*')),[])

    def test_interrupted_original_cleanup_resumes(self):
        def interrupted(folder,*args):
            (Path(folder)/'001.png').unlink()
            raise RuntimeError('cleanup interrupted after committed archive')
        with patch.object(inputs,'cleanup_original',side_effect=interrupted):
            first=self.run_intake()
        self.assertEqual(first['failure_count'],1)
        self.assertTrue(list(self.project.glob('state/intake/pending_*')))
        self.run_intake()
        self.assertFalse(self.source.exists())
        self.assertEqual(list(self.project.glob('state/intake/pending_*')),[])
        self.assertEqual(len(list(self.source.parent.glob('*.cbz'))),1)

    def test_no_metadata_preserves_folder_and_records_failure(self):
        (self.source/'ComicInfo.xml').unlink()
        with patch.object(enrich.Resolver,'resolve',return_value={'status':'not_found','reason':'no result'}):
            result=self.run_intake()
        self.assertEqual(result['failure_count'],1)
        self.assertTrue((self.source/'001.png').is_file())
        self.assertEqual(list(self.owner.rglob('*.cbz')),[])
        self.assertIn(str(self.source),(self.project/'state/intake/failures.csv').read_text(encoding='utf-8-sig'))

    def test_directory_with_nested_content_is_not_packed(self):
        (self.source/'nested').mkdir()
        with self.assertRaisesRegex(ValueError,'子目录'): inputs.read_folder(self.source)


if __name__=='__main__': unittest.main()
