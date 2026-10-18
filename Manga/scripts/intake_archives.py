"""Read and convert comic archives through the existing Windows libarchive tool."""
from __future__ import annotations

from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path, PurePosixPath
import hashlib
import os
import re
import shutil
import stat
import subprocess
import tarfile
import tempfile
import time
import unicodedata
import zipfile
import zlib

CONVERT_EXTS = {'.rar', '.cbr', '.7z', '.cb7'}


def stamp(path):
    value = Path(path).stat()
    return [value.st_size, value.st_mtime_ns, value.st_dev, value.st_ino]


@lru_cache(maxsize=1)
def archive_tool():
    path = Path(os.environ.get('SystemRoot', 'C:/Windows')) / 'System32/tar.exe'
    executable = str(path) if path.is_file() else shutil.which('bsdtar') or shutil.which('tar')
    if not executable:
        raise ValueError('找不到支持 RAR/7z 的 bsdtar，原文件保留')
    version = subprocess.run([executable, '--version'], capture_output=True, check=True).stdout
    if b'bsdtar' not in version.lower():
        raise ValueError('当前 tar 不支持归档转换，请使用 Windows 自带 bsdtar；原文件保留')
    return executable


def entry_name(value):
    name = value.replace('\\', '/')
    path = PurePosixPath(name)
    if (not name or name.startswith('/') or re.match(r'^[A-Za-z]:', name)
            or '..' in path.parts or '\x00' in name or '\n' in name or '\r' in name):
        raise ValueError('归档中有不安全或无法确认的文件名，原文件保留：' + repr(value))
    return name


def call_bytes(arguments, limit):
    with tempfile.TemporaryFile() as errors:
        process = subprocess.Popen([archive_tool(), *arguments], stdin=subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=errors)
        try:
            raw = process.stdout.read(limit + 1)
            if len(raw) > limit:
                raise ValueError('归档目录或 ComicInfo 超过读取上限，原文件保留')
            if process.wait() != 0:
                errors.seek(0)
                detail = errors.read(3000).decode('mbcs' if os.name == 'nt' else 'utf-8', errors='replace')
                raise ValueError('归档读取失败，原文件保留：' + detail.strip())
            return raw
        finally:
            if process.poll() is None:
                process.terminate()
                process.wait()
            process.stdout.close()


def directory(path, image_exts):
    before = stamp(path)
    raw = call_bytes(['-tf', str(path)], 32 * 1024 * 1024)
    names = [entry_name(name) for name in raw.decode('mbcs' if os.name == 'nt' else 'utf-8').splitlines()]
    if len(names) != len(set(names)):
        raise ValueError('归档中有同名条目，请人工处理')
    xml_names = [name for name in names if PurePosixPath(name).name.casefold() == 'comicinfo.xml']
    if len(xml_names) > 1:
        raise ValueError('压缩包内有多个 ComicInfo.xml，请人工处理')
    xml = call_bytes(['-xOf', str(path), '--', xml_names[0]], 1024 * 1024) if xml_names else None
    pages = sum(not name.endswith('/') and PurePosixPath(name).suffix.casefold() in image_exts for name in names)
    if stamp(path) != before:
        raise ValueError('归档在读取时发生变化，原文件保留')
    return pages, xml, xml_names[0] if xml_names else None


@contextmanager
def stream_archive(path):
    # Repack to a PAX stream; never extract archive paths onto the filesystem.
    with tempfile.TemporaryFile() as errors:
        process = subprocess.Popen([archive_tool(), '-cf', '-', '--format=pax', '@' + str(Path(path).absolute())],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=errors)
        archive = None
        try:
            archive = tarfile.open(fileobj=process.stdout, mode='r|')
            yield archive
            # Drain PAX padding so the writer can exit even for many tiny files.
            while process.stdout.read(1024 * 1024):
                pass
            if process.wait() != 0:
                errors.seek(0)
                detail = errors.read(3000).decode('mbcs' if os.name == 'nt' else 'utf-8', errors='replace')
                raise ValueError('归档解码失败，原文件保留：' + detail.strip())
        finally:
            if archive is not None:
                archive.close()
            if process.poll() is None:
                process.terminate()
                process.wait()
            process.stdout.close()


def regular_members(archive):
    names = set()
    for member in archive:
        name = entry_name(member.name)
        if name in names:
            raise ValueError('归档中有同名条目，原文件保留：' + name)
        names.add(name)
        if not member.isfile() and not member.isdir():
            raise ValueError('归档中包含链接或特殊文件，原文件保留：' + name)
        yield member, name


def convert(path, target, *, expected):
    """Keep the source until the caller commits a fully verified CBZ."""
    if stamp(path) != expected:
        raise ValueError('原归档在准备后发生变化，未转换')
    manifest = {}
    created = False
    try:
        with stream_archive(path) as archive, zipfile.ZipFile(target, 'x', compression=zipfile.ZIP_STORED, allowZip64=True) as output:
            created = True
            for member, name in regular_members(archive):
                date = time.localtime(max(member.mtime, 315532800))[:6]
                info = zipfile.ZipInfo(name.rstrip('/') + '/' if member.isdir() else name, date)
                info.external_attr = ((stat.S_IFDIR if member.isdir() else stat.S_IFREG) | member.mode) << 16
                if member.isdir():
                    output.writestr(info, b'')
                    continue
                digest = hashlib.sha256()
                size = 0
                with archive.extractfile(member) as source, output.open(info, 'w', force_zip64=True) as destination:
                    while block := source.read(1024 * 1024):
                        digest.update(block)
                        size += len(block)
                        destination.write(block)
                if size != member.size:
                    raise ValueError('归档条目读取不完整，原文件保留：' + name)
                manifest[name] = (size, digest.hexdigest())
        with zipfile.ZipFile(target) as output:
            files = [entry for entry in output.infolist() if not entry.is_dir()]
            if len(files) != len(manifest) or {entry.filename for entry in files} != set(manifest):
                raise ValueError('转换后条目清单不一致，原文件保留')
            for entry in files:
                digest = hashlib.sha256()
                with output.open(entry) as stream:
                    while block := stream.read(1024 * 1024):
                        digest.update(block)  # ZIP reader also verifies the entry CRC.
                if (entry.file_size, digest.hexdigest()) != manifest[entry.filename]:
                    raise ValueError('转换后内容核验不一致，原文件保留：' + entry.filename)
        if stamp(path) != expected:
            raise ValueError('转换期间原归档发生变化，原文件保留')
        return len(manifest)
    except BaseException:
        if created:
            Path(target).unlink(missing_ok=True)
        raise


def fingerprint(path, image_exts):
    names = call_bytes(['-tf', str(path)], 32 * 1024 * 1024).decode('mbcs' if os.name == 'nt' else 'utf-8').splitlines()
    def order(name):
        normalized = unicodedata.normalize('NFKC', name.replace('\\', '/')).casefold()
        return tuple((1, int(part)) if part.isdigit() else (0, part) for part in re.split(r'(\d+)', normalized))
    pages = sorted((entry_name(name) for name in names if not name.endswith('/')
                    and PurePosixPath(name).suffix.casefold() in image_exts), key=order)
    if not pages:
        raise ValueError('候选归档没有支持的图页')
    samples = {name: tempfile.SpooledTemporaryFile(max_size=4 * 1024 * 1024) for name in pages[:3]}
    manifest = {}
    try:
        with stream_archive(path) as archive:
            for member, name in regular_members(archive):
                if not member.isfile() or name not in pages:
                    continue
                crc = size = 0
                with archive.extractfile(member) as source:
                    while block := source.read(1024 * 1024):
                        size += len(block)
                        crc = zlib.crc32(block, crc)
                        if name in samples:
                            samples[name].write(block)
                manifest[name] = (size, crc)
        if set(manifest) != set(pages):
            raise ValueError('图页目录与实际读取内容不一致')
        digest = hashlib.sha256(b'manga-first-three-pages-v1\x00')
        digest.update(len(samples).to_bytes(1, 'big'))
        for name in pages[:3]:
            digest.update(manifest[name][0].to_bytes(8, 'big'))
            samples[name].seek(0)
            while block := samples[name].read(1024 * 1024):
                digest.update(block)
        return tuple(manifest[name] for name in pages), digest.hexdigest()
    finally:
        for stream in samples.values():
            stream.close()
