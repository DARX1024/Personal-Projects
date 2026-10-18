"""Behavior regressions for the daily intake's user workflows."""
from contextlib import closing, contextmanager, redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import hashlib
import io
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import daily_intake as intake
import intake_archives as archives
import intake_metadata as meta
import intake_reader
import intake_titles
import series_identity
import torrent_sources

TEST_ROOT = Path(os.environ.get('MANGA_INTAKE_TEST_ROOT', tempfile.gettempdir()))
TEST_ROOT.mkdir(parents=True, exist_ok=True)
tempfile.tempdir = str(TEST_ROOT)


def xml(title, *, source_titles=None):
    root = ET.Element('ComicInfo')
    values = {'Title': title, 'Penciller': 'unit artist', 'LanguageISO': 'zh',
              'Tags': '测试标签', 'Notes': '用户手写备注', 'UserField': '保留'}
    values.update(source_titles or {})
    for key, value in values.items():
        ET.SubElement(root, key).text = value
    return ET.tostring(root, encoding='utf-8', xml_declaration=True)


def write_book(path, title, data, **kwargs):
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, 'w') as book:
        book.writestr('001.png', data)
        book.writestr('attachment.txt', b'unchanged attachment')
        book.writestr('ComicInfo.xml', xml(title, **kwargs))
    return path


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class Workflows(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory(prefix='manga-intake-regression-')
        self.base = Path(self.directory.name)
        self.project = self.base / 'project'
        self.project.mkdir()
        self.library = self.base / 'library'
        self.incoming = self.library / '【未分类】'
        self.incoming.mkdir(parents=True)
        self.single = self.library / 'unit artist' / '_oneshots'

    def tearDown(self):
        assert self.base.resolve().is_relative_to(TEST_ROOT.resolve())
        self.directory.cleanup()

    def run_intake(self, *flags, reader_factory=None):
        args = intake.parse_args(['--root', str(self.incoming), '--library-root', str(self.library),
            '--offline', '--tag-language', 'raw', '--torrent-dir', str(self.base / 'no-torrents'), *flags])
        with redirect_stdout(io.StringIO()):
            return intake.run(args, project=self.project, reader_factory=reader_factory)

    def test_rightmost_volume_and_intrinsic_digits(self):
        samples = {'男の数が10分の1になった世界でシたい放題2': '2',
            'Otoko no Kazu ga 10-bun no 1 ni Natta Sekai de Shitai Houdai 2': '2',
            '妖精娼館 3号室レイシー ~副題~ 2': '2', '異世界100人斬り 2': '2',
            'Story 2.5': '2.5', 'Story 3 ~Final~': '3'}
        for title, number in samples.items():
            with self.subTest(title=title):
                self.assertEqual(series_identity.split_title(title)['number'], number)
        for title in ('Isekai 100-nin Giri', '異世界100人斬り', '妖精娼館 3号室レイシー'):
            self.assertEqual(series_identity.split_title(title)['number'], '')
        self.assertEqual(series_identity.split_title('Story 1~5')['state'], 'range_requires_review')
        self.assertEqual(series_identity.split_title('Magazine 2026年10月号')['number'], '2026.10')
        self.assertEqual(series_identity.split_title('Story 後編')['part'], '後編')

    def test_source_prefix_whitespace_and_torrent_key(self):
        for separator in ('', ' ', '   ', '\n', '\r\n  ', '\t\n'):
            name = '[EX_3948906_1ac5a0e45a]' + separator + '[Circle (Artist)] Title.zip'
            parsed = intake_titles.parse_title(name)
            self.assertEqual(parsed['gid_hint'], 3948906)
            self.assertEqual(parsed['gallery_token_hint'], '1ac5a0e45a')
            self.assertEqual(parsed['creators']['artists'], ['Artist'])
            self.assertEqual(torrent_sources.filename_key(name), '[circle (artist)] title')
        self.assertIsNone(intake_titles.parse_title('[EX_3948906_invalid] Title.zip')['source_url_hint'])

    def test_subtitle_counter_and_repeated_language_heading(self):
        for title in ('希岬楓 4 -2つの結末-', 'Kimisaki Kaede 4 -2tsu no Ketsumatsu-'):
            with self.subTest(title=title):
                scope = series_identity.split_title(title)
                self.assertEqual(scope['number'], '4')
                self.assertEqual(scope['state'], 'numbered')
        heading = '夏妻 2 ~夏、旅館、ナンパ男達に堕ちた妻~ 夏妻 2~夏天、家裡、墮落於搭訕男的人妻'
        write_book(self.single / 'two.cbz', heading, b'second')
        write_book(self.incoming / 'three.zip', '夏妻3', b'third')
        preview = self.run_intake('--dry-run')
        formal = self.run_intake()
        self.assertEqual(preview['successes'], formal['successes'])
        self.assertEqual((formal['success_count'], formal['failure_count']), (1, 0))
        books = list((self.library / 'unit artist/夏妻').glob('*.cbz'))
        self.assertEqual(len(books), 2)
        self.assertEqual({meta.read_archive(p)['metadata']['number'] for p in books}, {'2', '3'})

    def test_collection_reference_does_not_establish_single_volume_identity(self):
        old = write_book(self.single / 'ten.cbz', 'Collection 10', b'same pages',
                         source_titles={'Web': 'https://e-hentai.org/g/3992396/4c50416382/'})
        before = digest(old)
        write_book(self.incoming / 'collection.zip', 'Collection 1-10', b'same pages',
                   source_titles={'Number': '10', 'Series': 'Collection',
                                  'Web': 'https://e-hentai.org/g/3992396/4c50416382/',
                                  'MangaSourceTitle': 'Collection 10'})
        with patch.object(intake, 'page_fingerprint', side_effect=AssertionError('reference is not a duplicate candidate')):
            result = self.run_intake()
        self.assertEqual((result['success_count'], result['failure_count'], result['retained_version_count'],
                          result['deleted_duplicate_count']), (1, 0, 0, 0))
        self.assertEqual(digest(old), before)
        _, fields = meta.xml_values(meta.read_archive(result['successes'][0]['path'])['old_xml'])
        self.assertNotIn('Number', fields)
        self.assertNotIn('Series', fields)
        self.assertEqual(fields['Title'], 'Collection 1-10')
        self.assertEqual(fields['PageCount'], '1')

    def test_direct_collection_source_fills_tags_without_single_volume_titles(self):
        p = self.incoming / '[EH_3992396_4c50416382] [Circle (Artist)] Collection 1-10 [Chinese].zip'
        with zipfile.ZipFile(p, 'w') as z:
            z.writestr('001.png', b'local collection page')
        book = meta.read_archive(p)
        meta.fill_local_fields(book)
        raw = {'gid': 3992396, 'token': '4c50416382', 'title': '[Circle (Artist)] Collection 10 [Chinese]',
               'title_jpn': '', 'filecount': '57', 'category': 'Doujinshi',
               'tags': ['artist:artist', 'group:circle', 'female:glasses', 'language:chinese']}
        metadata = meta.choose_gallery(book, [raw], {}, direct=True)
        self.assertEqual(metadata['title'], 'Collection 1-10')
        self.assertEqual(metadata['number'], '')
        self.assertEqual(metadata['page_count'], 1)
        self.assertIn('female:glasses', metadata['raw_tags'])
        self.assertEqual(metadata['source_titles'], {'title': '', 'title_jpn': ''})

    def test_placeholder_credit_uses_group_and_preserves_real_manual_credit(self):
        p = write_book(self.incoming / 'various.zip', 'Collaboration', b'collaboration',
                       source_titles={'Penciller': 'よろず', 'MangaGroups': 'unit group'})
        result = self.run_intake()
        self.assertEqual((result['success_count'], result['failure_count']), (1, 0))
        self.assertEqual(Path(result['successes'][0]['path']).parent.parent.name, 'unit group')
        _, fields = meta.xml_values(meta.read_archive(result['successes'][0]['path'])['old_xml'])
        self.assertNotIn('Penciller', fields)
        self.assertEqual(fields['Notes'], '用户手写备注')
        for name in ('よろず', 'Various', 'Various Artists'):
            self.assertEqual(intake_titles.creator_block('Circle (' + name + ')')['artists'], [])
        signed = intake_titles.creator_block('Circle (Actual Artist)')
        self.assertEqual(signed['artists'], ['Actual Artist'])
        write_book(self.incoming / 'manual.zip', 'Manual Credit', b'manual credit',
                   source_titles={'Penciller': 'Various', 'Writer': 'unit artist', 'MangaGroups': 'unit group'})
        manual = self.run_intake()
        target = Path(manual['successes'][0]['path'])
        self.assertEqual(target.parent.parent.name, 'unit artist')
        _, fields = meta.xml_values(meta.read_archive(target)['old_xml'])
        self.assertEqual(fields['Writer'], 'unit artist')
        self.assertNotIn('Penciller', fields)

    def test_unnumbered_subtitle_and_season_join_unique_family(self):
        write_book(self.single / 'first.cbz', '弓道男子×副題', b'first',
                   source_titles={'MangaSourceTitle': 'Archery Boys x Subtitle'})
        write_book(self.incoming / 'second.zip', '弓道男子2 ×別の副題', b'second',
                   source_titles={'MangaSourceTitle': 'Archery Boys 2 x Other Subtitle'})
        write_book(self.single / 'house.cbz', 'Harem House Ecchi', b'house first')
        write_book(self.incoming / 'season.zip', 'Harem House Ecchi Season 2 Other Subtitle', b'house second')
        preview = self.run_intake('--dry-run')
        formal = self.run_intake()
        self.assertEqual(preview['successes'], formal['successes'])
        self.assertEqual((formal['success_count'], formal['failure_count']), (2, 0))
        self.assertEqual(len(list((self.library / 'unit artist/弓道男子').glob('*.cbz'))), 2)
        self.assertEqual(len(list((self.library / 'unit artist/Harem House Ecchi').glob('*.cbz'))), 2)
        self.assertIsNone(series_identity.match_title_anchor('Storytelling', 'Story'))
        self.assertIsNone(series_identity.match_title_anchor('Story Different Work', 'Story'))
        self.assertIsNone(series_identity.match_title_anchor('Story IF', 'Story'))

    def test_group_tag_change_reuses_series_only_with_same_authors(self):
        old_folder = self.library / 'main group' / 'Publication'
        write_book(old_folder / 'five.cbz', 'Publication 5', b'fifth',
                   source_titles={'Penciller': 'artist a, artist b', 'MangaGroups': 'main group'})
        write_book(self.incoming / 'six.zip', 'Publication 6', b'sixth',
                   source_titles={'Penciller': 'artist a, artist b', 'MangaGroups': 'main group, guest group'})
        preview = self.run_intake('--dry-run')
        formal = self.run_intake()
        self.assertEqual(preview['successes'], formal['successes'])
        self.assertEqual((formal['success_count'], formal['failure_count']), (1, 0))
        self.assertEqual(Path(formal['successes'][0]['path']).parent, old_folder)
        write_book(self.incoming / 'other.zip', 'Publication 7', b'other artists',
                   source_titles={'Penciller': 'other a, other b', 'MangaGroups': 'main group, guest group'})
        other = self.run_intake()
        self.assertEqual(Path(other['successes'][0]['path']).parent, self.library / '【合刊】/_oneshots')

    def test_ambiguous_series_keeps_input_and_reports_candidates(self):
        credits = {'Penciller': 'artist a, artist b'}
        for group in ('main group', 'guest group'):
            write_book(self.library / group / 'Publication' / 'five.cbz', 'Publication 5', group.encode(),
                       source_titles={**credits, 'MangaGroups': group})
        source = write_book(self.incoming / 'ambiguous.zip', 'Publication 6', b'sixth',
                            source_titles={**credits, 'MangaGroups': 'main group, guest group'})
        before = digest(source)
        write_book(self.incoming / 'good.zip', 'Independent Work', b'good')
        result = self.run_intake()
        self.assertEqual((result['success_count'], result['failure_count']), (1, 1))
        self.assertEqual(result['failures'][0]['kind'], 'series_review')
        self.assertEqual(len(result['failures'][0]['existing_paths']), 2)
        self.assertEqual(digest(source), before)
        rerun = self.run_intake()
        self.assertEqual((rerun['success_count'], rerun['failure_count']), (0, 1))
        self.assertEqual(len(intake.housekeeping.read_csv(self.project / 'state/intake/failures.csv')), 1)

    def test_conflicting_repeated_numbers_need_manual_series(self):
        source = write_book(self.incoming / 'conflict.zip', 'Story 2 ~Subtitle~ Story 3', b'uncertain')
        before = digest(source)
        result = self.run_intake()
        self.assertEqual((result['success_count'], result['failure_count']), (0, 1))
        self.assertEqual(result['failures'][0]['kind'], 'series_review')
        self.assertEqual(digest(source), before)
        book = meta.read_archive(source)
        book['metadata'].update(series='Story', number='2')
        intake.append_xml(source, meta.render_xml(book, book['metadata']).decode('utf-8'))
        write_book(self.library / 'unit artist/Story/first.cbz', 'Story 1', b'first')
        resolved = self.run_intake()
        self.assertEqual((resolved['success_count'], resolved['failure_count']), (1, 0))
        self.assertEqual(meta.read_archive(resolved['successes'][0]['path'])['metadata']['number'], '2')

    def test_final_version_report_resolves_current_rows_series_move(self):
        write_book(self.single / 'first.cbz', 'Story 1', b'first')
        write_book(self.single / 'second.cbz', 'Story 2', b'old second')
        write_book(self.incoming / 'input.zip', 'Story 2', b'new second')
        preview = self.run_intake('--dry-run')
        formal = self.run_intake()
        self.assertEqual((formal['success_count'], formal['retained_version_count'], formal['failure_count']), (1, 1, 0))
        self.assertEqual(preview['retained_versions'], formal['retained_versions'])
        paths = formal['retained_versions'][0]['existing_paths']
        self.assertTrue(all(Path(p).is_file() for p in paths))
        self.assertTrue(all(Path(p).parent.name == 'Story' for p in paths))

    def test_manual_scope_controls_duplicate_identity(self):
        write_book(self.library / 'unit artist/Story/two.cbz', 'Story 2', b'pages two')
        write_book(self.library / 'unit artist/Story/three.cbz', 'Story 3', b'pages three')
        write_book(self.incoming / 'manual.zip', 'Story 2', b'pages three',
                   source_titles={'Series': 'Story', 'Number': '3'})
        result = self.run_intake()
        self.assertEqual((result['success_count'], result['deleted_duplicate_count'], result['failure_count']), (0, 1, 0))
        self.assertEqual(Path(result['exact_duplicates'][0]['existing_path']).name, 'three.cbz')

    def test_group_change_duplicate_and_disabled_series_merge(self):
        credits = {'Penciller': 'artist a, artist b', 'MangaGroups': 'main group'}
        folder = self.library / 'main group/Publication'
        write_book(folder / 'five.cbz', 'Publication 5', b'fifth', source_titles=credits)
        write_book(self.incoming / 'copy.zip', 'Publication 5', b'fifth',
                   source_titles={**credits, 'MangaGroups': 'main group, guest group'})
        result = self.run_intake('--no-series-merge')
        self.assertEqual((result['success_count'], result['deleted_duplicate_count'], result['failure_count']), (0, 1, 0))
        write_book(self.single / 'first.cbz', 'Uncombined 1', b'first')
        write_book(self.incoming / 'second.zip', 'Uncombined 2', b'second')
        uncombined = self.run_intake('--no-series-merge')
        self.assertEqual(Path(uncombined['successes'][0]['path']).parent, self.single)
        self.assertTrue((self.single / 'first.cbz').is_file())

    def test_source_alias_cannot_merge_different_volumes(self):
        shared = 'Otoko no Kazu ga 10-bun no 1 ni Natta Sekai de Shitai Houdai '
        one = write_book(self.single / 'one.cbz', '中文作品 1', b'first',
                         source_titles={'MangaSourceTitle': shared + '1'})
        two = write_book(self.incoming / 'two.zip', '中文作品 2', b'second',
                         source_titles={'MangaSourceTitle': shared + '2'})
        a, b = meta.read_archive(one), meta.read_archive(two)
        self.assertFalse(intake.work_keys(a['metadata']) & intake.work_keys(b['metadata']))
        result = self.run_intake()
        self.assertEqual((result['success_count'], result['failure_count']), (1, 0))
        self.assertEqual(len(list((self.library / 'unit artist' / '中文作品').glob('*.cbz'))), 2)

    def test_preview_commit_series_versions_and_duplicates_agree(self):
        write_book(self.single / 'Story 1.cbz', 'Story 1', b'first')
        files = [write_book(self.incoming / 'a.zip', 'Story 2', b'second'),
                 write_book(self.incoming / 'b.zip', 'Story 1', b'first'),
                 write_book(self.incoming / 'c.zip', 'Story 1', b'other translation'),
                 write_book(self.incoming / 'd.zip', 'Story 2', b'second')]
        before = {str(path): digest(path) for path in files}
        preview = self.run_intake('--dry-run')
        self.assertEqual(before, {str(path): digest(path) for path in files})
        formal = self.run_intake()
        for key in ('success_count', 'failure_count', 'retained_version_count', 'exact_duplicate_count', 'converted_count'):
            self.assertEqual(preview[key], formal[key], key)
        self.assertEqual(formal['success_count'], 2)
        self.assertEqual(formal['retained_version_count'], 1)
        self.assertEqual(formal['deleted_duplicate_count'], 2)
        self.assertEqual(preview['successes'], formal['successes'])
        self.assertEqual([row['existing_path'] for row in preview['exact_duplicates']],
                         [row['existing_path'] for row in formal['exact_duplicates']])
        outputs = list((self.library / 'unit artist' / 'Story').glob('*.cbz'))
        self.assertEqual(len(outputs), 3)
        self.assertTrue(any('[版本2]' in path.name for path in outputs))
        for path in outputs:
            _, fields = meta.xml_values(meta.read_archive(path)['old_xml'])
            self.assertEqual(fields['Series'], 'Story')
            self.assertEqual(fields['PageCount'], '1')
            self.assertEqual(fields['Notes'], '用户手写备注')
            self.assertEqual(fields['UserField'], '保留')
        rerun = self.run_intake()
        self.assertEqual((rerun['success_count'], rerun['failure_count']), (0, 0))
        self.assertFalse(list((self.project / 'state/intake').glob('pending_*.json')))

    def test_keep_duplicates_preserves_input_without_hashing(self):
        write_book(self.single / 'Story.cbz', 'Story', b'same')
        source = write_book(self.incoming / 'input.zip', 'Story', b'same')
        before = digest(source)
        with patch.object(intake, 'page_fingerprint', side_effect=AssertionError('must not read images')):
            result = self.run_intake('--keep-duplicates')
        self.assertEqual(result['duplicate_count'], 1)
        self.assertEqual(before, digest(source))

    def test_two_batches_have_same_preview_and_formal_duplicate_result(self):
        for number in range(100):
            suffix = chr(65 + number // 26) + chr(65 + number % 26)
            write_book(self.incoming / f'{number:03}.zip', 'Work ' + suffix, suffix.encode())
        write_book(self.incoming / '999.zip', 'Work AA', b'AA')
        preview = self.run_intake('--dry-run')
        formal = self.run_intake()
        self.assertEqual((preview['success_count'], preview['exact_duplicate_count']), (100, 1))
        self.assertEqual((formal['success_count'], formal['deleted_duplicate_count'], formal['failure_count']), (100, 1, 0))
        self.assertEqual(preview['successes'], formal['successes'])

    def seven_zip(self):
        contents = self.base / 'contents'
        contents.mkdir()
        (contents / '001.png').write_bytes(b'converted image data')
        (contents / 'ComicInfo.xml').write_bytes(xml('Converted Story'))
        source = self.incoming / 'archive.cb7'
        subprocess.run([archives.archive_tool(), '--format=7zip', '-cf', str(source),
                        '-C', str(contents), '001.png', 'ComicInfo.xml'], capture_output=True, check=True)
        return source

    def test_series_move_in_next_batch_updates_preview_paths(self):
        write_book(self.incoming / '000.zip', 'Story 1', b'first')
        for number in range(99):
            suffix = chr(65 + number // 26) + chr(65 + number % 26)
            write_book(self.incoming / f'{number + 1:03}.zip', 'Work ' + suffix, suffix.encode())
        write_book(self.incoming / '999.zip', 'Story 2', b'second')
        preview = self.run_intake('--dry-run')
        formal = self.run_intake()
        self.assertEqual((formal['success_count'], formal['failure_count']), (101, 0))
        self.assertEqual(preview['successes'], formal['successes'])
        self.assertTrue(all(Path(row['path']).is_file() for row in formal['successes']))
        self.assertEqual(Path(formal['successes'][0]['path']).parent.name, 'Story')

    def test_existing_versions_survive_series_combination_name_collision(self):
        write_book(self.single / 'Story 1.cbz', 'Story 1', b'old single edition')
        write_book(self.library / 'unit artist/Story/Story 1.cbz', 'Story 1', b'old series edition')
        write_book(self.incoming / 'input.zip', 'Story 2', b'new second volume')
        preview = self.run_intake('--dry-run')
        formal = self.run_intake()
        self.assertEqual((formal['success_count'], formal['failure_count']), (1, 0))
        self.assertEqual(preview['successes'], formal['successes'])
        outputs = list((self.library / 'unit artist/Story').glob('*.cbz'))
        self.assertEqual(len(outputs), 3)
        payloads = set()
        for path in outputs:
            with zipfile.ZipFile(path) as archive:
                payloads.add(archive.read('001.png'))
        self.assertEqual(payloads, {b'old single edition', b'old series edition', b'new second volume'})

    def test_conversion_finishes_before_reader_pause(self):
        self.seven_zip()
        reader = intake_reader.Reader()
        paused = False
        @contextmanager
        def pause():
            nonlocal paused
            paused = True
            try:
                yield reader
            finally:
                paused = False
        original = archives.convert
        def convert(*args, **kwargs):
            self.assertFalse(paused)
            return original(*args, **kwargs)
        reader.paused = pause
        with patch.object(archives, 'convert', convert):
            result = self.run_intake(reader_factory=lambda settings: reader)
        self.assertEqual((result['converted_count'], result['failure_count']), (1, 0))

    def test_reader_pause_failure_cleans_prepared_conversion(self):
        source = self.seven_zip()
        before = digest(source)
        reader = intake_reader.Reader()
        @contextmanager
        def pause():
            raise ValueError('simulated reader not idle')
            yield reader
        reader.paused = pause
        result = self.run_intake(reader_factory=lambda settings: reader)
        self.assertEqual((result['success_count'], result['failure_count']), (0, 1))
        self.assertEqual(digest(source), before)
        self.assertFalse(list(self.library.rglob('.manga_convert_*.tmp')))
        self.assertFalse(list((self.project / 'state/intake').glob('pending_*.json')))

    def test_conversion_never_removes_existing_target(self):
        source = self.seven_zip()
        target = self.base / 'unrelated.cbz'
        target.write_bytes(b'user data')
        with self.assertRaises(FileExistsError):
            archives.convert(source, target, expected=archives.stamp(source))
        self.assertEqual(target.read_bytes(), b'user data')

    def test_automatic_conversion_preview_commit_and_payload(self):
        source = self.seven_zip()
        before = digest(source)
        preview = self.run_intake('--dry-run')
        self.assertEqual(digest(source), before)
        self.assertEqual((preview['success_count'], preview['converted_count']), (1, 1))
        formal = self.run_intake()
        self.assertEqual(preview['successes'], formal['successes'])
        self.assertEqual((formal['success_count'], formal['converted_count'], formal['failure_count']), (1, 1, 0))
        self.assertFalse(source.exists())
        with zipfile.ZipFile(formal['successes'][0]['path']) as output:
            self.assertEqual(output.read('001.png'), b'converted image data')
            self.assertIsNone(output.testzip())
        self.assertFalse(list(self.library.rglob('.manga_convert_*.tmp')))

    def test_failed_conversion_keeps_original_and_rolls_back(self):
        source = self.seven_zip()
        before = digest(source)
        def fail(path, target, **kwargs):
            Path(target).write_bytes(b'interrupted output')
            raise OSError('simulated conversion failure')
        with patch.object(archives, 'convert', fail):
            result = self.run_intake()
        self.assertEqual((result['success_count'], result['failure_count']), (0, 1))
        self.assertEqual(digest(source), before)
        self.assertFalse(list(self.library.rglob('*.cbz')))
        self.assertFalse(list(self.library.rglob('.manga_convert_*.tmp')))
        self.assertFalse(list((self.project / 'state/intake').glob('pending_*.json')))

    def test_prepared_conversion_recovers_original(self):
        source = self.seven_zip()
        book = meta.read_archive(source)
        meta.fill_local_fields(book)
        target = self.single / 'Converted Story.cbz'
        target.parent.mkdir(parents=True)
        operations = [intake.operation(book, target, self.library)]
        archives.convert(source, target, expected=book['read_stamp'])
        operations[0]['converted_stamp'] = intake.stamp(target)
        pending = self.project / 'state/intake/pending_conversion.json'
        meta.save_json(pending, {'phase': 'prepared', 'operations': operations})
        recovered, blocked = intake.recover(self.project, self.library, intake_reader.Reader())
        self.assertEqual((recovered, blocked), ([], set()))
        self.assertTrue(source.exists())
        self.assertFalse(target.exists())
        self.assertFalse(pending.exists())

    def test_reader_tasks_persist_for_komga_startup(self):
        root = self.base / 'reader'
        root.mkdir()
        with closing(sqlite3.connect(root / 'database.sqlite')) as database, database:
            database.execute('CREATE TABLE BOOK (ID TEXT,URL TEXT,SERIES_ID TEXT,LIBRARY_ID TEXT,FILE_SIZE INTEGER,DELETED_DATE TEXT)')
            database.execute('CREATE TABLE LIBRARY (ID TEXT PRIMARY KEY,ROOT TEXT)')
            database.execute('INSERT INTO LIBRARY VALUES (?,?)', ('unit-library', intake_reader.native.java_file_url(self.library, directory=True)))
        with closing(sqlite3.connect(root / 'tasks.sqlite')) as tasks, tasks:
            tasks.execute('CREATE TABLE TASK (ID TEXT PRIMARY KEY,PRIORITY INTEGER,GROUP_ID TEXT,CLASS TEXT,SIMPLE_TYPE TEXT,PAYLOAD TEXT,OWNER TEXT,LAST_MODIFIED_DATE TEXT)')
        (self.project / 'config.json').write_text(json.dumps({'libraries': {'H': {'root': str(self.library)}},
            'komga': {'enabled': True, 'app_data': str(root), 'port': 0}}), encoding='utf-8')
        write_book(self.incoming / 'a.zip', 'First Work', b'first')
        self.run_intake()
        write_book(self.incoming / 'b.zip', 'Second Work', b'second')
        self.run_intake()
        with closing(sqlite3.connect(root / 'tasks.sqlite')) as tasks:
            rows = tasks.execute('SELECT SIMPLE_TYPE,PAYLOAD,OWNER FROM TASK').fetchall()
        self.assertEqual(len(rows), 1)
        kind, payload, owner = rows[0]
        self.assertEqual(kind, 'ScanLibrary')
        self.assertEqual(json.loads(payload)['libraryId'], 'unit-library')
        self.assertFalse(json.loads(payload)['scanDeep'])
        self.assertIsNone(owner)
        self.assertFalse(intake_reader.listening(0))


if __name__ == '__main__':
    unittest.main(verbosity=2)
