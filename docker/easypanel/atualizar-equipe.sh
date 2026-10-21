#!/bin/sh
# Rodar no terminal DO SERVIDOR, na pasta do código sincronizado pelo Easypanel.
set -eu
mode=${1:---check}
case "$mode" in --check|--apply) ;; *) echo 'Use --check ou --apply.' >&2; exit 2;; esac
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$root"
project=${COMPOSE_PROJECT_NAME:-crmvendepay_crm}
compose() {
  if [ -f docker-compose.override.yml ]; then
    docker compose -p "$project" -f docker-compose.easypanel.yml -f docker-compose.override.yml "$@"
  else
    docker compose -p "$project" -f docker-compose.easypanel.yml "$@"
  fi
}
docker info >/dev/null 2>&1 || { echo 'Abra o terminal do servidor com acesso ao Docker (não o terminal do app nem do Mac).' >&2; exit 1; }
compose --profile maintenance config --quiet
[ -n "$(compose ps --all -q app)" ] || { echo 'App não encontrado neste projeto. Confira COMPOSE_PROJECT_NAME; nada foi parado.' >&2; exit 1; }
compose --profile maintenance run --rm --no-deps equipe-upgrade --check
[ "$mode" = --apply ] || exit 0
# Baixa tudo ANTES da janela de manutenção; não troca a aplicação em execução.
compose --profile maintenance pull app worker scheduler schema-export bootstrap equipe-upgrade
compose run --rm --no-deps schema-export
compose --profile maintenance run --rm --no-deps equipe-upgrade --check-image
compose stop scheduler worker app
# Em caso de falha os serviços ficam parados para inspeção; não publica estado incerto.
compose --profile maintenance run --rm --no-deps equipe-upgrade --apply
echo 'Banco pronto. No Easypanel, clique Implantar no serviço CRM e confira os logs e o login.'
