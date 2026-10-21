"""Guardas operacionais com ferramentas dublês; não substitui restore real."""
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
OLD = '94d3e8337ccf0bbe7fa5c861bdd197dabc4d3280afd53ae6cc06ab62e1fc9979'


class UpgradeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for part in ['bin', 'state', 'schema', 'release/migrations', 'backups', 'setup']:
            (self.root / part).mkdir(parents=True)
        for part in ['release', 'schema']:
            (self.root / part / 'baseline.sql').write_text('select 42;\n')
        self.new = '12345:' + hashlib.sha256(b'select 42;\n').hexdigest()
        self.old = '12345:' + OLD
        for name in ['schema.signature', 'owner.signature']:
            (self.root / 'state' / name).write_text(self.old)
        for number, clock in [(276, 120000), (277, 130000), (278, 140000), (279, 150000), (280, 160000)]:
            (self.root / 'release/migrations' / f'20261021{clock:06}_0{number}_test.sql').write_text(f'select {number};\n')
        (self.root / 'setup/equipe-0280.sha256').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest() + '  ' + p.relative_to(self.root / 'release').as_posix() + '\n' for p in (self.root / 'release').rglob('*.sql')))
        script = (ROOT / 'docker/easypanel/atualizar-equipe-db.sh').read_text()
        for part in ['state', 'schema', 'release', 'backups', 'setup']:
            script = script.replace('/' + part + '/', str(self.root / part) + '/')
        script = script.replace('cd /release ', 'cd ' + str(self.root / 'release') + ' ')
        # /backups tem um uso sem barra final.
        script = script.replace('backup=/backups/', 'backup=' + str(self.root / 'backups') + '/')
        self.script = self.root / 'upgrade.sh'
        self.script.write_text(script)
        programs = {
            'psql': '''case "$*" in
*pg_control_system*) echo "${CLUSTER:-12345}";;
*to_regclass*) echo t;;
*--single-transaction*)
  test -s "${0%/*}/../backups/"*/postgres.dump || exit 90
  echo applied >> "$TEST_CALLS"
  exit "${SQL_EXIT:-0}";;
*) exit 0;; esac''',
            'pg_dump': '''echo backup >> "$TEST_CALLS"
[ "${BACKUP_FAIL:-0}" = 0 ] || exit 8
for arg do case "$arg" in --file=*) echo dump > "${arg#--file=}";; esac; done''',
            'pg_dumpall': '''for arg do case "$arg" in --file=*) echo globals > "${arg#--file=}";; esac; done''',
            'pg_restore': '''echo catalog >> "$TEST_CALLS"
[ "${CATALOG_FAIL:-0}" = 0 ] || exit 9
echo 'archive catalog' ''',
        }
        for name, code in programs.items():
            p = self.root / 'bin' / name
            p.write_text('#!/bin/sh\nset -eu\n' + code + '\n')
            p.chmod(0o700)
        self.calls = self.root / 'calls'
        self.env = dict(os.environ, PATH=str(self.root / 'bin') + ':' + os.environ['PATH'], TEST_CALLS=str(self.calls))

    def run_upgrade(self, mode='--apply', **changes):
        return subprocess.run(['sh', str(self.script), mode], env=dict(self.env, **changes), capture_output=True, text=True)

    def receipt(self, name='schema.signature'):
        return (self.root / 'state' / name).read_text().strip()

    def test_check_never_backs_up_or_applies(self):
        result = self.run_upgrade('--check')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.calls.exists())
        self.assertEqual(self.receipt(), self.old)

    def test_apply_backup_before_sql_and_preserve_owner(self):
        result = self.run_upgrade()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.calls.read_text().splitlines(), ['backup', 'catalog', 'applied'])
        self.assertEqual(self.receipt(), self.new)
        self.assertEqual(self.receipt('owner.signature'), self.new)
        sql = next((self.root / 'backups').glob('*/aplicar.sql')).read_text()
        self.assertIn('pg_advisory_xact_lock(647391020)', sql)
        for number in range(276, 281):
            self.assertIn(f'select {number};', sql)
        self.assertNotIn('bootstrap-owner', sql)
        self.assertNotIn('select 42;', sql)  # baseline não é reaplicado
        self.assertEqual(next((self.root / 'backups').glob('*/schema.signature')).read_text(), self.old)

    def test_other_cluster_or_version_refused(self):
        for receipt in ['other:' + OLD, '12345:other']:
            (self.root / 'state/schema.signature').write_text(receipt)
            self.assertNotEqual(self.run_upgrade().returncode, 0)
        self.assertFalse(self.calls.exists())

    def test_missing_owner_refused(self):
        (self.root / 'state/owner.signature').unlink()
        self.assertNotEqual(self.run_upgrade().returncode, 0)
        self.assertFalse(self.calls.exists())

    def test_missing_migration_refused(self):
        next((self.root / 'release/migrations').glob('*0280*')).unlink()
        self.assertNotEqual(self.run_upgrade().returncode, 0)
        self.assertFalse(self.calls.exists())

    def test_different_image_refused_before_backup(self):
        (self.root / 'schema/baseline.sql').write_text('wrong image')
        self.assertNotEqual(self.run_upgrade().returncode, 0)
        self.assertFalse(self.calls.exists())

    def test_backup_failure_blocks_sql_and_receipts(self):
        self.assertNotEqual(self.run_upgrade(BACKUP_FAIL='1').returncode, 0)
        self.assertEqual(self.calls.read_text().splitlines(), ['backup'])
        self.assertEqual(self.receipt(), self.old)

    def test_bad_catalog_blocks_sql(self):
        self.assertNotEqual(self.run_upgrade(CATALOG_FAIL='1').returncode, 0)
        self.assertNotIn('applied', self.calls.read_text())
        self.assertEqual(self.receipt(), self.old)

    def test_sql_failure_does_not_advance_receipts(self):
        self.assertNotEqual(self.run_upgrade(SQL_EXIT='3').returncode, 0)
        self.assertEqual(self.receipt(), self.old)
        self.assertEqual(self.receipt('owner.signature'), self.old)
        self.assertFalse((self.root / 'state/equipe-0280.complete').exists())
        self.assertFalse((self.root / 'state/equipe-upgrade.lock').exists())

    def test_already_applied_is_noop(self):
        self.assertEqual(self.run_upgrade().returncode, 0)
        before = self.calls.read_text()
        self.assertEqual(self.run_upgrade().returncode, 0)
        self.assertEqual(self.calls.read_text(), before)

    def test_changed_migration_refused_before_backup(self):
        next((self.root / 'release/migrations').glob('*0280*')).write_text('unreviewed SQL')
        self.assertNotEqual(self.run_upgrade().returncode, 0)
        self.assertFalse(self.calls.exists())

    def test_future_baseline_refused_before_backup(self):
        (self.root / 'release/baseline.sql').write_text('future version')
        self.assertNotEqual(self.run_upgrade().returncode, 0)
        self.assertFalse(self.calls.exists())

    def test_busy_lock_refused(self):
        (self.root / 'state/equipe-upgrade.lock').mkdir()
        self.assertNotEqual(self.run_upgrade().returncode, 0)
        self.assertFalse(self.calls.exists())

    def test_unknown_mode_refused(self):
        self.assertNotEqual(self.run_upgrade('--force').returncode, 0)
        self.assertFalse(self.calls.exists())


class HostUpgradeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / 'docker/easypanel').mkdir(parents=True)
        (self.root / 'bin').mkdir()
        self.script = self.root / 'docker/easypanel/atualizar-equipe.sh'
        self.script.write_text((ROOT / 'docker/easypanel/atualizar-equipe.sh').read_text())
        docker = self.root / 'bin/docker'
        docker.write_text('''#!/bin/sh
set -eu
echo "$*" >> "$TEST_CALLS"
case "$*" in
*'ps --all -q app'*) [ "${APP_MISSING:-0}" = 0 ] && echo app-id; exit 0;;
*' pull '*) [ "${PULL_FAIL:-0}" = 0 ] || exit 7;;
*'--check-image'*) [ "${IMAGE_FAIL:-0}" = 0 ] || exit 8;;
*'--apply'*) [ "${SQL_FAIL:-0}" = 0 ] || exit 9;;
esac
''')
        docker.chmod(0o700)
        self.calls = self.root / 'calls'
        self.env = dict(os.environ, PATH=str(self.root / 'bin') + ':' + os.environ['PATH'], TEST_CALLS=str(self.calls))

    def run_host(self, mode='--apply', **changes):
        return subprocess.run(['sh', str(self.script), mode], env=dict(self.env, **changes), capture_output=True, text=True)

    def test_read_only_does_not_pull_stop_or_apply(self):
        self.assertEqual(self.run_host('--check').returncode, 0)
        calls = self.calls.read_text()
        self.assertNotIn(' pull ', calls)
        self.assertNotIn(' stop ', calls)
        self.assertNotIn('--apply', calls)

    def test_failed_pull_or_image_check_does_not_stop_runtime(self):
        for changes in [dict(PULL_FAIL='1'), dict(IMAGE_FAIL='1')]:
            self.assertNotEqual(self.run_host(**changes).returncode, 0)
            self.assertNotIn(' stop ', self.calls.read_text())
            self.calls.unlink()

    def test_wrong_project_refused(self):
        self.assertNotEqual(self.run_host(APP_MISSING='1').returncode, 0)
        self.assertNotIn(' stop ', self.calls.read_text())

    def test_upgrade_order_and_no_automatic_deploy(self):
        self.assertEqual(self.run_host().returncode, 0)
        calls = self.calls.read_text()
        self.assertLess(calls.index(' pull '), calls.index('--check-image'))
        self.assertLess(calls.index('--check-image'), calls.index(' stop '))
        self.assertLess(calls.index(' stop '), calls.index('--apply'))
        self.assertNotIn(' up ', calls)
        self.assertNotIn(' down ', calls)

    def test_sql_failure_leaves_runtime_stopped_for_inspection(self):
        self.assertNotEqual(self.run_host(SQL_FAIL='1').returncode, 0)
        calls = self.calls.read_text()
        self.assertIn(' stop scheduler worker app', calls)
        self.assertNotIn(' start ', calls)
        self.assertNotIn(' up ', calls)


if __name__ == '__main__':
    unittest.main()
