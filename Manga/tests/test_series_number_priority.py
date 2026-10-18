from pathlib import Path
import sys,unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import series_identity as series

class NumberPriority(unittest.TestCase):
    def test_explicit_chapter_precedes_subtitle_counter(self):
        for title,number in [('物語 第4話 母VS娘 その1','4'),('物語 第5話 母VS娘 その2','5'),
                             ('Story Vol. 4 - Episode 1','4'),('物語 第03巻 2つの結末','3')]:
            with self.subTest(title=title):
                result=series.split_title(title)
                self.assertEqual(result['number'],number)
                self.assertIn(result['series'],('物語','Story'))
    def test_chapter_suffix_inside_volume_keeps_its_own_number(self):
        for title,number in [('物語 第8巻 -- 100','100'),('物語 第8巻 -- 104.5','104.5'),('物語 第1巻 -- 2','2')]:
            with self.subTest(title=title):self.assertEqual(series.split_title(title)['number'],number)

    def test_hiragana_people_counter_is_title_content(self):
        result=series.split_title('3にんのママ 前編')
        self.assertEqual(result['number'],'')
        self.assertEqual(result['part'],'前編')
        self.assertEqual(result['series'],'3にんのママ')
        self.assertEqual(series.split_title('3にんのママ 2')['number'],'2')
    def test_ranges_and_conflicting_repeated_headings_stay_conservative(self):
        self.assertEqual(series.split_title('物語 第1-4巻')['state'],'range_requires_review')
        self.assertEqual(series.split_title('Story 2 ~Subtitle~ Story 3')['state'],'ambiguous_requires_review')
    def test_ordinary_rightmost_volume_is_preserved(self):
        self.assertEqual(series.split_title('妖精娼館 3号室レイシー ~副題~ 2')['number'],'2')

    def test_trip_duration_is_not_a_volume_or_shared_work_identity(self):
        a=series.split_title('幻想郷2泊3日の旅 卯月')
        b=series.split_title('幻想郷2泊3日の旅 星蓮')
        self.assertEqual(a['number'],'');self.assertEqual(b['number'],'')
        self.assertEqual(a['series'],'');self.assertNotEqual(a['title'],b['title'])

if __name__=='__main__':unittest.main()
