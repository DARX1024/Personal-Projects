"""Komga integration restricted to files in the current intake transaction."""
from __future__ import annotations

from contextlib import contextmanager, closing
from pathlib import Path
import json
import socket
import sqlite3
import subprocess
import time

import komga_identity_migration as native


def key(path):
    return str(Path(path).absolute()).replace('\\', '/').casefold()


def listening(port):
    with socket.socket() as connection:
        connection.settimeout(.3)
        return connection.connect_ex(('127.0.0.1', port)) == 0


def quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def powershell(code):
    subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', code],
                   check=True, capture_output=True, text=True)


class Reader:
    def __init__(self, settings=None):
        self.settings = settings or {}
        self.enabled = bool(self.settings.get('enabled'))
        self.restarted = False
        self.connection = None
        self.outbox = []
        self.pending_journals = []
        self.pause_marker = Path(self.settings['_state_dir']) / 'service_pause.json' if self.settings.get('_state_dir') else None

    @contextmanager
    def paused(self):
        """No network lookup takes place inside this window."""
        try:
            if self.enabled:
                port = self.settings.get('port', 25600)
                database = Path(self.settings['app_data']) / 'database.sqlite'
                if not database.is_file():
                    raise ValueError('配置的 Komga 数据库不存在，未提交本批')
                if self.pause_marker and self.pause_marker.is_file():
                    saved = json.loads(self.pause_marker.read_bytes())
                    if key(saved['executable']) != key(self.settings['executable']) or saved['port'] != port:
                        raise ValueError('服务恢复记录属于另一配置，请人工处理')
                    self.restarted = True
                if listening(port):
                    task_path = Path(self.settings['app_data']) / 'tasks.sqlite'
                    with closing(sqlite3.connect(task_path.as_uri() + '?mode=ro', uri=True)) as tasks:
                        if tasks.execute('SELECT COUNT(*) FROM TASK').fetchone()[0]:
                            raise ValueError('Komga 正在处理任务，本批尚未提交；请在队列空闲后重试')
                    executable = quote(Path(self.settings['executable']).resolve())
                    if self.pause_marker:
                        self.pause_marker.parent.mkdir(parents=True, exist_ok=True)
                        self.pause_marker.write_text(json.dumps({'executable': self.settings['executable'], 'port': port}), encoding='utf-8')
                    powershell("$p=Get-Process -Name Komga -ErrorAction Stop | Where-Object {$_.Path -eq " + executable +
                               "}; if (@($p).Count -ne 1) { throw 'Cannot identify configured Komga process' }; Stop-Process -Id $p.Id -ErrorAction Stop")
                    self.restarted = True
                    for _ in range(60):
                        if not listening(port):
                            break
                        time.sleep(.25)
                    else:
                        raise RuntimeError('Komga 未完成停止，未提交本批')
                self.connection = sqlite3.connect(database)
                self.connection.row_factory = sqlite3.Row
            yield self
        finally:
            if self.connection is not None:
                self.connection.close()
                self.connection = None
            if self.restarted:
                if not listening(self.settings.get('port', 25600)):
                    powershell('Start-Process -FilePath ' + quote(self.settings['executable']) +
                               ' -WorkingDirectory ' + quote(Path(self.settings['executable']).parent) + ' -WindowStyle Hidden')
                if self.pause_marker:
                    self.pause_marker.unlink(missing_ok=True)
                self.restarted = False

    def bind(self, operations):
        if not self.enabled:
            return
        for operation in operations:
            rows = self.connection.execute('SELECT ID,URL,SERIES_ID,LIBRARY_ID,FILE_SIZE FROM BOOK WHERE URL=? COLLATE NOCASE AND DELETED_DATE IS NULL',
                                           (native.java_file_url(operation['source']),)).fetchall()
            if len(rows) > 1:
                raise ValueError('Komga 有多条记录指向本次文件，请人工处理：' + operation['source'])
            operation['book_id'] = rows[0]['ID'] if rows else None

    def apply(self, operations):
        entries = [{'book_id': o['book_id'], 'old_path': o['source'], 'new_path': o['target'],
                    'series_title': o.get('series') or Path(o['target']).stem,
                    'oneshot': not bool(o.get('series')), 'title': o.get('title'),
                    'number': o.get('number', ''), 'volume': o.get('volume', ''),
                    'changed_xml': o.get('xml') is not None or o.get('converted', False)} for o in operations if o.get('book_id')]
        # Metadata-only writes keep the reader's existing physical series layout.
        # Empty ComicInfo Series does not turn a file in a series folder into a oneshot.
        preserve_layout = {o.get('book_id') for o in operations if o.get('preserve_reader_layout')}
        for entry in entries:
            if key(entry['old_path']) == key(entry['new_path']) or entry['book_id'] in preserve_layout:
                row = self.connection.execute(
                    'SELECT b.oneshot,m.TITLE FROM BOOK b JOIN SERIES_METADATA m ON m.SERIES_ID=b.SERIES_ID WHERE b.ID=?',
                    (entry['book_id'],)).fetchone()
                if row is not None:
                    entry['oneshot'] = bool(row[0])
                    if not entry['oneshot']:
                        entry['series_title'] = row[1]
        if not entries:
            return {'affected_series_ids': [], 'changed_books': []}
        try:
            result = native.apply_plan(self.connection, entries, [], scoped=True)
            self.connection.commit()
            return result
        except BaseException:
            self.connection.rollback()
            raise

    def committed(self, operations):
        bound = [o for o in operations if o.get('book_id')]
        return bool(bound) and all((row := self.connection.execute('SELECT URL,FILE_SIZE FROM BOOK WHERE ID=?', (o['book_id'],)).fetchone())
                                  and key(native.file_url_path(row['URL'])) == key(o['target'])
                                  and row['FILE_SIZE'] == Path(o['target']).stat().st_size for o in bound)

    def queue(self, operations, series_ids=(), *, immediate=False):
        if not self.enabled:
            return
        if not immediate:
            self.outbox.append((operations, list(series_ids)))
            return
        import datetime as dt
        now = dt.datetime.now(dt.timezone.utc).replace(tzinfo=None).isoformat(sep=' ', timespec='milliseconds')
        rows = []
        for operation in operations:
            if operation.get('book_id'):
                ident = operation['book_id']
                if operation.get('converted'):
                    rows.append(('ANALYZE_BOOK_' + ident, 'AnalyzeBook',
                                 {'bookId': ident, 'priority': 9, 'groupId': ident}))
                rows.append(('REFRESH_BOOK_METADATA_' + ident, 'RefreshBookMetadata',
                             {'bookId': ident, 'capabilities': ['TITLE', 'NUMBER', 'NUMBER_SORT', 'AUTHORS', 'TAGS', 'LINKS'],
                              'priority': 8, 'groupId': ident}))
        for ident in sorted(set(series_ids)):
            rows.append(('AGGREGATE_SERIES_METADATA_' + ident, 'AggregateSeriesMetadata',
                         {'seriesId': ident, 'priority': 7, 'groupId': ident}))
        # Normal scans discover new files and analyze converted registered books.
        roots = {key(o['library_root']) for o in operations if not o.get('book_id') or o.get('converted')}
        matched_roots = set()
        for row in self.connection.execute('SELECT ID,ROOT FROM LIBRARY'):
            root_key = key(native.file_url_path(row['ROOT']))
            if root_key in roots:
                matched_roots.add(root_key)
                ident = row['ID']
                rows.append(('SCAN_LIBRARY_' + ident + '_DEEP_false', 'ScanLibrary',
                             {'libraryId': ident, 'scanDeep': False, 'priority': 6, 'groupId': ident}))
        if roots - matched_roots:
            raise ValueError('Komga 未登记待扫描书库，保留恢复记录：' + '；'.join(sorted(roots - matched_roots)))
        if not rows:
            return
        with closing(sqlite3.connect(Path(self.settings['app_data']) / 'tasks.sqlite')) as tasks, tasks:
            for ident, kind, payload in rows:
                payload['uniqueId'] = ident
                old = tasks.execute('SELECT OWNER FROM TASK WHERE ID=?', (ident,)).fetchone()
                if old and old[0] is not None:
                    raise ValueError('阅读器刷新任务正在执行，保留本次恢复记录')
                tasks.execute('''INSERT INTO TASK(ID,PRIORITY,GROUP_ID,CLASS,SIMPLE_TYPE,PAYLOAD,OWNER)
                                 VALUES (?,?,?,?,?,?,NULL) ON CONFLICT(ID) DO UPDATE SET
                                 PRIORITY=excluded.PRIORITY,PAYLOAD=excluded.PAYLOAD,LAST_MODIFIED_DATE=? WHERE TASK.OWNER IS NULL''',
                              (ident, payload['priority'], payload['groupId'],
                               'org.gotson.komga.application.tasks.Task$' + kind, kind,
                              json.dumps(payload, separators=(',', ':')), now))

    def flush(self):
        operations = [operation for batch, _ in self.outbox for operation in batch]
        series_ids = {ident for _, ids in self.outbox for ident in ids}
        self.queue(operations, series_ids, immediate=True)
        for path in self.pending_journals:
            path.unlink(missing_ok=True)
        self.outbox.clear()
        self.pending_journals.clear()
