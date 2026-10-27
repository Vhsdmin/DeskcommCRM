// Prova em DEV: migration, fixtures e DDL voltam por ROLLBACK mesmo em falha.
import pg from "pg";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const target = new URL(process.env.SUPABASE_DB_URL);
assert(
  target.hostname.includes("mypaqsvyygunlqnmpvfj") ||
    decodeURIComponent(target.username).includes("mypaqsvyygunlqnmpvfj"),
  "Development target required",
);
const db = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  connectionTimeoutMillis: 10000,
});
try {
  await db.connect();
  await db.query("begin");
  const migration = readFileSync(
    "supabase/migrations/20261027120000_0281_exclusao_atomica_cliente.sql",
    "utf8",
  );
  await db.query(migration);
  await db.query(migration); // idempotência
  const guard = readFileSync(
    "supabase/migrations/20261027130000_0282_exclusao_cliente_exige_papel.sql",
    "utf8",
  );
  await db.query(guard);
  await db.query(guard);
  await db.query(readFileSync("tests/fixtures/sql/contato-exclusao.sql", "utf8"));
  process.stdout.write(
    "PASS: exclusão CS, rollback com agenda, viewer, módulos, tenants e idempotência.\n",
  );
} catch (e) {
  process.stderr.write(`FAIL: ${e.code ?? ""} ${e.message}\n`);
  process.exitCode = 1;
} finally {
  await db.query("rollback").catch(() => {});
  await db.end();
}
