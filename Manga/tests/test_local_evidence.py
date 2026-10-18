from pathlib import Path
from tempfile import TemporaryDirectory
import sys,unittest,zipfile
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import intake_titles as titles, intake_metadata as meta, intake_inputs as inputs, intake_enrichment as enrich
from test_daily_intake import TEST_ROOT

class LocalEvidence(unittest.TestCase):
    def test_chinese_edition_credit_variants(self):
        for suffix in ('[台版官中]','[dlsite官中]','[AI翻译]','[MacTL個人翻譯]','【瓜皮有偿汉化】','[某汉化组'):
            with self.subTest(suffix=suffix):self.assertEqual(titles.language_hint('Story '+suffix),'chinese')
    def test_non_language_text_and_ambiguous_editions(self):
        for title in ('中文官中翻译日语物语','Story [MotherEmperor翻訳]','Story [English] [中国翻訳]','Story [英语翻译]'):
            with self.subTest(title=title):self.assertIsNone(titles.language_hint(title))
        self.assertEqual(titles.language_hint('Story [English Translation]'),'english')
    def test_edition_annotations_are_not_part_of_title(self):
        for suffix in ('[台版官中]','[dlsite官中]','【瓜皮有偿汉化】'):
            self.assertEqual(titles.parse_title('Story 2 '+suffix)['core'],'Story 2')
        self.assertIn('第2巻',titles.parse_title('Story [第2巻]')['core'])
    def test_directory_hint_can_confirm_circle_without_claiming_author(self):
        with TemporaryDirectory(dir=TEST_ROOT) as folder:
            root=Path(folder);p=root/'Studio'/'_oneshots'/'Story 2 [Chinese].cbz';p.parent.mkdir(parents=True)
            with zipfile.ZipFile(p,'w') as z:z.writestr('001.jpg',b'page')
            b=meta.read_archive(p);meta.fill_local_fields(b);inputs.location_context(b,root)
            raw={'title':'[Studio (Alice)] Story 2','title_jpn':'','tags':['group:studio','artist:alice']}
            self.assertEqual(b['parsed']['directory_creators']['generic'],['Studio'])
            self.assertTrue(enrich.matches(b,raw,{}));self.assertEqual(b['metadata']['artists'],[])
            raw['title']='[Else (Alice)] Story 2';raw['tags']=['group:else','artist:alice']
            self.assertFalse(enrich.matches(b,raw,{}))
