"""Windows launchers work in a source-only checkout with an external Python."""
from pathlib import Path
from tempfile import TemporaryDirectory
import json
import os
import shutil
import subprocess
import sys
import unittest

PROJECT = Path(__file__).resolve().parents[1]


def quote(value):
    return "'" + str(value).replace("'", "''") + "'"


@unittest.skipUnless(os.name == 'nt', 'Windows launcher integration')
class Launchers(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory(prefix='manga-launcher ')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'scripts').mkdir()
        for name in ('runtime.ps1', '整理新漫画.cmd', 'scripts/start_intake.ps1'):
            shutil.copyfile(PROJECT / name, self.root / name)
        (self.root / 'scripts/daily_intake.py').write_text(
            'import json,sys; print(json.dumps(sys.argv[1:], ensure_ascii=True))', encoding='utf-8')
        self.env = dict(os.environ)
        self.env.pop('MANGA_INTAKE_PYTHON', None)

    def powershell(self, code, env=None):
        return subprocess.run(['powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive',
                               '-ExecutionPolicy', 'Bypass', '-Command', code],
                              env=env or self.env, capture_output=True, text=True, timeout=25)

    def resolve(self, options='', setup='', env=None):
        return self.powershell("$ErrorActionPreference='Stop'; . " + quote(self.root / 'runtime.ps1')
                               + '; ' + setup + '; Get-MangaPython ' + options, env)

    def test_explicit_python_wins_over_environment(self):
        env = {**self.env, 'MANGA_INTAKE_PYTHON': str(self.root / 'invalid.exe')}
        result = self.resolve('-Python ' + quote(sys.executable), env=env)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(Path(result.stdout.strip()), Path(sys.executable))

    def test_environment_python_runs_without_bundled_runtime(self):
        result = self.resolve(env={**self.env, 'MANGA_INTAKE_PYTHON': sys.executable})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(Path(result.stdout.strip()), Path(sys.executable))

    def test_explicit_invalid_python_fails_without_silent_fallback(self):
        result = self.resolve('-Python ' + quote(self.root / 'missing.exe'),
                              env={**self.env, 'MANGA_INTAKE_PYTHON': sys.executable})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('selected Python', result.stderr)

    def test_automatic_discovery_continues_after_invalid_candidate(self):
        # The first candidate gets py's -3 switch on a plain interpreter and fails.
        setup = "function Get-Command { param($Name,$CommandType,$ErrorAction); [pscustomobject]@{Source=" + quote(sys.executable) + '} }'
        result = self.resolve(setup=setup)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(Path(result.stdout.strip()), Path(sys.executable))

    def test_cmd_preserves_python_arguments_and_paths_with_spaces(self):
        args = ['--dry-run', '--root', str(self.root / '中文 目录'), '--tag-language', 'raw']
        command = subprocess.list2cmdline([str(self.root / '整理新漫画.cmd'), *args])
        result = subprocess.run(command, shell=True,
                                env={**self.env, 'MANGA_INTAKE_PYTHON': sys.executable},
                                capture_output=True, text=True, timeout=25)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout.strip()), args)

    def test_launcher_reports_invalid_environment_and_returns_failure(self):
        result = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
                                 '-File', str(self.root / 'scripts/start_intake.ps1'), '--help'],
                                env={**self.env, 'MANGA_INTAKE_PYTHON': str(self.root / 'missing.exe')},
                                capture_output=True, text=True, timeout=25)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('selected Python', result.stderr)


if __name__ == '__main__':
    unittest.main()
