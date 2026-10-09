# Adaptação do CRM existente para VendePay

A implementação segue as telas existentes de DeskcommCRM. A área separada `/app/cs` e a prévia `/cs-preview` foram retiradas, inclusive a exceção de autenticação local.

## Primeira adaptação

- Contatos passa a ser apresentado como Clientes, mantendo `/app/contacts`, APIs, permissões, componentes e persistência existentes.
- Busca continua restrita ao banco do CRM enquanto não houver conexão com Gestão. A interface informa essa condição explicitamente.
- Detalhe do cliente mantém Visão geral, Histórico e LGPD; adiciona Tarefas usando `TarefasClient`, `FormularioDeTarefa` e `ListaDeTarefas` já existentes.
- Consulta de tarefas é filtrada por `contact_id`; a criação mantém esse vínculo. A lista geral de tarefas continua disponível.
- Dados do Gestão tem estado de conexão pendente. Nenhum dado cadastral/financeiro real é simulado nem duplicado.
- Sem novas tabelas, migrations ou fórmulas de saúde nesta etapa.

## Próximas adaptações

1. Registro unificado de atendimentos/reuniões e próximos passos no detalhe do cliente, sem exigir lead comercial. Avaliar mudança de schema, políticas de acesso e histórico antes de liberar.
2. Adaptar agenda existente para EBR/QBR.
3. Preparar busca e detalhe do usuário do Gestão conforme documentação oficial de API, usando o ID de origem. Gestão continua sendo a fonte dos dados cadastrais e financeiros.
4. Reorganizar Receber dados e Leads recebidos para integrações e entrada de clientes.
5. Adaptar desempenho, NPS, jornadas e alertas com regras definidas pelo time.
6. Retirar os menus comerciais dispensáveis após mapear dependências.

## Banco de desenvolvimento

Projeto `mypaqsvyygunlqnmpvfj`: baseline existente instalado, 129 tabelas públicas. Usuário de teste e organização VendePay configurados; login e acesso à organização via RLS verificados. Credenciais ficam somente em `.env.local`, ignorado pelo Git.

## Verificação desta etapa

Typecheck e lint dos arquivos alterados sem erros. Testes de navegação, tradução e segurança da API de tarefas passaram (57 testes). Dois testes adicionais verificam o filtro por cliente, vínculo obrigatório na criação dentro do detalhe e manutenção da lista geral/visualização sem edição.

Validação pela interface autenticada: criado `Cliente de teste CS` com endereço fictício `cliente-cs@example.invalid`; registrada tarefa `Teste CS: preparar pauta do QBR` na aba Tarefas. A tarefa permaneceu após recarregar a página. Os dois registros foram mantidos no banco de desenvolvimento como exemplos de teste. Evidência em `vendepay-clientes-tarefas.jpg`.
