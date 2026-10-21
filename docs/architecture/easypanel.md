# Instalação opt-in no EasyPanel

Os dois Compose rodam no mesmo host. EasyPanel Domains encaminha HTTPS externo
para `api-gw:8000` no Supabase e `app:3000` no CRM.

Supabase cria a bridge `crmvendepay_backend`; somente `api-gw` (alias
`supabase-envoy`) e `db` (alias `supabase-db`) entram nela. No CRM, `app`,
`worker`, `schema-init` e `bootstrap` a consomem. WAHA, Redis e SRH continuam
na rede própria do CRM.

A inicialização é `schema-export → schema-init → bootstrap → app/worker`.
O export copia o baseline da mesma imagem de release do worker. O scheduler
espera app saudável e chama seus endpoints internos usando o segredo de cron.
Tarefas de setup terminam e deixam recibos em `setup-state`; serviços de runtime
reiniciam com `unless-stopped`. O painel expõe falhas de cada etapa nos logs.

Não há migração automática de banco existente nem agente de atualização SSH.
Campos e passos operacionais: [EASYPANEL.md](../../EASYPANEL.md).

A atualização de equipe possui uma porta manual separada: o terminal do host
chama `docker/easypanel/atualizar-equipe.sh`, que consulta o serviço opt-in
`equipe-upgrade`. Depois de conferir a origem e as imagens, para os escritores
do CRM; o serviço gera backup, aplica 0276–0280 em transação e avança os recibos.
A saída é o deploy explícito no painel; os logs e o backup são os artefatos para
o operador retomar uma falha. A recuperação não se faz apagando volumes.

O operador também pode usar apenas o painel: parar `crm` e implantar uma stack
Compose de manutenção com `docker-compose.easypanel-upgrade.yml`. A stack não
expõe domínio/porta e compartilha somente a rede do banco, os recibos existentes
e o backup dedicado. Seus serviços terminam com sucesso; o humano retoma pelo
botão Implantar do CRM depois da mensagem de conclusão. O banco continua ligado.
