# VendePay CRM no EasyPanel com Supabase próprio

> **VendePay.** Esta branch (`vendepay-producao`) é o CRM de Atendimento e CS da
> VendePay, não o DeskcommCRM 1.50.0. O Compose usa as imagens publicadas pelo
> CI de `filipefagundes/VendePayCRM`, fixadas por digest, e o schema sai da
> mesma imagem do worker. Diferenças em relação ao texto abaixo:
>
> - **Branch do Deskcomm:** `vendepay-producao` (não `easypanel`). O Supabase
>   segue na branch `easypanel` do fork `Vhsdmin/supabase`.
> - **Imagens privadas no GHCR:** antes do deploy, a VPS precisa de
>   `docker login ghcr.io` com um token do GitHub de quem publica as imagens
>   (escopo `read:packages`), ou as imagens precisam ser tornadas públicas.
> - **E-mails do app:** esta versão envia pelo Resend (`RESEND_API_KEY` e
>   `RESEND_FROM_EMAIL`); os campos `SMTP_*` do CRM gerados abaixo são ignorados.
>   O SMTP do Supabase (convite e recuperação de senha) continua valendo.
> - **Atualizar:** novas versões trocam os três digests juntos e exigem migração
>   controlada do banco (o inicializador só instala banco novo).

# Deskcomm no EasyPanel com Supabase próprio

Destino desta alteração: **infraestrutura** para instalação nova. É um Compose
independente; não altera o produto nem os instaladores existentes.

## Os dois serviços Compose

| Campo | Supabase | Deskcomm |
| --- | --- | --- |
| Repository | `https://github.com/Vhsdmin/supabase` | `https://github.com/Vhsdmin/DeskcommCRM` |
| Branch | `easypanel` | `vendepay-producao` |
| Build Path | `/docker` | `/` |
| Docker Compose File | `docker-compose.easypanel.yml` | `docker-compose.easypanel.yml` |
| Serviço do domínio | `api-gw` | `app` |
| Porta interna | `8000` | `3000` |
| Protocolo interno | HTTP | HTTP |

Use HTTPS externo nos dois domínios. **Suba o Supabase primeiro.** Ele cria a
rede privada `crmvendepay_backend`, que este Compose usa. Não é necessário abrir
Postgres à internet nem criar manualmente a rede. Os dois serviços Compose
precisam estar no mesmo servidor Docker.

O `app` que já foi criado como serviço App no painel não vira uma stack completa
só por trocar o repositório. Crie um serviço **Compose** para este arquivo
(por exemplo, `deskcomm`). Transfira o domínio do serviço App antigo para o
Compose, apontando ao serviço interno `app:3000`. Remova a rota antiga antes de
atribuir o mesmo host à nova, para não ter dois destinos concorrentes.

## Gerar os dois ambientes uma vez

No computador, com Git e Python 3, clone os forks lado a lado:

```bash
git clone -b easypanel https://github.com/Vhsdmin/supabase.git
git clone -b vendepay-producao https://github.com/Vhsdmin/DeskcommCRM.git
cd supabase/docker
python3 generate-easypanel-env.py
cd ../../DeskcommCRM
python3 docker/easypanel/gerar-env.py --supabase-env ../supabase/docker/.env
```

No Windows, substitua `python3` por `py`. O segundo comando pergunta o e-mail
do administrador. Ele gera uma senha forte em `OWNER_PASSWORD` no `.env` do CRM.
Nenhum dos scripts imprime segredos. O `.env` do Supabase e o `.env` do CRM são
arquivos DIFERENTES: cole cada um no **Environment** do Compose correspondente,
substituindo o conteúdo antigo e marcando **Create .env file**. Guarde cópias
seguras e não publique esses arquivos no GitHub. Não regenere chaves depois do
primeiro deploy; os scripts recusam sobrescrever `.env` existente.

As URLs estão preenchidas com os hosts enviados nesta instalação. Confira-as
antes de gerar o ambiente do CRM. Se mudarem, ajuste ambos os ambientes no painel.
`SINGLE_SERVER_NETWORK` deve ser igual nos dois.

Sem Python, os templates e scripts continuam sendo referência para os campos,
mas ANON_KEY e SERVICE_ROLE_KEY precisam ser JWTs assinados com JWT_SECRET;
não substitua essas duas chaves por strings aleatórias.

## Deploy e primeiro login

1. Faça deploy do Supabase com seu ambiente e domínio configurados.
2. Faça deploy deste Compose com o ambiente do CRM.
3. Acompanhe `schema-export`, `schema-init` e `bootstrap` nos logs do painel.
4. Os três serviços de preparação devem terminar com **Exited (0)**. Isso é
   sucesso, não falha: são tarefas de execução única. `app`, `worker`,
   `scheduler`, `waha`, `redis` e `srh` ficam rodando.
5. Abra `https://crmvendepay-app.f8zify.easypanel.host` e use `OWNER_EMAIL` e
   `OWNER_PASSWORD` do ambiente gerado. Conclua o onboarding e cadastre a IA
   pela tela quando quiser.

O schema é copiado da imagem do worker (mesmo commit de app e scheduler), em
vez do baseline da branch. As três imagens foram
consultadas no GHCR antes da publicação deste Compose. Não há `build:` no
arquivo, pois o EasyPanel usa `up --build` e isso reconstruiria serviços que
tivessem uma seção de build.

O inicializador espera o banco, aplica o baseline com `ON_ERROR_STOP=1` em
transação e registra a identidade do cluster e o checksum do schema no volume
`setup-state`. Um banco já existente sem esse recibo é recusado, não assumido.
O bootstrap reutiliza `scripts/bootstrap-owner.ts` da imagem e guarda seu
recibo, evitando redefinir a senha a cada deploy. Não apague `setup-state`.

## Configuração e limites

- **SMTP:** preencha SMTP no Supabase para os e-mails de Auth e no CRM para
  os e-mails do app. Os campos diferem: Supabase usa `SMTP_USER`/`SMTP_PASS`;
  CRM usa `SMTP_USERNAME`/`SMTP_PASSWORD`. Sem isso, convite e recuperação de
  senha não estão prontos. O primeiro dono é criado com e-mail já confirmado.
- **IA:** Anthropic, OpenAI e OpenRouter continuam opcionais. Sentry fica
  desabilitado no ambiente gerado. Não precisa contratar Supabase Cloud ou Upstash.
- **WhatsApp:** WAHA Core fica na rede do CRM, sem dashboard público. O modo
  padrão do projeto não exige assinatura HMAC porque o Core dessa versão não a
  envia; os endpoints do WAHA não são publicados neste Compose.
- **Banco:** como o instalador single-server original, este caminho usa a
  conexão `postgres` na rede privada. `SUPABASE_DB_ADMIN_URL` e campos de setup
  são neutralizados no ambiente do app/worker. A conexão de runtime ainda é
  privilegiada; esta alteração não implementa uma role de banco com privilégios reduzidos.
- **Recursos opcionais:** este arquivo cobre o CRM e WhatsApp por mensagens.
  Os profiles de telefonia SIP e chamadas de voz do Compose original não são
  incluídos. O Compose original continua disponível para essas instalações.
- **Atualizações:** esta instalação fica nos digests do Compose. Não troque tags de
  imagem nem habilite o atualizador do instalador SSH por conta própria: ele
  opera outros arquivos de Compose. Atualizar exige backup, migração do banco
  e mudança coordenada das imagens; o inicializador recusa mudança de versão.
- **Dados existentes:** não é migração automática. O Supabase usa volumes
  nomeados novos e não importa o bind mount anterior. Não use `down -v`.

## Verificação

CONFIRMADO por configuração: sem nomes globais de containers, sem portas no
host, gateway/DB em rede compartilhada, scheduler usando o mesmo segredo de
cron que o app, imagem/schema da mesma release e credenciais de setup fora do
ambiente de runtime (a conexão Postgres do runtime é descrita acima).

Validação local do Compose (não imprime os valores):

```bash
docker compose -f docker-compose.easypanel.yml --env-file .env config --quiet
```

Não confunda config válido com deploy provado: banco real, inicialização do
schema, login, e-mails e pareamento WhatsApp precisam ser conferidos na VPS.

## Checklist operacional

Entrada: Git + Environment do EasyPanel. Saída: schema-init → bootstrap →
app/worker → scheduler. Registros: logs desses serviços na tela do EasyPanel.
Configuração e acesso: Source, Environment e Domains do painel. Falha de setup
impede app/worker de iniciar; corrigir a configuração e clicar Deploy reexecuta
as tarefas sem redefinir um dono já configurado. A continuidade IA/humano é a
do CRM existente, sem alteração neste empacotamento. O mapa da ligação está em
`docs/architecture/easypanel.md`.

### Resultado das verificações desta alteração

- Docker Compose 2.39.4 resolveu os dois arquivos com ambientes descartáveis;
  mounts, rede compartilhada, JWTs, hash WAHA e segredos Redis/cron conferidos.
- `python3 tests/easypanel/test_init.py`: seis casos passaram (guardas de
  instalação, falha do SQL, reaplicação e preservação da senha, usando psql dublê).
- Teste de integração de configuração reproduzível:
  `python3 tests/easypanel/validate.py --supabase-repo ../supabase --compose-bin /caminho/docker-compose`.
- A suíte shell existente foi tentada, mas parou em um caso de
  `colisao-de-migration.test.sh` (ref de rodada concorrente), fora dos arquivos
  alterados. Ela não ficou inteiramente verde.
- Typecheck esgotou o heap do Node; lint não iniciou por falta de
  `@next/eslint-plugin-next` na instalação local de dependências. Não há
  alterações de código TypeScript nesta entrega.
- Sem daemon Docker nesta sessão: não foi executado o baseline em PostgreSQL
  real, nem bootstrap/login na VPS. Esses testes continuam pendentes no deploy.
