"""Testa as guardas de setup com psql dublê; não prova execução real do SQL."""
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class InitTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for part in ['bin', 'state', 'schema']:
            (self.root / part).mkdir()
        self.sql = 'select 1;\n'
        (self.root / 'schema/baseline.sql').write_text(self.sql)
        source = (ROOT / 'docker/easypanel/init-db.sh').read_text()
        source = source.replace('/state/', str(self.root / 'state') + '/')
        source = source.replace('/schema/', str(self.root / 'schema') + '/')
        (self.root / 'init.sh').write_text(source)
        fake = self.root / 'bin/psql'
        fake.write_text('''#!/bin/sh
case "$*" in
  *pg_control_system*) echo 12345 ;;
  *to_regclass*) echo "${HAS_SCHEMA:-f}" ;;
  *--single-transaction*)
    cat > "$TEST_SQL"
    case "$*" in *ON_ERROR_STOP=1*) ;; *) exit 9 ;; esac
    exit "${SQL_EXIT:-0}" ;;
  *) echo 1 ;;
esac
''')
        fake.chmod(0o700)
        self.env = dict(os.environ, PATH=str(self.root / 'bin') + ':' + os.environ['PATH'],
                        TEST_SQL=str(self.root / 'applied.sql'))
        self.signature = '12345:' + hashlib.sha256(self.sql.encode()).hexdigest()

    def run_init(self, **changes):
        return subprocess.run(['sh', str(self.root / 'init.sh')],
                              env=dict(self.env, **changes), capture_output=True, text=True)

    def test_fresh_then_redeploy_does_not_reapply(self):
        self.assertEqual(self.run_init().returncode, 0)
        self.assertEqual((self.root / 'state/schema.signature').read_text().strip(), self.signature)
        sql = (self.root / 'applied.sql').read_text()
        self.assertIn('pg_advisory_xact_lock', sql)
        self.assertIn('reload schema', sql)
        (self.root / 'applied.sql').unlink()
        self.assertEqual(self.run_init(HAS_SCHEMA='t').returncode, 0)
        self.assertFalse((self.root / 'applied.sql').exists())

    def test_existing_database_without_receipt_is_refused(self):
        self.assertNotEqual(self.run_init(HAS_SCHEMA='t').returncode, 0)
        self.assertFalse((self.root / 'applied.sql').exists())

    def test_sql_failure_has_no_success_receipt(self):
        self.assertNotEqual(self.run_init(SQL_EXIT='3').returncode, 0)
        self.assertFalse((self.root / 'state/schema.signature').exists())

    def test_different_version_or_cluster_is_refused(self):
        (self.root / 'state/schema.signature').write_text('other-cluster:other-version')
        self.assertNotEqual(self.run_init(HAS_SCHEMA='t').returncode, 0)
        self.assertFalse((self.root / 'applied.sql').exists())

    def test_missing_schema_with_receipt_is_refused(self):
        (self.root / 'state/schema.signature').write_text(self.signature)
        self.assertNotEqual(self.run_init().returncode, 0)

    def test_bootstrap_receipt_preserves_password(self):
        (self.root / 'state/schema.signature').write_text(self.signature)
        (self.root / 'state/owner.signature').write_text(self.signature)
        script = (ROOT / 'docker/easypanel/bootstrap.sh').read_text()
        script = script.replace('/state/', str(self.root / 'state') + '/')
        path = self.root / 'bootstrap.sh'
        path.write_text(script)
        fake = self.root / 'bin/node'
        fake.write_text('#!/bin/sh\nexit 99\n')
        fake.chmod(0o700)
        result = subprocess.run(['sh', str(path)], env=self.env, capture_output=True)
        self.assertEqual(result.returncode, 0)


if __name__ == '__main__':
    unittest.main()
