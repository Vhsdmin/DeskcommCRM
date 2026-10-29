# VendePay CRM no EasyPanel com Supabase próprio

> **VendePay.** Este repositório é o CRM de Atendimento e CS da VendePay
> (base: `filipefagundes/VendePayCRM`), não o DeskcommCRM 1.50.0. O Compose usa as imagens publicadas pelo
> CI de `filipefagundes/VendePayCRM`, fixadas por digest, e o schema sai da
> mesma imagem do worker. Diferenças em relação ao texto abaixo:
>
> - **Branch do Deskcomm:** `main` (não `easypanel`). O Supabase
>   segue na branch `easypanel` do fork `Vhsdmin/supabase`.
> - **Imagens privadas no GHCR:** antes do deploy, a VPS precisa de
>   `docker login ghcr.io` com um token do GitHub de quem publica as imagens
>   (escopo `read:packages`), ou as imagens precisam ser tornadas públicas.
> - **E-mails do app:** com `SMTP_HOST` e `SMTP_FROM_EMAIL` preenchidos no
>   ambiente do CRM, convites e avisos saem pelo SMTP (ex.: Google Workspace:
>   `smtp.gmail.com`, 587, `starttls`, senha de app). Sem eles, saem pelo Resend
>   (`RESEND_API_KEY` e `RESEND_FROM_EMAIL`). A recuperação de senha sai pelo
>   SMTP do Supabase, configurado no ambiente do serviço do banco.
> - **Atualizar:** novas versões trocam os três digests juntos e exigem migração
>   controlada do banco (o inicializador só instala banco novo).

# Deskcomm no EasyPanel com Supabase próprio

Destino desta alteração: **infraestrutura** para instalação nova. É um Compose
independente; não altera o produto nem os instaladores existentes.

## Os dois serviços Compose

| Campo | Supabase | Deskcomm |
| --- | --- | --- |
| Repository | `https://github.com/Vhsdmin/supabase` | `https://github.com/Vhsdmin/DeskcommCRM` |
| Branch | `easypanel` | `main` |
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
git clone https://github.com/Vhsdmin/DeskcommCRM.git
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

## Atualização controlada: cadastro de equipe (0276–0280)

Este procedimento é exclusivo da produção VendePay que já roda o baseline da
`7580dd487` (checksum `94d3e8337ccf0bbe7fa5c861bdd197dabc4d3280afd53ae6cc06ab62e1fc9979`).
Não serve para bancos com outra origem, instalações sem recibos ou próximas
migrações. O script recusa esses cenários. O inicializador de banco novo mantém
suas proteções; nenhum baseline é reaplicado no banco existente.

### Caminho pelo painel, sem SSH

Para o projeto existente `crmvendepay`, com serviços `banco` e `crm`, há uma
stack de manutenção separada: `docker-compose.easypanel-upgrade.yml`. Ela usa
o mesmo volume de recibos do CRM e o mesmo banco na rede privada. Não instala
outro Supabase nem cria outro administrador.

1. No projeto `crmvendepay`, criar um serviço **Compose** chamado
   `atualizacao-equipe`. Configurar GitHub `Vhsdmin/DeskcommCRM`, branch `main`,
   Build Path `/` e Docker Compose File `docker-compose.easypanel-upgrade.yml`.
   Não criar domínio e não configurar encaminhamento para um serviço interno.
   Preparar a configuração sem clicar Implantar ainda.
2. Em **Ambiente** desse serviço, copiar **somente** a linha `POSTGRES_PASSWORD`
   já existente no serviço `banco` ou `crm`; manter exatamente o valor atual.
   Marcar **Create .env file**, se essa opção estiver disponível. Não gerar
   senha nova, JWT ou chave. A rede e o volume de recibos possuem os nomes
   padrão desta instalação; só precisam de ajuste se o projeto foi renomeado.
3. Reservar uma janela sem operações no CRM. No serviço **crm**, usar o botão
   **Parar** (quadrado ao lado de Implantar). Confirmar que app, worker e
   scheduler pararam. **Não parar o serviço banco.** Não implantar o CRM novo
   antes de concluir a manutenção.
4. No serviço **atualizacao-equipe**, clicar **Implantar**. Consultar o log de
   **equipe-upgrade**. A primeira tarefa, `schema-export`, copia o baseline da
   imagem revisada. A segunda confere o banco, salva o backup, aplica as cinco
   migrations em uma transação e atualiza os recibos. Ambas devem terminar com
   **Exited (0)**. A mensagem final esperada é:
   `Atualização 0276–0280 concluída. Backup preservado. Pode implantar o CRM no Easypanel.`
5. Só após esse sucesso, voltar ao serviço **crm** e clicar **Implantar**.
   Manter sua origem normal, `docker-compose.easypanel.yml`, e o domínio
   existente. Conferir `schema-init` e `bootstrap` sem erros, app saudável e
   acesso a Equipe no CRM. O serviço `banco` não precisa ser reimplantado.
6. Manter o serviço de manutenção e seu volume de backup preservados. Ele é
   uma tarefa que termina, não um serviço que deve ficar reiniciando. A cópia
   externa do backup está explicada abaixo; não excluir o serviço com seus
   volumes antes de guardar essa cópia segura.

O volume compartilhado esperado é `crmvendepay_crm_setup-state`. Se o painel
mostrar que ele não existe, parar e conferir o nome real do projeto Compose;
não criar um volume vazio para contornar o erro. Pode-se informar
`CRM_SETUP_STATE_VOLUME` com o nome existente, depois de verificado. O backup
usa `crmvendepay_crm_upgrade-backups`, e a rede é `crmvendepay_backend`.

Se qualquer tarefa falhar, manter o CRM parado e consultar o log; o script não
publica as imagens do app por conta própria. Não clicar repetidamente Implantar
no CRM, não apagar recibos e não zerar o banco.

### Preparação e publicação

1. Revisar e mesclar esta preparação na homologação. Promover o mesmo código
   para `Vhsdmin/DeskcommCRM`, mantendo `main` como origem do serviço no painel.
   Não clicar em **Implantar** ainda: o banco precisa da etapa manual abaixo.
2. O Compose deve usar os três digests revisados do commit do PR #9
   `c0ef438c2657126a2077317bbf3239db1278ec1c`. Para conferir/publicar o trio na
   preparação, usar `python3 docker/easypanel/preparar-imagens.py --commit
   c0ef438c2657126a2077317bbf3239db1278ec1c` em uma linha. Ele verifica o rótulo
   de procedência das três imagens antes de editar qualquer referência. Não
   usa `latest` na implantação. O script falha se `main` já apontar para outro
   commit: nesse caso a release precisa de nova revisão.
3. Guardar cópia segura do Environment atual dos dois serviços. Não regenerar
   segredos, alterar o Supabase, trocar domínio ou apagar volumes. Reservar uma
   janela sem operações no CRM. O banco e os serviços do Supabase permanecem
   ligados; app, worker e scheduler do CRM param durante a migração.
4. Acessar o **terminal do servidor** (SSH ou terminal do host disponibilizado
   pelo painel), com Docker Compose e acesso ao repositório. O terminal de
   dentro do app e o terminal do Mac não são esse terminal. Se não houver
   terminal do host no painel, o administrador da VPS deve executar esta etapa.

### Sincronizar o código, sem implantar

Na instalação desta conversa, a pasta e o projeto são:

```bash
cd /etc/easypanel/projects/crmvendepay/crm/code
git pull --ff-only origin main
sh docker/easypanel/atualizar-equipe.sh --check
```

Se a pasta tiver alterações locais, o pull deve ser interrompido e investigado;
não usar reset forçado. O projeto padrão é `crmvendepay_crm`. Para outro nome,
informar `COMPOSE_PROJECT_NAME` antes do comando. O wrapper lê também o
`docker-compose.override.yml` gerado pelo painel, quando existir. O check
consulta os recibos e o banco, mas não aplica migrations nem para a aplicação.
O Compose pode criar o serviço temporário e seu volume de backup vazio.

Se aparecer incompatibilidade de versão/cluster/recibos, **não contornar a
guarda**. Enviar o log sem Environment ou senhas e identificar a origem real.

### Executar na janela de manutenção

```bash
sh docker/easypanel/atualizar-equipe.sh --apply
```

O procedimento baixa as imagens e confere o baseline da imagem contra o código
antes de parar o CRM. Depois faz backup **do banco inteiro**, incluindo Auth e
Storage (metadados), em formato custom, mais as roles, os recibos anteriores e
checksums. Os arquivos físicos do Storage e do WhatsApp estão em volumes à
parte: este dump não os inclui nem os modifica.

O backup fica no volume `crmvendepay_crm_upgrade-backups`, em uma pasta cujo
nome aparece no log. Contém dados pessoais, hashes de senhas e credenciais de
roles; só o administrador deve acessá-lo. Não anexar o arquivo a PRs ou chats.
O catálogo do dump é validado, mas isso **não equivale a um ensaio de
restauração**. Para exigência de restauração ensaiada, fazer essa prova em
instância isolada antes da janela. Há espaço livre suficiente na VPS para
armazenar banco + backup? Conferir isso antes de executar.

Um manifesto de checksums congela o baseline e os cinco arquivos revisados;
arquivos alterados ou uma versão futura são recusados antes de qualquer backup.
As cinco migrations são aplicadas numa transação com parada em qualquer erro e
lock compartilhado com o inicializador. A verificação final confere a coluna de
acessos, a classificação de recursos e a ausência de policies nas quatro tabelas
só do servidor. Só após commit os recibos avançam. A senha do dono é preservada;
o bootstrap não volta a criar/redefinir o administrador.

Quando o log informar **Atualização 0276–0280 concluída**, clicar em
**Implantar** no serviço **CRM** do Easypanel. O serviço Supabase não precisa
ser reimplantado. `schema-init` deve reconhecer a nova versão e `bootstrap`
deve informar que as credenciais foram preservadas.

### Conferência e cópia do backup

Verificar app saudável, login do administrador, clientes e carteira anteriores,
Equipe → Novo usuário e Permissões. Criar apenas uma conta de teste autorizada;
conferir que entra sem e-mail e que uma área negada retorna acesso proibido.
Confirmar processamento do worker e chamadas do scheduler pelos logs do painel.

Para copiar o backup para a pasta do servidor (substituir `PASTA_DO_LOG` pelo
nome exibido; não usar um caminho inventado):

```bash
mkdir -m 700 -p /var/backups/vendepay
cd /etc/easypanel/projects/crmvendepay/crm/code
docker compose -p crmvendepay_crm -f docker-compose.easypanel.yml --profile maintenance run --rm --no-deps --volume /var/backups/vendepay:/dest --entrypoint /bin/sh equipe-upgrade -ec 'umask 077; cp -R /backups/PASTA_DO_LOG /dest/'
```

Copiar essa pasta também para armazenamento seguro fora da VPS. Não há retenção
automática nem exclusão de backups nesta atualização.

### Se falhar

- Falha no download, na origem ou no baseline: nenhum SQL aplicado. O wrapper
  confere essas etapas antes de parar o CRM.
- Falha no backup: migrations não começam e recibos continuam na origem.
- Falha no SQL: as cinco migrations revertem juntas; backup fica preservado.
  Não clicar Implantar com as imagens novas. Corrigir a causa pelos logs.
- Falha após o commit e antes de gravar recibos: manter a janela fechada e
  conferir banco, backup e recibos com o administrador. Não editar recibos
  manualmente nem remover lock sem confirmar que a execução anterior terminou.
- A reaplicação após sucesso reconhece o recibo e não repete migrations.
- Falha funcional após implantação: manter o CRM em manutenção para diagnóstico.
  Não existe downgrade automático. Voltar só a imagem não desfaz o banco.
  Restauração exige parar todos os escritores, usar o dump e recibos guardados,
  restaurar também a versão anterior do código/imagens e validar Auth e CRM.
  Deve ser ensaiada em instância isolada; não fornecer um `pg_restore --clean`
  genérico contra o Supabase de produção.

### Evidência desta preparação

Os testes Python de guardas usam dublês de Docker/Postgres e não acessam produção.
A execução real das cinco migrations já foi coberta pelo CI do PR #9; esta
preparação não substitui um teste de atualização/restauração de uma cópia da VPS.

Verificações locais desta preparação: 25 testes Python passaram, 41 testes de
fragmentos/empacotamento passaram, as provas shell de atualização passaram e os
dois Compose foram validados pelo Docker Compose 2.39.4 com ambientes
sintéticos. Os três digests foram consultados no GHCR e seus rótulos apontaram
para `c0ef438c2657126a2077317bbf3239db1278ec1c`; o workflow de imagens desse
commit concluiu com sucesso. Nada foi executado na VPS; dump e restauração real
continuam por executar na janela aprovada.

## Atualização da exclusão de clientes (até 0282)

O Compose desta versão fixa as três imagens do commit `6f94ae7bd` (PR #11).
O serviço de manutenção `atualizacao-equipe` conserva o nome no painel, mas passa
 a executar `docker/easypanel/atualizar-clientes-db.sh`. A identidade e os dados
 do Supabase existente são preservados.

O pacote aceita somente os recibos conhecidos de antes da equipe (baseline
`94d3e8337ccf0bbe7fa5c861bdd197dabc4d3280afd53ae6cc06ab62e1fc9979`)
ou depois da equipe até 0280 (`bea5c38fa23d82b3b3d709447f922b1d2e4e37b4eb0eaa0702e6f99e41e8c156`).
Na primeira origem aplica 0276–0282; na segunda, somente 0281–0282. Um recibo
incompatível é recusado antes de qualquer SQL. O manifesto `clientes-0282.sha256`
confere o baseline e cada migration; o baseline não é reaplicado.

No EasyPanel: parar o serviço CRM, manter o banco ligado, implantar a tarefa
`atualizacao-equipe` com o Git atualizado e o ambiente existente. O schema da
imagem deve ser idêntico ao código. O runner faz dump completo e guarda os
recibos no volume de backups antes da transação. Após a mensagem **Atualização
até 0282 concluída**, implantar o serviço CRM. A manutenção confirma RPC,
trigger e policy restritiva para DELETE antes de avançar os recibos. Não muda
senhas nem esvazia volumes. Se a manutenção falhar, conferir logs antes de
retomar a aplicação; não apagar recibos para contornar a recusa.

Alternativa no terminal do servidor, a partir do código desta release:

```bash
sh docker/easypanel/atualizar-clientes.sh --check
sh docker/easypanel/atualizar-clientes.sh --apply
```

O caminho do backup aparece no log como `/backups/clientes-0282-<data UTC>`.
O procedimento de cópia para fora do volume/VPS descrito acima continua válido.
O dump não inclui os arquivos físicos de WhatsApp/Storage. A leitura do catálogo
do backup não substitui um ensaio de restauração.

## Atualização do menu principal e da rolagem do CRM

O Compose fixa as três imagens do commit `5424a75b7` (PR #14 da VendePay).
A barra lateral segue a lista de trabalho do CS: Central de Prioridades, Agenda,
Funil, Clientes, Tarefas, Dashboard NPS, Assistente de IA, Desempenho, Atividades
e Configurações. O visual acompanha o Gestão, com fonte Open Sans, linhas de
48px e ícones de contorno. Configurações reúne os demais recursos visíveis,
organizados por assunto com título e descrição.

A faixa superior e o menu lateral permanecem parados; o conteúdo rola apenas
dentro do bloco branco. Avisos da instalação conservam seu espaço acima da
área de trabalho, sem fazer a casca ultrapassar a altura da janela.

Radar e Respostas rápidas ficam ocultos, assim como os menus ocultados na
atualização anterior. Papéis e seleções de interface por vínculo continuam
sendo respeitados. As permissões das páginas e o acesso direto por URL não mudam.

Esta atualização mantém o mesmo baseline de banco da versão até 0282. Para uma
instalação já atualizada até 0282, basta implantar o serviço CRM no EasyPanel
com a `main` atualizada e o ambiente existente; não é necessário executar a
tarefa de manutenção do banco por causa desta atualização de interface.
