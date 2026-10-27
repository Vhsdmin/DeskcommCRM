"""Pacote 0282: origens fechadas, backup antes do SQL e recibos preservados."""
import hashlib
from pathlib import Path
import test_upgrade as original

ROOT = Path(__file__).resolve().parents[2]
MID = 'bea5c38fa23d82b3b3d709447f922b1d2e4e37b4eb0eaa0702e6f99e41e8c156'

class ClientesUpgradeTests(original.UpgradeTests):
    def setUp(self):
        super().setUp()
        for n,stamp in [(281,'20261027120000'),(282,'20261027130000')]:
            (self.root/'release/migrations'/f'{stamp}_{n:04}_test.sql').write_text(f'select {n};\n')
        (self.root/'setup/clientes-0282.sha256').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.relative_to(self.root/'release').as_posix()+'\n' for p in (self.root/'release').rglob('*.sql')))
        script=(ROOT/'docker/easypanel/atualizar-clientes-db.sh').read_text()
        for part in ['state','schema','release','backups','setup']:
            script=script.replace('/'+part+'/',str(self.root/part)+'/')
        script=script.replace('cd /release ','cd '+str(self.root/'release')+' ')
        self.script.write_text(script)

    def test_busy_lock_refused(self):
        (self.root/'state/clientes-upgrade.lock').mkdir()
        self.assertNotEqual(self.run_upgrade().returncode,0)
        self.assertFalse(self.calls.exists())

    def test_after_0280_only_applies_0281_and_0282(self):
        for name in ['schema.signature','owner.signature']:
            (self.root/'state'/name).write_text('12345:'+MID)
        result=self.run_upgrade()
        self.assertEqual(result.returncode,0,result.stderr)
        sql=next((self.root/'backups').glob('*/aplicar.sql')).read_text()
        self.assertIn('select 281;',sql)
        self.assertIn('select 282;',sql)
        self.assertNotIn('select 276;',sql)
        self.assertEqual(self.receipt(),self.new)
        self.assertEqual((self.root/'state/clientes-0282.complete').read_text().strip(),self.new)

    def test_legacy_applies_all_seven_and_checks_database_guards(self):
        result=self.run_upgrade()
        self.assertEqual(result.returncode,0,result.stderr)
        sql=next((self.root/'backups').glob('*/aplicar.sql')).read_text()
        for n in range(276,283):
            self.assertIn(f'select {n};',sql)
        self.assertIn('contacts_agent_delete_guard',sql)
        self.assertIn('fn_delete_contact(uuid,uuid)',sql)
        self.assertIn('trg_limpar_atividades_do_cliente_excluido',sql)

    def test_current_schema_without_completion_receipt_refused(self):
        for name in ['schema.signature','owner.signature']:
            (self.root/'state'/name).write_text(self.new)
        self.assertNotEqual(self.run_upgrade().returncode,0)
        self.assertFalse(self.calls.exists())
