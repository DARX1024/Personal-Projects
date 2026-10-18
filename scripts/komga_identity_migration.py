"""Preserve Komga 1.24.1 BOOK IDs when applying a reviewed, completed file plan.

This script NEVER moves or deletes files and NEVER deletes BOOK/MEDIA/progress.
Default execution clones the database into memory and rolls the changes back.
Live writes require --commit --service-stopped and an existing --backup file.

Plan format: {"entries": [{"book_id", "old_path", "new_path", "series_title",
"source_series_id" (optional), "library_id" (optional), "changed_xml" (optional),
"title" (optional), "number" (optional)}], "series_updates": [{"series_id",
"title", "title_sort" (optional)}]}. All destination files must already exist.
Only nonempty fields are changed. IDs, original creation dates, media/pages,
book metadata other than reviewed title/number, reading progress and read lists
are preserved. New series receive the three rows required by SeriesLifecycle.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import socket
import sqlite3
import unicodedata
import zipfile
from urllib.parse import quote, unquote, urlparse


def java_file_url(path: str | Path, directory: bool = False) -> str:
    """Match Windows Path.toUri().toURL().toString(), including raw Unicode."""
    text = str(path).replace("\\", "/")
    if not re.match(r"^[A-Za-z]:/", text):
        raise ValueError(f"Expected an absolute Windows drive path: {text}")
    text = text[0].upper() + text[1:]
    if directory and not text.endswith("/"):
        text += "/"
    # Java URI retains Unicode letters, but quotes Character.isSpaceChar and
    # isISOControl characters, including NBSP, ideographic space and C1 codes.
    safe = "/:@!$&'()*+,;=-._~"
    # urllib.quote ignores non-ASCII characters supplied in safe, so Unicode
    # must be retained explicitly instead of passing it through quote.
    def java_raw_unicode(char):
        return ord(char) > 127 and unicodedata.category(char) not in {"Zs", "Zl", "Zp"} and not 0x7F <= ord(char) <= 0x9F
    return "file:/" + "".join(c if java_raw_unicode(c) or c in safe else quote(c, safe="") for c in text)


def file_url_path(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme != "file" or parsed.netloc:
        raise ValueError(f"Expected a local drive file URL: {url}")
    return unquote(parsed.path).lstrip("/").replace("/", "\\").rstrip("\\")


def same_path(a: str | Path, b: str | Path) -> bool:
    return os.path.normcase(os.path.normpath(str(a))) == os.path.normcase(os.path.normpath(str(b)))


def within_root(path: str | Path, root: str | Path) -> bool:
    try:
        return same_path(os.path.commonpath([str(path), str(root)]), root)
    except ValueError:
        return False


def local_file_time(path: Path) -> str:
    stat = path.stat()
    birth = getattr(stat, "st_birthtime_ns", stat.st_ctime_ns)
    # FileSystemScanner.getUpdatedTime uses max(creation,lastModified), local TZ.
    stamp = max(birth, stat.st_mtime_ns)
    value = dt.datetime.fromtimestamp(stamp // 1_000_000_000)
    fraction = str(stamp % 1_000_000_000).rjust(9, "0").rstrip("0")
    return value.isoformat(sep=" ") + ("." + fraction if fraction else "")


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(tzinfo=None).isoformat(sep=" ", timespec="milliseconds")


def new_id(conn: sqlite3.Connection) -> str:
    # String IDs are opaque in Series/SeriesDto; use 13 Crockford base32 digits.
    alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
    while True:
        number = secrets.randbits(64)
        value = ""
        for _ in range(13):
            value = alphabet[number & 31] + value
            number >>= 5
        if not conn.execute("SELECT 1 FROM SERIES WHERE ID=?", (value,)).fetchone():
            return value


def row_dict(row: sqlite3.Row | None, description: str) -> dict:
    if row is None:
        raise ValueError(f"Missing {description}")
    return dict(row)


def insert_dict(conn: sqlite3.Connection, table: str, row: dict) -> None:
    columns = list(row)
    conn.execute(
        f'INSERT INTO "{table}" (' + ",".join(f'"{x}"' for x in columns) + ") VALUES (" + ",".join("?" for _ in columns) + ")",
        tuple(row[x] for x in columns),
    )


def natural_key(value: str) -> list:
    return [(1, int(part)) if part.isdecimal() else (0, part.casefold()) for part in re.split(r"(\d+)", value)]


def normalize_plan(plan: dict | list) -> tuple[list[dict], list[dict]]:
    if isinstance(plan, list):
        return plan, []
    for key in ("entries", "changes", "items", "books"):
        if key in plan:
            return plan[key], plan.get("series_updates", [])
    raise ValueError("Plan must contain entries/changes/items/books")


def bind_metadata_plans(conn: sqlite3.Connection, plans: list[dict]) -> dict:
    """Read-only binding of stable local catalogue IDs to existing Komga IDs."""
    conn.row_factory = sqlite3.Row
    book_by_path = {}
    active_books = list(conn.execute("SELECT * FROM BOOK WHERE DELETED_DATE IS NULL"))
    for book in active_books:
        key = os.path.normcase(os.path.normpath(file_url_path(book["URL"])))
        if key in book_by_path:
            raise ValueError(f"Duplicate active BOOK.URL: {key}")
        book_by_path[key] = dict(book)
    series_by_id = {row["ID"]: dict(row) for row in conn.execute("SELECT * FROM SERIES")}
    entries, skipped, updates = [], {}, {}
    audit_registry = {}
    group_titles_by_root = {}
    for plan in plans:
        root_key = os.path.normcase(os.path.normpath(plan["library_root"]))
        # Each prepared plan supplies the complete final group snapshot for
        # this library. A later guard can dissolve an earlier mistaken group;
        # retaining old entries here would revive its polluted series title.
        if "groups" in plan:
            group_titles_by_root[root_key] = {
                os.path.normcase(os.path.normpath(group["folder"])): group["series"]
                for group in plan["groups"]
            }
        plan_targets = {e["entry_id"]: e["target_path"] for e in plan["entries"]}
        for audit_row in plan.get("_audit_rows", []):
            key = (root_key, audit_row["id"])
            original_path = str(Path(plan["library_root"]) / audit_row["path"])
            first_directory = audit_registry.get(key, {}).get("first_directory", str(Path(original_path).parent))
            audit_registry[key] = {"first_directory": first_directory,
                                  "final_path": plan_targets.get(audit_row["id"], original_path),
                                  "display_after": audit_row["display_after"]}
    original_directory_books, final_directory_books = {}, {}
    for audited in audit_registry.values():
        original_folder = os.path.normcase(os.path.normpath(audited["first_directory"]))
        final_folder = os.path.normcase(os.path.normpath(str(Path(audited["final_path"]).parent)))
        original_directory_books.setdefault(original_folder, []).append(audited["display_after"])
        final_directory_books.setdefault(final_folder, []).append(audited["display_after"])
    directory_titles = {folder: title for groups in group_titles_by_root.values() for folder, title in groups.items()}
    for folder, books in final_directory_books.items():
        original_books = original_directory_books.get(folder, [])
        original_series = {str(book.get("series") or "").strip() for book in original_books}
        if len(original_books) > 1 and (len(original_series) != 1 or "" in original_series):
            continue
        pure_series = {str(book.get("series") or "").strip() for book in books}
        if len(pure_series) == 1 and "" not in pure_series:
            directory_titles.setdefault(folder, next(iter(pure_series)))
        elif len(books) == 1:
            directory_titles.setdefault(folder, str(books[0].get("series") or books[0]["title"]).strip())
    for plan in plans:
        for entry in plan["entries"]:
            source = entry["source_path"]
            key = os.path.normcase(os.path.normpath(source))
            book = book_by_path.get(key)
            if book is None:
                is_image_directory = entry.get("kind") == "image_directory"
                unsupported = Path(source).suffix.lower() not in {".cbz", ".zip", ".cbr", ".rar", ".pdf", ".epub"}
                if is_image_directory or unsupported:
                    skipped[(plan["library_root"], entry["entry_id"])] = {
                        "entry_id": entry["entry_id"], "path": source,
                        "reason": "image_directory_has_no_Komga_BOOK" if is_image_directory else "Komga_unsupported_file_type"}
                    continue
                raise ValueError(f"No existing Komga BOOK for reviewed file: {source}")
            series = series_by_id[book["SERIES_ID"]]
            target = entry["target_path"]
            folder_key = os.path.normcase(os.path.normpath(str(Path(target).parent)))
            display = entry["display_after"]
            pure_series = directory_titles.get(folder_key)
            if not pure_series and entry.get("path_changed"):
                pure_series = display["series"]
            if not pure_series:
                # Metadata Series fields in a flat author folder cannot define
                # separate physical Komga series. Keep this directory's name.
                pure_series = Path(file_url_path(series["URL"])).name or series["NAME"]
            retained = entry.get("independent_xml_title_retained", False)
            range_hint = explicit_chapter_range_start({"scope_title": display["title"]}, str(display.get("number") or ""))
            entries.append({
                "entry_id": entry["entry_id"], "book_id": book["ID"],
                "old_path": source, "new_path": target, "series_title": pure_series,
                "source_series_id": book["SERIES_ID"], "library_id": book["LIBRARY_ID"],
                "changed_xml": entry.get("xml_action") != "preserve",
                "title": None if retained else display["title"],
                "number": display.get("number"), "volume": display.get("volume"),
                "scope_title": display["title"],
                "range_sort_hint": range_hint,
                "range_sort_evidence": "both numbered endpoints are explicit chapter labels in the preserved Title" if range_hint is not None else None,
                "independent_xml_title_retained": retained,
            })
            # Later reviewed deltas may reference a file at the first plan's
            # destination while Komga is still offline at its original URL.
            book_by_path[os.path.normcase(os.path.normpath(target))] = book
        # Restore every existing author/physical series title, including series
        # whose XML did not require edits, before refreshing imported metadata.
        root = os.path.normcase(os.path.normpath(plan["library_root"]))
        for series in series_by_id.values():
            if series["DELETED_DATE"] is not None or series["oneshot"]:
                continue
            directory = file_url_path(series["URL"])
            if not within_root(directory, root):
                continue
            title = directory_titles.get(os.path.normcase(os.path.normpath(directory)))
            if not title:
                title = Path(directory).name or series["NAME"]
            updates[series["ID"]] = {"series_id": series["ID"], "title": title, "title_sort": title}
    merged = {}
    for entry in entries:
        prior = merged.get(entry["book_id"])
        if prior:
            entry = {**prior, **entry, "old_path": prior["old_path"], "source_series_id": prior["source_series_id"],
                     "changed_xml": prior["changed_xml"] or entry["changed_xml"]}
        merged[entry["book_id"]] = entry
    entries = list(merged.values())
    return {"schema": "komga_offline_bound_plan", "entries": entries, "series_updates": list(updates.values()), "skipped": list(skipped.values()),
            "summary": {"bound_books": len(entries), "path_changes": sum(not same_path(e["old_path"], e["new_path"]) for e in entries),
                        "xml_changes": sum(e["changed_xml"] for e in entries), "series_titles": len(updates),
                        "unindexed_image_directories": sum(e["reason"] == "image_directory_has_no_Komga_BOOK" for e in skipped.values()),
                        "unsupported_file_types": sum(e["reason"] == "Komga_unsupported_file_type" for e in skipped.values())}}


def update_series_title(conn: sqlite3.Connection, sid: str, title: str, sort: str, now: str, skipped_locks: list) -> None:
    meta = row_dict(conn.execute("SELECT TITLE,TITLE_SORT,TITLE_LOCK,TITLE_SORT_LOCK FROM SERIES_METADATA WHERE SERIES_ID=?", (sid,)).fetchone(), "SERIES_METADATA")
    updates = {"LAST_MODIFIED_DATE": now}
    if not meta["TITLE_LOCK"] or meta["TITLE"] == title:
        updates.update(TITLE=title, TITLE_LOCK=1)
    else:
        skipped_locks.append({"series_id": sid, "field": "TITLE"})
    if not meta["TITLE_SORT_LOCK"] or meta["TITLE_SORT"] == sort:
        updates.update(TITLE_SORT=sort, TITLE_SORT_LOCK=1)
    else:
        skipped_locks.append({"series_id": sid, "field": "TITLE_SORT"})
    conn.execute("UPDATE SERIES_METADATA SET " + ",".join(f"{key}=?" for key in updates) + " WHERE SERIES_ID=?", (*updates.values(), sid))


def has_compound_scope(entry: dict) -> bool:
    """Only explicit chapter/part evidence permits Volume+Number ordering.

    A pure Vol.1 file normally imports both Number=1 and Volume=1; that is
    one level of numbering and must remain sort 1 with no generated sort lock.
    """
    if "compound_scope" in entry:
        return bool(entry["compound_scope"])
    text = str(entry.get("scope_title") or entry.get("title") or entry.get("new_title") or "")
    value = r"\d{1,5}(?:\.\d{1,3})?"
    chapter = re.search(r"(?:第\s*)?" + value + r"\s*[話话章](?![題题])", text, re.I)
    part = re.search(r"(?<![a-z])(?:part|ch(?:apter)?|episode|ep|lesson)[.\s_-]*" + value + r"\b", text, re.I)
    delimited = re.search(r"\s+--\s+" + value + r"\s*$", text)
    return bool(str(entry.get("volume") or "").strip() and (chapter or part or delimited))


def explicit_chapter_range_start(entry: dict, number: str) -> float | None:
    """Sort a documented chapter bundle by its first chapter, retaining range text.

    Require both endpoints to be separate explicit chapter labels in the title;
    dates such as 2024-07 and arbitrary free-text Number values are unaffected.
    """
    bounds = re.fullmatch(r"(\d{1,5})\s*[-~～〜–—/]\s*(\d{1,5})", number)
    if not bounds or int(bounds[1]) >= int(bounds[2]):
        return None
    text = str(entry.get("scope_title") or entry.get("title") or "")
    digits = {c: i for i, c in enumerate("〇一二三四五六七八九")}
    digits["零"] = 0
    units = {"十": 10, "百": 100, "千": 1000}
    def numeric(token):
        if token.isdecimal():
            return int(token)
        total, current = 0, 0
        for char in token:
            if char in units:
                total += (current or 1) * units[char]
                current = 0
            else:
                current = current * 10 + digits[char]
        return total + current
    labels = re.findall(r"(?:第\s*)?(\d{1,5}|[〇零一二三四五六七八九十百千]+)\s*[話话章](?![題题])", text)
    values = [numeric(value) for value in labels]
    return float(bounds[1]) if values == [int(bounds[1]), int(bounds[2])] else None


def scoped_snapshot(conn, entries, tables):
    ids = sorted({e.get("book_id", e.get("id")) for e in entries})
    result = {}
    for table in tables:
        columns = [r[1] for r in conn.execute('PRAGMA table_info("' + table + '")')]
        if 'BOOK_ID' not in columns:
            continue
        rows = []
        for ident in ids:
            sql = 'SELECT * FROM "' + table + '" WHERE BOOK_ID=?'
            if table == 'MEDIA_FILE':
                sql += " AND FILE_NAME <> 'ComicInfo.xml'"
            rows.extend(tuple(r) for r in conn.execute(sql, (ident,)))
        result[table] = sorted(rows, key=repr)
    result['BOOK_ID_AND_CREATED_DATE'] = [tuple(conn.execute('SELECT ID,CREATED_DATE FROM BOOK WHERE ID=?',(ident,)).fetchone()) for ident in ids]
    return result


def apply_plan(conn: sqlite3.Connection, entries: list[dict], series_updates: list[dict], *, scoped=True) -> dict:
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    preserve_tables = ["MEDIA", "MEDIA_PAGE", "MEDIA_FILE", "READ_PROGRESS", "READLIST_BOOK", "THUMBNAIL_BOOK", "BOOK_METADATA_AUTHOR", "BOOK_METADATA_TAG", "BOOK_METADATA_LINK"]
    tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    preserve_tables = [x for x in preserve_tables if x in tables]
    before = scoped_snapshot(conn, entries, preserve_tables)
    before_book_ids = sorted(e.get("book_id", e.get("id")) for e in entries)
    prepared = []
    seen_ids = set()
    roots = {row["ID"]: file_url_path(row["ROOT"]) for row in conn.execute("SELECT ID,ROOT FROM LIBRARY")}
    for index, entry in enumerate(entries):
        book_id = entry.get("book_id", entry.get("id"))
        if book_id in seen_ids:
            raise ValueError(f"Duplicate plan BOOK ID {book_id}")
        seen_ids.add(book_id)
        book = row_dict(conn.execute("SELECT * FROM BOOK WHERE ID=?", (book_id,)).fetchone(), f"BOOK {book_id}")
        old = entry.get("old_path", entry.get("path"))
        new = entry.get("new_path", old)
        if not old or not new:
            raise ValueError(f"Missing paths at entry {index}")
        if not same_path(file_url_path(book["URL"]), old) and not same_path(file_url_path(book["URL"]), new):
            raise ValueError(f"Database URL does not match reviewed paths for BOOK {book_id}")
        if book["DELETED_DATE"] is not None:
            raise ValueError(f"Plan refers to soft-deleted BOOK {book_id}")
        source_id = entry.get("source_series_id", entry.get("series_id", book["SERIES_ID"]))
        if source_id != book["SERIES_ID"] and not same_path(file_url_path(book["URL"]), new):
            raise ValueError(f"Source SERIES mismatch for BOOK {book_id}")
        if entry.get("library_id", book["LIBRARY_ID"]) != book["LIBRARY_ID"]:
            raise ValueError(f"LIBRARY mismatch for BOOK {book_id}")
        target = Path(new)
        if not target.is_file():
            raise ValueError(f"Destination file has not been prepared: {target}")
        root = roots[book["LIBRARY_ID"]]
        if not within_root(target.resolve(), root):
            raise ValueError(f"Destination leaves the existing library root: {target}")
        source = row_dict(conn.execute("SELECT * FROM SERIES WHERE ID=?", (book["SERIES_ID"],)).fetchone(), f"SERIES for {book_id}")
        title = entry.get("series_title", entry.get("series"))
        if not title:
            title = target.parent.name
        title = str(title).strip()
        if not title:
            raise ValueError(f"Empty SERIES title for BOOK {book_id}")
        prepared.append((entry, book, source, target, title))

    now = utc_now()
    conn.execute("BEGIN IMMEDIATE")
    created = []
    changed = []
    xml_cache_updates = []
    skipped_locks = []
    reviewed_order = {}
    custom_numbers = {}
    automatic_numbers_to_reindex = set()
    automatic_numbers_reindexed = []
    affected = set()
    original_sources = set()
    planned_titles = {item["series_id"]: item for item in series_updates}
    targets = {}
    for entry, book, source, target, title in prepared:
        oneshot = bool(entry.get('oneshot', False))
        dest_url = java_file_url(target) if oneshot else java_file_url(target.parent, directory=True)
        key = (book["LIBRARY_ID"], dest_url)
        if key in targets:
            dest_id, dest_title = targets[key]
            if dest_title != title:
                raise ValueError(f"Conflicting titles for destination directory {target.parent}")
        else:
            matches = list(conn.execute("SELECT * FROM SERIES WHERE LIBRARY_ID=? AND URL=? AND DELETED_DATE IS NULL", key))
            if len(matches) > 1:
                raise ValueError(f"Multiple active SERIES share destination {dest_url}")
            if matches:
                dest_id = matches[0]["ID"]
            else:
                dest_id = new_id(conn)
                insert_dict(conn, "SERIES", {
                    "ID": dest_id, "CREATED_DATE": now, "LAST_MODIFIED_DATE": now,
                    "FILE_LAST_MODIFIED": local_file_time(target if oneshot else target.parent), "NAME": target.stem if oneshot else target.parent.name,
                    "URL": dest_url, "LIBRARY_ID": book["LIBRARY_ID"], "BOOK_COUNT": 0,
                    "DELETED_DATE": None, "oneshot": int(oneshot),
                })
                old_meta = row_dict(conn.execute("SELECT * FROM SERIES_METADATA WHERE SERIES_ID=?", (source["ID"],)).fetchone(), "source SERIES_METADATA")
                insert_dict(conn, "SERIES_METADATA", {
                    "SERIES_ID": dest_id, "CREATED_DATE": now, "LAST_MODIFIED_DATE": now,
                    "STATUS": "ENDED" if oneshot else "ONGOING", "TITLE": title, "TITLE_SORT": title,
                    "TITLE_LOCK": 1, "TITLE_SORT_LOCK": 1,
                    "READING_DIRECTION": old_meta["READING_DIRECTION"],
                    "LANGUAGE": old_meta["LANGUAGE"], "AGE_RATING": old_meta["AGE_RATING"],
                    "SHARING_LABELS_LOCK": old_meta["SHARING_LABELS_LOCK"],
                })
                insert_dict(conn, "BOOK_METADATA_AGGREGATION", {"SERIES_ID": dest_id, "CREATED_DATE": now, "LAST_MODIFIED_DATE": now})
                # Keep content-sharing restrictions; unrelated old book metadata is not copied.
                if "SERIES_METADATA_SHARING" in tables:
                    for label in conn.execute("SELECT LABEL FROM SERIES_METADATA_SHARING WHERE SERIES_ID=?", (source["ID"],)):
                        conn.execute("INSERT INTO SERIES_METADATA_SHARING(LABEL,SERIES_ID) VALUES (?,?)", (label[0], dest_id))
                created.append({"series_id": dest_id, "source_series_id": source["ID"], "title": title, "directory": str(target.parent)})
            targets[key] = (dest_id, title)
            update_series_title(conn, dest_id, title, title, now, skipped_locks)
        if "COLLECTION_SERIES" in tables:
            for membership in conn.execute("SELECT COLLECTION_ID FROM COLLECTION_SERIES WHERE SERIES_ID=?", (source["ID"],)).fetchall():
                if not conn.execute("SELECT 1 FROM COLLECTION_SERIES WHERE COLLECTION_ID=? AND SERIES_ID=?", (membership[0], dest_id)).fetchone():
                    position=conn.execute("SELECT COALESCE(MAX(NUMBER),0)+1 FROM COLLECTION_SERIES WHERE COLLECTION_ID=?", (membership[0],)).fetchone()[0]
                    conn.execute("INSERT INTO COLLECTION_SERIES(COLLECTION_ID,SERIES_ID,NUMBER) VALUES (?,?,?)", (membership[0],dest_id,position))
        xml_changed = bool(entry.get("changed_xml", entry.get("xml_changed", False)))
        if xml_changed and "MEDIA_FILE" in tables and zipfile.is_zipfile(target):
            # ComicInfoProvider refuses a metadata refresh unless MEDIA_FILE
            # lists the exact root entry ComicInfo.xml. Read only the central
            # directory to add/update this XML cache row; image rows are intact.
            with zipfile.ZipFile(target) as archive:
                canonical_xml = [info for info in archive.infolist() if info.filename == "ComicInfo.xml"]
            if len(canonical_xml) > 1:
                raise ValueError(f"Duplicate canonical XML after prepared rewrite: {target}")
            if canonical_xml:
                count = conn.execute("SELECT COUNT(*) FROM MEDIA_FILE WHERE BOOK_ID=? AND FILE_NAME='ComicInfo.xml'", (book["ID"],)).fetchone()[0]
                if count:
                    conn.execute("UPDATE MEDIA_FILE SET FILE_SIZE=?,MEDIA_TYPE='application/xml' WHERE BOOK_ID=? AND FILE_NAME='ComicInfo.xml'", (canonical_xml[0].file_size, book["ID"]))
                else:
                    conn.execute("INSERT INTO MEDIA_FILE(FILE_NAME,BOOK_ID,MEDIA_TYPE,SUB_TYPE,FILE_SIZE) VALUES ('ComicInfo.xml',?,'application/xml',NULL,?)", (book["ID"], canonical_xml[0].file_size))
                xml_cache_updates.append({"book_id": book["ID"], "action": "updated" if count else "added", "uncompressed_size": canonical_xml[0].file_size})
        conn.execute("UPDATE BOOK SET oneshot=?,URL=?,NAME=?,FILE_SIZE=?,FILE_LAST_MODIFIED=?,SERIES_ID=?,LAST_MODIFIED_DATE=?,FILE_HASH=?,FILE_HASH_KOREADER=? WHERE ID=?", (
            int(oneshot), java_file_url(target), target.stem, target.stat().st_size, local_file_time(target), dest_id, now,
            "" if xml_changed else book["FILE_HASH"], "" if xml_changed else book["FILE_HASH_KOREADER"], book["ID"],
        ))
        new_title = entry.get("title", entry.get("new_title"))
        old_book_meta = row_dict(conn.execute("SELECT TITLE_LOCK,NUMBER,NUMBER_LOCK,NUMBER_SORT,NUMBER_SORT_LOCK FROM BOOK_METADATA WHERE BOOK_ID=?", (book["ID"],)).fetchone(), "BOOK_METADATA")
        if new_title:
            if not old_book_meta["TITLE_LOCK"]:
                conn.execute("UPDATE BOOK_METADATA SET TITLE=?,LAST_MODIFIED_DATE=? WHERE BOOK_ID=?", (str(new_title).strip(), now, book["ID"]))
            else:
                skipped_locks.append({"book_id": book["ID"], "field": "TITLE"})
        number = entry.get("number")
        if number is not None:
            number = str(number).strip()
            if number and not old_book_meta["NUMBER_LOCK"]:
                conn.execute("UPDATE BOOK_METADATA SET NUMBER=?,LAST_MODIFIED_DATE=? WHERE BOOK_ID=?", (number, now, book["ID"]))
            elif number and old_book_meta["NUMBER"] != number:
                skipped_locks.append({"book_id": book["ID"], "field": "NUMBER"})
        # An unnumbered work moved out of an author folder must not carry that
        # folder's automatic position (for example "98") into a new series.
        # Reindex only demonstrably derived, unlocked numbers. Empty XML never
        # clears manually authored, range, or other custom metadata numbers.
        if (number is not None and not number and dest_id != source["ID"]
                and not old_book_meta["NUMBER_LOCK"] and not old_book_meta["NUMBER_SORT_LOCK"]
                and str(old_book_meta["NUMBER"]).strip() == str(book["NUMBER"])
                and old_book_meta["NUMBER_SORT"] == float(book["NUMBER"])):
            automatic_numbers_to_reindex.add(book["ID"])
        if number:
            try:
                number_sort = float(number)
                volume = str(entry.get("volume") or "").strip()
                compound = bool(volume) and has_compound_scope(entry)
                if compound:
                    number_sort += float(volume) * 1000
            except (TypeError, ValueError):
                # Number is free text in ComicInfo (Extra, 1-3, 2024-07).
                # Keep that text and use the existing sort until a natural
                # physical sort is available. It is never a plan failure.
                custom_numbers[book["ID"]] = number
                number_sort = old_book_meta["NUMBER_SORT"]
                volume = ""
                compound = False
                range_start = explicit_chapter_range_start(entry, number)
                if range_start is not None:
                    number_sort = range_start
                    compound = True  # Protect the derived bundle order on later sorts.
            if not old_book_meta["NUMBER_SORT_LOCK"]:
                if entry.get('number_sort_hint') is not None:
                    number_sort=float(entry['number_sort_hint'])
                    compound=True
                # Lock generated compound order: ComicInfo imports Number alone
                # and would otherwise discard Volume during the next refresh.
                conn.execute("UPDATE BOOK_METADATA SET NUMBER_SORT=?,NUMBER_SORT_LOCK=?,LAST_MODIFIED_DATE=? WHERE BOOK_ID=?", (number_sort, compound, now, book["ID"]))
                reviewed_order[book["ID"]] = number_sort
            else:
                reviewed_order[book["ID"]] = old_book_meta["NUMBER_SORT"]
                if old_book_meta["NUMBER_SORT"] != number_sort:
                    skipped_locks.append({"book_id": book["ID"], "field": "NUMBER_SORT"})
        affected.update((source["ID"], dest_id))
        original_sources.add(source["ID"])
        changed.append({"book_id": book["ID"], "old_path": entry.get("old_path", entry.get("path")), "new_path": str(target), "old_series_id": source["ID"], "new_series_id": dest_id, "xml_changed": xml_changed})

    # Source directories still holding independent works retain their physical directory title.
    target_ids = {value[0] for value in targets.values()}
    for source_id in original_sources - target_ids:
        source = row_dict(conn.execute("SELECT NAME,URL FROM SERIES WHERE ID=?", (source_id,)).fetchone(), "original source")
        source_title = planned_titles.get(source_id, {}).get("title") or Path(file_url_path(source["URL"])).name or source["NAME"]
        source_sort = planned_titles.get(source_id, {}).get("title_sort") or source_title
        update_series_title(conn, source_id, source_title, source_sort, now, skipped_locks)
    for change in series_updates:
        sid = change["series_id"]
        title = str(change["title"]).strip()
        sort = str(change.get("title_sort", title)).strip()
        if not title or not sort:
            raise ValueError(f"Empty series update for {sid}")
        if not conn.execute("SELECT 1 FROM SERIES WHERE ID=?", (sid,)).fetchone():
            raise ValueError(f"Unknown series update {sid}")
        update_series_title(conn, sid, title, sort, now, skipped_locks)
        affected.add(sid)

    for sid in affected:
        books = list(conn.execute("SELECT b.ID,b.NAME,m.NUMBER_SORT_LOCK,m.NUMBER_SORT FROM BOOK b JOIN BOOK_METADATA m ON m.BOOK_ID=b.ID WHERE b.SERIES_ID=? AND b.DELETED_DATE IS NULL", (sid,)))
        def ordering(row):
            if row["ID"] in reviewed_order:
                return (0, reviewed_order[row["ID"]], natural_key(row["NAME"]))
            if row["NUMBER_SORT_LOCK"]:
                return (0, row["NUMBER_SORT"], natural_key(row["NAME"]))
            return (0, row["NUMBER_SORT"], natural_key(row["NAME"]))
        for index, row in enumerate(sorted(books, key=ordering), 1):
            # BOOK.NUMBER is physical sequence, separate from imported metadata volume number.
            conn.execute("UPDATE BOOK SET NUMBER=? WHERE ID=?", (index, row["ID"]))
            if row["ID"] in automatic_numbers_to_reindex:
                conn.execute("UPDATE BOOK_METADATA SET NUMBER=?,NUMBER_SORT=?,LAST_MODIFIED_DATE=? WHERE BOOK_ID=?", (str(index), float(index), now, row["ID"]))
                automatic_numbers_reindexed.append({"book_id": row["ID"], "series_id": sid, "number": index})
        series = row_dict(conn.execute("SELECT URL FROM SERIES WHERE ID=?", (sid,)).fetchone(), "affected series")
        conn.execute("UPDATE SERIES SET DELETED_DATE=? WHERE ID=?", (None if books else now, sid))
        directory = Path(file_url_path(series["URL"]))
        if directory.is_dir():
            conn.execute("UPDATE SERIES SET BOOK_COUNT=?,FILE_LAST_MODIFIED=?,LAST_MODIFIED_DATE=? WHERE ID=?", (len(books), local_file_time(directory), now, sid))
        else:
            conn.execute("UPDATE SERIES SET BOOK_COUNT=?,LAST_MODIFIED_DATE=? WHERE ID=?", (len(books), now, sid))

    # Rebuild only the derived series progress cache. READ_PROGRESS is never changed.
    for sid in affected:
        conn.execute("DELETE FROM READ_PROGRESS_SERIES WHERE SERIES_ID=?", (sid,))
        conn.execute("""INSERT INTO READ_PROGRESS_SERIES
            (SERIES_ID,USER_ID,READ_COUNT,IN_PROGRESS_COUNT,MOST_RECENT_READ_DATE,LAST_MODIFIED_DATE)
            SELECT b.SERIES_ID,r.USER_ID,
                SUM(CASE WHEN r.COMPLETED THEN 1 ELSE 0 END),
                SUM(CASE WHEN NOT r.COMPLETED THEN 1 ELSE 0 END),MAX(r.READ_DATE),?
            FROM BOOK b JOIN READ_PROGRESS r ON r.BOOK_ID=b.ID
            WHERE b.SERIES_ID=? GROUP BY b.SERIES_ID,r.USER_ID""", (now, sid))
    after_book_ids = sorted(e.get("book_id", e.get("id")) for e in entries)
    after = scoped_snapshot(conn, entries, preserve_tables)
    if before_book_ids != after_book_ids:
        raise ValueError("BOOK ID invariant failed")
    if before != after:
        raise ValueError("MEDIA/progress/readlist invariant failed")
    metadata_after = {
        "series": [dict(conn.execute("SELECT SERIES_ID,TITLE,TITLE_SORT,TITLE_LOCK,TITLE_SORT_LOCK FROM SERIES_METADATA WHERE SERIES_ID=?", (sid,)).fetchone()) for sid in sorted(affected)],
        "books": [dict(conn.execute("SELECT BOOK_ID,TITLE,NUMBER,NUMBER_SORT,TITLE_LOCK,NUMBER_LOCK,NUMBER_SORT_LOCK FROM BOOK_METADATA WHERE BOOK_ID=?", (entry["book_id"],)).fetchone()) for entry in changed],
    }
    return {"created_series": created, "changed_books": changed, "affected_series_ids": sorted(affected), "skipped_manual_locks": skipped_locks,
            "xml_media_file_cache_updates": xml_cache_updates, "automatic_numbers_reindexed": automatic_numbers_reindexed,
            "metadata_after": metadata_after, "preserved": after, "book_count": len(after_book_ids), "book_ids_unchanged": True, "transaction": "pending"}


