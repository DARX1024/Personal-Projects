"""Durable reader retries using isolated books and real local SQLite task queues."""
from contextlib import closing
from pathlib import Path
from unittest.mock import patch
import json
import sqlite3
import unittest

import test_daily_intake as fixtures
from test_daily_intake import write_book, intake, intake_reader


class ReaderRecovery(unittest.TestCase):
    def setUp(self):
        self.case = fixtures.Workflows()
        self.case.setUp()
        self.addCleanup(self.case.tearDown)
        self.project = self.case.project
        self.state = self.project / 'state/intake'
        self.reader_root = self.case.base / 'reader'
        self.reader_root.mkdir()
        with closing(sqlite3.connect(self.reader_root / 'database.sqlite')) as db, db:
            db.execute('CREATE TABLE BOOK (ID TEXT,URL TEXT,SERIES_ID TEXT,LIBRARY_ID TEXT,FILE_SIZE INTEGER,DELETED_DATE TEXT)')
            db.execute('CREATE TABLE LIBRARY (ID TEXT PRIMARY KEY,ROOT TEXT)')
            db.execute('INSERT INTO LIBRARY VALUES (?,?)',
                       ('unit-library', intake_reader.native.java_file_url(self.case.library, directory=True)))
        with closing(sqlite3.connect(self.reader_root / 'tasks.sqlite')) as db, db:
            db.execute('CREATE TABLE TASK (ID TEXT PRIMARY KEY,PRIORITY INTEGER,GROUP_ID TEXT,CLASS TEXT,SIMPLE_TYPE TEXT,PAYLOAD TEXT,OWNER TEXT,LAST_MODIFIED_DATE TEXT)')
        self.config = {'libraries': {'H': {'root': str(self.case.library)}},
                       'komga': {'enabled': True, 'app_data': str(self.reader_root), 'port': 0}}
        self.save_config()

    def save_config(self):
        (self.project / 'config.json').write_text(json.dumps(self.config), encoding='utf-8')

    def rows(self):
        return intake.housekeeping.read_csv(self.state / 'failures.csv')

    def pending(self):
        return sorted(self.state.glob('pending_*.json'))

    def tasks(self):
        with closing(sqlite3.connect(self.reader_root / 'tasks.sqlite')) as db:
            return db.execute('SELECT SIMPLE_TYPE,PAYLOAD,OWNER FROM TASK').fetchall()

    def duplicate(self, name='input.zip'):
        kept = self.case.single / 'Story.cbz'
        if not kept.exists():
            write_book(kept, 'Story', b'same')
        return write_book(self.case.incoming / name, 'Story', b'same')

    def fail_flush(self):
        with patch.object(intake_reader.Reader, 'flush', side_effect=ValueError('simulated queue failure')):
            return self.case.run_intake()

    def assert_synced(self):
        result = self.case.run_intake()
        self.assertEqual((result['failure_count'], result['pending_count']), (0, 0))
        self.assertEqual(self.rows(), [])
        self.assertEqual(self.pending(), [])
        tasks = self.tasks()
        self.assertEqual(len(tasks), 1)
        kind, payload, owner = tasks[0]
        self.assertEqual(kind, 'ScanLibrary')
        self.assertEqual(json.loads(payload)['libraryId'], 'unit-library')
        self.assertFalse(json.loads(payload)['scanDeep'])
        self.assertIsNone(owner)

    def test_import_retry_clears_sync_failure_after_queue_commit(self):
        write_book(self.case.incoming / 'input.zip', 'Story', b'new')
        first = self.fail_flush()
        self.assertEqual((first['success_count'], first['failure_count']), (1, 1))
        self.assertEqual(len(self.pending()), 1)
        target = Path(first['successes'][0]['path'])
        before = target.read_bytes()
        self.assert_synced()
        self.assertEqual(target.read_bytes(), before)
        self.assert_synced()

    def test_duplicate_only_retries_and_coalesces_scan_intent(self):
        first = self.duplicate('first.zip')
        second = self.duplicate('second.zip')
        kept = (self.case.single / 'Story.cbz').read_bytes()
        result = self.fail_flush()
        self.assertEqual(result['deleted_duplicate_count'], 2)
        self.assertFalse(first.exists())
        self.assertFalse(second.exists())
        self.assertEqual(len(self.pending()), 1)
        self.assertEqual(self.tasks(), [])
        self.assertTrue(Path(self.rows()[0]['recovery']).is_file())
        self.fail_flush()
        self.assertEqual(len(self.rows()), 1)
        self.assertEqual(len(self.pending()), 1)
        self.assert_synced()
        self.assertEqual((self.case.single / 'Story.cbz').read_bytes(), kept)

    def test_interruption_after_duplicate_deletion_recovers_without_csv(self):
        source = self.duplicate()
        with patch.object(intake_reader.Reader, 'flush', side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.case.run_intake()
        self.assertFalse(source.exists())
        self.assertEqual(len(self.pending()), 1)
        self.assertEqual(self.rows(), [])
        self.assert_synced()
        self.assertFalse((self.state / 'last_error.txt').exists())

    def test_scan_journal_write_failure_keeps_duplicate_input(self):
        source = self.duplicate()
        before = source.read_bytes()
        with patch.object(intake.meta, 'save_json', side_effect=OSError('simulated disk full')):
            result = self.case.run_intake()
        self.assertEqual(result['deleted_duplicate_count'], 0)
        self.assertEqual(result['failure_count'], 1)
        self.assertEqual(source.read_bytes(), before)
        self.assertEqual(self.tasks(), [])

    def test_preview_keeps_sync_failures_and_recovery_files(self):
        self.duplicate()
        self.fail_flush()
        before = {p.name: p.read_bytes() for p in self.state.iterdir() if p.name != 'run.lock'}
        self.case.run_intake('--dry-run')
        after = {p.name: p.read_bytes() for p in self.state.iterdir() if p.name != 'run.lock'}
        self.assertEqual(before, after)
        self.assertEqual(self.tasks(), [])

    def seed_legacy_failure(self, extra=()):
        row = {'filename': '阅读器同步', 'path': str(self.state), 'kind': '',
               'reason': 'legacy sync failure', 'library_root': str(self.case.library),
               'recovery': str(self.state / 'pending_missing.json')}
        intake.housekeeping.atomic(self.state / 'failures.csv',
                                   intake.housekeeping.csv_bytes([row, *extra], intake.housekeeping.FAILURE_FIELDS))

    def test_legacy_missing_journal_is_requeued_before_clearing(self):
        self.seed_legacy_failure()
        self.fail_flush()
        self.assertEqual(len(self.rows()), 1)
        self.assertEqual(self.rows()[0]['kind'], 'reader_sync')
        self.assertEqual(len(self.pending()), 1)
        self.assert_synced()

    def test_sync_success_preserves_unselected_books_and_other_libraries(self):
        unrelated = self.case.library / 'needs-review.zip'
        unrelated.write_bytes(b'unresolved original')
        offline = self.case.base / 'offline-library'
        extra = [{'filename': unrelated.name, 'path': str(unrelated), 'reason': 'manual review',
                  'library_root': str(self.case.library), 'recovery': str(self.state / 'missing_book_journal.json')},
                 {'filename': '阅读器同步', 'path': str(self.state), 'reason': 'other library retry',
                  'library_root': str(offline), 'recovery': str(self.state / 'missing_other_journal.json')}]
        self.seed_legacy_failure(extra)
        result = self.case.run_intake()
        self.assertEqual((result['failure_count'], result['pending_count']), (0, 2))
        rows = self.rows()
        self.assertEqual({r['reason'] for r in rows}, {'manual review', 'other library retry'})
        self.assertTrue(unrelated.exists())
        self.assertEqual(len(self.tasks()), 1)

    def test_disabled_reader_retains_existing_scan_intent(self):
        self.duplicate()
        self.fail_flush()
        self.config['komga']['enabled'] = False
        self.save_config()
        result = self.case.run_intake()
        self.assertGreater(result['failure_count'], 0)
        self.assertEqual(len(self.pending()), 1)
        self.assertEqual(len(self.rows()), 1)
        self.assertEqual(self.tasks(), [])
        self.config['komga']['enabled'] = True
        self.save_config()
        self.assert_synced()

    def test_other_library_run_does_not_consume_sync_intent(self):
        self.duplicate()
        self.fail_flush()
        before = {p.name: p.read_bytes() for p in self.pending()}
        other = self.case.base / 'other-library'
        incoming = other / '【未分类】'
        incoming.mkdir(parents=True)
        self.config['libraries']['E'] = {'root': str(other)}
        self.save_config()
        result = self.case.run_intake('--root', str(incoming), '--library-root', str(other))
        self.assertEqual(result['failure_count'], 0)
        self.assertEqual(result['pending_count'], 1)
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.pending()})
        self.assertEqual(self.tasks(), [])
        self.assert_synced()

    def test_failure_after_queue_commit_is_retried_without_missing_recovery_link(self):
        write_book(self.case.incoming / 'input.zip', 'Story', b'new')
        original = intake_reader.Reader.flush
        def fail_after_flush(reader):
            original(reader)
            raise ValueError('simulated failure after task commit')
        with patch.object(intake_reader.Reader, 'flush', fail_after_flush):
            result = self.case.run_intake()
        self.assertEqual(result['failure_count'], 1)
        self.assertEqual(len(self.tasks()), 1)
        self.assertEqual(self.pending(), [])
        self.assertFalse(self.rows()[0]['recovery'])
        self.assert_synced()

    def test_disabled_reader_retains_committed_import_journal(self):
        write_book(self.case.incoming / 'input.zip', 'Story', b'new')
        self.fail_flush()
        self.config['komga']['enabled'] = False
        self.save_config()
        result = self.case.run_intake()
        self.assertEqual(result['failure_count'], 1)
        self.assertEqual(len(self.pending()), 1)
        self.assertEqual(len(self.rows()), 1)
        self.config['komga']['enabled'] = True
        self.save_config()
        self.assert_synced()

    def test_unregistered_library_does_not_discard_scan_intent(self):
        self.duplicate()
        with closing(sqlite3.connect(self.reader_root / 'database.sqlite')) as db, db:
            db.execute('DELETE FROM LIBRARY')
        result = self.case.run_intake()
        self.assertEqual(result['deleted_duplicate_count'], 1)
        self.assertEqual(result['failure_count'], 1)
        self.assertEqual(len(self.pending()), 1)
        self.assertEqual(self.tasks(), [])
        with closing(sqlite3.connect(self.reader_root / 'database.sqlite')) as db, db:
            db.execute('INSERT INTO LIBRARY VALUES (?,?)',
                       ('unit-library', intake_reader.native.java_file_url(self.case.library, directory=True)))
        self.assert_synced()

    def test_owned_task_blocks_retry_until_database_accepts_scan(self):
        self.duplicate()
        with closing(sqlite3.connect(self.reader_root / 'tasks.sqlite')) as db, db:
            db.execute('INSERT INTO TASK (ID,SIMPLE_TYPE,OWNER) VALUES (?,?,?)',
                       ('SCAN_LIBRARY_unit-library_DEEP_false', 'ScanLibrary', 'worker'))
        result = self.case.run_intake()
        self.assertEqual(result['failure_count'], 1)
        self.assertEqual(result['deleted_duplicate_count'], 1)
        self.assertEqual(len(self.pending()), 1)
        self.assertEqual(self.tasks()[0][2], 'worker')
        with closing(sqlite3.connect(self.reader_root / 'tasks.sqlite')) as db, db:
            db.execute('UPDATE TASK SET OWNER=NULL')
        self.assert_synced()

    def test_legacy_scan_retry_survives_unrelated_metadata_outbox(self):
        self.seed_legacy_failure()
        original = intake_reader.Reader.__init__
        def with_metadata_task(reader, settings):
            original(reader, settings)
            reader.queue([{'book_id': 'existing-book', 'library_root': str(self.case.library)}])
        with patch.object(intake_reader.Reader, '__init__', with_metadata_task):
            result = self.case.run_intake()
        self.assertEqual((result['failure_count'], result['pending_count']), (0, 0))
        self.assertEqual({row[0] for row in self.tasks()}, {'RefreshBookMetadata', 'ScanLibrary'})
        self.assertEqual(self.pending(), [])


if __name__ == '__main__':
    unittest.main()
