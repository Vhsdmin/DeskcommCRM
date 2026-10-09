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

## Registro de relacionamento

A aba Histórico agora oferece Registrar atividade: Atendimento, Reunião, EBR e QBR; data/hora local convertida para UTC, resumo obrigatório e próximos passos opcionais. O autor vem da sessão autenticada. Próximos passos são anotações: tarefas com prazo continuam na aba Tarefas.

Reutiliza `crm_lead_activities`, com lead opcional e contato obrigatório quando não há lead. As migrations 0261 e 0262 foram aplicadas no desenvolvimento e verificadas duas vezes para idempotência. O controle de visibilidade dos leads existentes foi preservado; atividades sem lead usam o acesso ao contato. API exige papel agent e organização ativa, recusa cliente anonimizado/mesclado e registra auditoria sem copiar o conteúdo do atendimento.

Verificado pela interface: QBR fictício criado no Cliente de teste CS, lido no histórico após recarregar, com autoria e próximos passos. `tests/vendepay/atividades-rls.mjs` testa o acesso ao próprio histórico e a recusa de gravações em outra organização, por viewer e em contato anonimizado, revertendo todas as fixtures em transação. A suíte Docker do banco não pôde rodar porque Docker não está instalado.

Verificação final do registro: build de produção passou; typecheck passou; lint completo terminou sem erros, com 356 avisos existentes; lint de canais e de hierarquia de papéis passou; 40 testes relacionados passaram. A suíte completa rodou com 895 arquivos: 888 passaram e 7 falharam. A falha introduzida pela ordem do apêndice no baseline foi corrigida (varredura de anon permanece por último) e seu arquivo passou no novo teste dirigido. As outras falhas foram em notificações/tema e importação de leads, áreas não alteradas nesta etapa. Não foi possível executar a suíte completa de invariantes Docker. Nenhuma alteração foi publicada na instalação oficial.

### Correções de atividades (09/10/2026)
- Histórico permite editar tipo, data, resumo e próximos passos dos registros manuais de CS sem lead.
- Autor pode corrigir seus registros; manager/admin pode corrigir os da equipe. Modo de acompanhamento somente leitura não permite alterações.
- Exclusão pede confirmação e é lógica: registro preservado, oculto do histórico e com auditoria. Não há interface de restauração nesta etapa.
- Revisão impede sobrescrever silenciosamente uma alteração concorrente. Organização, cliente e autoria são validados no servidor e no banco.
- Migrações 0263–0265 aplicadas somente ao Supabase de desenvolvimento. A função restrita de exclusão preserva a política que oculta registros excluídos.
- Atalho Marcar compromisso reutiliza a agenda nativa e pré-seleciona o cliente. A agenda ainda precisa de horários de atendimento publicados; sincronização Google não configurada no desenvolvimento.
- Validação: edição e exclusão de registro descartável pela interface; testes de rota e RLS em transação com rollback, TypeScript e lint dos arquivos alterados.
