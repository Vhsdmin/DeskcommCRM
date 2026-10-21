#!/bin/sh
# Executado somente pelo serviço manual equipe-upgrade, com PostgreSQL 17.
set -eu
umask 077
mode=${1:---check}
case "$mode" in --check|--check-image|--apply) ;; *) echo 'Use --check ou --apply.' >&2; exit 2;; esac
fail() { echo "$*" >&2; exit 1; }
# Baseline da versão de produção 7580dd487, antes do PR #9.
previous=94d3e8337ccf0bbe7fa5c861bdd197dabc4d3280afd53ae6cc06ab62e1fc9979
test -s /release/baseline.sql || fail 'Baseline alvo ausente.'
(cd /release && sha256sum -c /setup/equipe-0280.sha256) >/dev/null || fail 'Código fora do pacote revisado 0276–0280.'
cluster=$(psql -X -qAt -v ON_ERROR_STOP=1 -c 'select system_identifier from pg_control_system()')
target=$(sha256sum /release/baseline.sql | cut -d ' ' -f 1)
old="$cluster:$previous"
new="$cluster:$target"
test -s /state/schema.signature || fail 'Recibo da instalação ausente; atualização recusada.'
test -s /state/owner.signature || fail 'Recibo do administrador ausente; atualização recusada.'
receipt=$(cat /state/schema.signature)
if [ "$receipt" = "$new" ]; then
  test -s /state/equipe-0280.complete || fail 'Versão alvo sem recibo da atualização controlada.'
  test "$(cat /state/equipe-0280.complete)" = "$new" || fail 'Recibo de atualização incompatível.'
  echo 'Atualização 0276–0280 já concluída. Nenhum SQL reaplicado.'
  exit 0
fi
[ "$receipt" = "$old" ] || fail 'Banco ou versão de origem incompatível. Nada foi alterado.'
owner=$(cat /state/owner.signature)
[ "$owner" = "$old" ] || [ "$owner" = "$new" ] || fail 'Recibos de schema e administrador divergem.'
[ "$(psql -X -qAt -v ON_ERROR_STOP=1 -c "select to_regclass('public.cs_playbooks') is not null")" = t ] || fail 'Schema de origem incompleto.'
for prefix in 20261021120000_0276 20261021130000_0277 20261021140000_0278 20261021150000_0279 20261021160000_0280; do
  # A lista é fechada: não aplica migrations futuras por acidente.
  set -- /release/migrations/"$prefix"_*.sql
  [ "$#" = 1 ] && test -s "$1" || fail "Migration ausente ou ambígua: $prefix"
done
if [ "$mode" = --check-image ]; then
  cmp -s /schema/baseline.sql /release/baseline.sql || fail 'Imagem do worker e código não são da mesma versão.'
fi
if [ "$mode" != --apply ]; then
  echo 'Origem e cinco migrations conferidas. Este comando não aplica SQL nem troca recibos.'
  exit 0
fi
cmp -s /schema/baseline.sql /release/baseline.sql || fail 'Imagem do worker e código não são da mesma versão.'
mkdir /state/equipe-upgrade.lock 2>/dev/null || fail 'Atualização em andamento ou lock de execução interrompida. Consulte os logs antes de remover o lock.'
trap 'rmdir /state/equipe-upgrade.lock' EXIT
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup=/backups/equipe-0280-$stamp
mkdir "$backup"
cp /state/schema.signature "$backup/schema.signature"
cp /state/owner.signature "$backup/owner.signature"
# Banco inteiro: inclui public, auth e storage. As roles são guardadas à parte.
pg_dump --format=custom --file="$backup/postgres.dump"
pg_dumpall --globals-only --file="$backup/globals.sql"
test -s "$backup/postgres.dump" || fail 'Backup vazio.'
pg_restore --list "$backup/postgres.dump" > "$backup/conteudo.txt"
sha256sum "$backup/postgres.dump" "$backup/globals.sql" > "$backup/SHA256SUMS"
printf '%s\n' "$new" > "$backup/alvo.signature"
echo "Backup criado: $backup. O catálogo do arquivo foi lido; restauração ainda não ensaiada."
# Todas as mudanças são atômicas. Uma falha reverte as cinco migrations.
{
  echo "select pg_advisory_xact_lock(647391020);"
  for prefix in 20261021120000_0276 20261021130000_0277 20261021140000_0278 20261021150000_0279 20261021160000_0280; do
    cat /release/migrations/"$prefix"_*.sql
    printf '\n'
  done
  cat <<'SQL'
do $$ begin
  if to_regclass('public.acesso_modulo_recursos') is null
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='user_organizations' and column_name='module_access') then
    raise exception 'Verificação final da atualização falhou';
  end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename in ('gestao_connections','ad_insights_connections','ad_platform_connections','ad_conversion_dispatches')) then
    raise exception 'Tabela de credenciais com policy inesperada';
  end if;
end $$;
notify pgrst, 'reload schema';
SQL
} > "$backup/aplicar.sql"
psql -X -v ON_ERROR_STOP=1 --single-transaction --file="$backup/aplicar.sql"
# Nunca muda a senha do dono. Os recibos acompanham o schema migrado.
printf '%s\n' "$new" > /state/equipe-0280.complete.tmp
mv /state/equipe-0280.complete.tmp /state/equipe-0280.complete
printf '%s\n' "$new" > /state/owner.signature.tmp
mv /state/owner.signature.tmp /state/owner.signature
printf '%s\n' "$new" > /state/schema.signature.tmp
mv /state/schema.signature.tmp /state/schema.signature
echo 'Atualização 0276–0280 concluída. Backup preservado. Pode implantar o CRM no Easypanel.'
