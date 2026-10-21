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
