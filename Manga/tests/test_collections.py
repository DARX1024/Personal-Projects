from pathlib import Path
from contextlib import redirect_stdout
from tempfile import TemporaryDirectory
from unittest.mock import patch
import io,json,sys,unittest,zipfile,xml.etree.ElementTree as ET
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import daily_intake as intake
import intake_metadata as meta

class CollectionAuthors(unittest.TestCase):
    def exercise(self, stale=False, conflict=False):
        with TemporaryDirectory() as folder:
            base=Path(folder);project=base/'tool';project.mkdir();library=base/'library';root=library/'artist';root.mkdir(parents=True)
            path=root/'2026年10月图集 5.cbz';other=root/'other.cbz'
            xml='<ComicInfo><Title>手写题名</Title><Notes>保留备注</Notes><UserField>保留</UserField><PageCount>99</PageCount>'
            if conflict:xml+='<Penciller>人工作者</Penciller>'
            xml+='</ComicInfo>'
            with zipfile.ZipFile(path,'w') as archive:
                archive.writestr('1.png',b'first');archive.writestr('2.png',b'second');archive.writestr('ComicInfo.xml',xml)
            other.write_bytes(path.read_bytes());before=path.read_bytes();other_before=other.read_bytes()
            stamp=meta.read_archive(path)['read_stamp'];stamp[0]+=int(stale)
            manifest=base/'authors.json';manifest.write_text(json.dumps({str(path):{'authors':['confirmed artist'],'expected_stamp':stamp}}),encoding='utf-8')
            args=intake.parse_args(['--root',str(root),'--library-root',str(library),'--in-place','--metadata-only',
                '--no-series-merge','--keep-duplicates','--offline','--tag-language','raw','--collection-authors',str(manifest),
                '--torrent-dir',str(base/'empty')])
            with patch.object(intake.intake_enrichment.Resolver,'resolve',side_effect=AssertionError('No API lookup')):
                with redirect_stdout(io.StringIO()):result=intake.run(args,project=project)
            self.assertEqual(other.read_bytes(),other_before)
            if stale or conflict:
                self.assertEqual(result['failure_count'],1);self.assertEqual(path.read_bytes(),before)
            else:
                self.assertEqual(result['failure_count'],0);self.assertTrue(path.read_bytes().startswith(before))
                _,f=meta.xml_values(meta.read_archive(path)['old_xml'])
                self.assertEqual(f['Penciller'],'confirmed artist');self.assertEqual(f['PageCount'],'2')
                self.assertEqual(f['Title'],'手写题名');self.assertEqual(f['Notes'],'保留备注');self.assertEqual(f['UserField'],'保留')
                for k in ['Tags','MangaTagKeys','Web','Series','Number','Volume','LanguageISO']:self.assertNotIn(k,f)
    def test_author_only_preserves_original_content_and_selection(self):self.exercise()
    def test_changed_file_is_rejected(self):self.exercise(stale=True)
    def test_existing_author_conflict_is_rejected(self):self.exercise(conflict=True)

if __name__=='__main__':unittest.main()
