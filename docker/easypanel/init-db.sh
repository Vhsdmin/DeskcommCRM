#!/bin/sh
# Inicialização de banco NOVO. Não é um runner de atualização de schema.
set -eu
attempt=0
until psql -X -qAtc 'select 1' >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    echo 'Banco indisponível: confira o deploy do Supabase, a rede privada e POSTGRES_PASSWORD.' >&2
    exit 1
  fi
  sleep 2
done

cluster=$(psql -X -qAtc 'select system_identifier from pg_control_system()')
checksum=$(sha256sum /schema/baseline.sql | cut -d ' ' -f 1)
signature="$cluster:$checksum"
exists=$(psql -X -qAtc "select to_regclass('public.organizations') is not null")

if [ -f /state/schema.signature ]; then
  if [ "$(cat /state/schema.signature)" = "$signature" ] && [ "$exists" = t ]; then
    echo 'Schema já inicializado para esta versão e este banco.'
    exit 0
  fi
  echo 'Banco ou versão mudou. Recusando atualização automática; faça backup e migração controlada.' >&2
  exit 1
fi
if [ "$exists" = t ]; then
  echo 'Há um CRM neste banco sem recibo desta instalação. Não vou reaplicar o baseline automaticamente.' >&2
  exit 1
fi

# A transação evita deixar o banco parcialmente inicializado se qualquer SQL falhar.
# O lock também serializa duas tentativas simultâneas de inicialização.
psql -X -q -v ON_ERROR_STOP=1 --single-transaction <<'SQL'
select pg_advisory_xact_lock(647391020);
do $$ begin
  if to_regclass('public.organizations') is not null then
    raise exception 'O banco já foi inicializado por outra execução';
  end if;
end $$;
create extension if not exists vector with schema public;
create extension if not exists citext with schema public;
create extension if not exists pg_trgm with schema public;
\i /schema/baseline.sql
notify pgrst, 'reload schema';
SQL
printf '%s\n' "$signature" > /state/schema.signature.tmp
mv /state/schema.signature.tmp /state/schema.signature
echo 'Schema inicializado. O bootstrap do administrador pode começar.'
