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

### Agenda CS — EBR e QBR (09/10/2026)
- Adaptada a configuração existente de tipos de agendamento, com modelos editáveis: EBR 30 minutos, QBR 60 minutos, categoria reunião, responsável inicial quem está criando e local link de vídeo.
- Criar continua passando pela API nativa, suas permissões e auditoria. Os tipos foram criados no desenvolvimento pela interface. Não liga lembretes automaticamente.
- Agenda oferece acesso a Tipos de agendamento; Histórico do cliente continua abrindo a marcação com cliente pré-selecionado.
- Diagnóstico: não havia disponibilidade em attendant_availability para o responsável. O aviso agora mostra a orientação de configuração recebida em respostas 422, sem expor erros internos do banco.
- Usuário escolheu definir horários manualmente. Disponibilidade permanece sem configuração; nenhuma reunião foi marcada nesta etapa. Para liberar horários: Equipe → Atendimento → Horários de atendimento → escolher dias, janelas e fuso → salvar.
- Validação: criação EBR/QBR pela interface, presença dos tipos no diálogo de marcação e cliente vinculado; 90 testes direcionados, TypeScript sem erros e lint sem erros (avisos preexistentes). Sem prova de agendamento completo até a publicação manual dos horários. Não houve alteração de schema nesta etapa.

### Prova de agendamento completo (09/10/2026)
- Horários publicados pelo usuário: segunda a sexta, 08h–18h, America/Sao_Paulo.
- QBR de teste marcada pela interface para 13/10/2026, 10h–11h. Confirmada na agenda, com os blocos ocupados.
- A prova identificou uma dependência comercial: o handler só emitia histórico quando havia lead aberto. Corrigido para ancorar no contato quando não houver lead, usando a mesma tabela, autor e isolamento existentes. Agendamento sem contato continua sem inventar atividade; com lead mantém vínculo original.
- EBR de teste marcada após a correção para 14/10/2026, 10h–10h30; atividade automática visível no Histórico e botão Ver agendamento leva à agenda nativa.
- Registros de agendamento são alterados/remarcados/cancelados pela agenda; edição/exclusão do Histórico continua exclusiva para os registros manuais de CS.
- Os dois compromissos são do Cliente de teste CS e não enviaram convites por e-mail. A QBR anterior à correção não recebeu backfill do evento de criação.
- Testes direcionados do handler, transições, vínculos e eixo da timeline; TypeScript e lint dos arquivos alterados. Sem alteração de schema.

### Jornada interna de CS (09/10/2026)
- Na Visão geral do cliente existente: fase manual Entrada, Onboarding, Ativação, Adoção, Expansão ou Renovação; responsável ativo da equipe. Não definida/Sem responsável são estados explícitos, sem atribuição automática.
- Gestor/admin pode atribuir ou retirar responsáveis; agente pode assumir para si e editar fase, preservando responsável atual. Viewer e acompanhamento somente leitura não podem gravar. Esta atribuição interna não calcula carteira financeira: a regra de GMV acumulado aguarda a conexão Gestão.
- Entrada: edição na ficha → PATCH /api/v1/contacts/[id]/journey → RPC fn_update_contact_cs com organização da sessão e RLS. Saídas: campos no contato → JornadaDoCliente; atividade customer_journey_updated → TimelineView; Ver próximas tarefas → aba Tarefas existente.
- Fase anterior e nova ficam visíveis no Histórico; troca de responsável é sinalizada, com IDs anterior/novo preservados no payload e auditoria. Revisão recusa sobrescrita concorrente. Gravação do estado e da atividade é uma única transação. Alterar de novo corrige a decisão e preserva a sequência de mudanças.
- Configuração pela própria ficha; falhas da equipe impedem salvar e oferecem nova tentativa. Próximos passos usam tarefas com prazo existentes; não são geradas tarefas nem alertas automaticamente. IA ainda não consome essa jornada: integração futura declarada.
- Migrações 0266 e 0267 aplicadas somente ao DEV. A segunda incorpora as seis fases definidas pelo usuário após a primeira validação. Não há nova entidade Conta VendePay nem conexão de produção.
- Prova: cliente fictício com Entrada e Filipe como responsável, persistência após recarregar, edição de fase, Histórico e atalho Tarefas. Evidência docs/vendepay-jornada-cliente.jpg. Testes: 31 casos direcionados (rotas, atividades, agenda, manifesto e varredura anon); build de produção, TypeScript e lint dos arquivos alterados sem erros. Lint de canais e hierarquia de papéis passou. tests/vendepay/jornada-rls.mjs valida idempotência, tenant, permissões, revisão, no-op, preservação de campos e histórico no PostgreSQL DEV com rollback. Suíte de invariantes Docker não executada: Docker indisponível.

### Funil vinculado à jornada (09/10/2026)
- O funil padrão existente Jornada VendePay, no mesmo endereço e menu Funis, passa a mostrar os contatos nas fases Entrada, Onboarding, Ativação, Adoção, Expansão e Renovação. Os demais funis mantêm o quadro existente; trocar o funil padrão transfere a visualização de CS para ele.
- Arestas: contacts.cs_phase → GET /api/v1/pipelines/[id]/journey → JornadaCSBoard; seletor no card → PATCH da jornada → fn_update_contact_cs → ficha, Histórico e auditoria. Abrir ficha permite consultar e registrar atendimentos, tarefas e agenda.
- Fonte única é a fase no contato. Não cria negócio comercial ou uma conta duplicada. Clientes sem fase, mesclados ou anonimizados não aparecem; atribuir fase pela ficha inclui o cliente. Retirar fase remove do quadro, mantendo histórico.
- Organização vem da sessão, funil deve pertencer à organização e ser padrão/ativo; contatos consultados via RLS e filtro explícito. Somente leitura/viewer vê cards e ficha, sem controles de alteração.
- Preserva responsável e envia revisão atual ao mover; conflito recarrega quadro e mostra recusa. Atualização após gravação, ao voltar à janela e a cada 15 segundos; botão Atualizar disponível. Páginas de 100 com Carregar mais clientes e total explícito; contagens por coluna correspondem aos clientes carregados.
- Prova no DEV: cliente fictício em Entrada, movido para Onboarding pelo card, ficha e Histórico atualizados, retorno para Entrada pela ficha refletido no quadro. Evidência docs/vendepay-funil-jornada.jpg. Não houve alteração de schema.
- IA/alertas automáticos não consomem esse quadro ainda; próximo passo em definição: NPS manual ou link de pesquisa. Nenhum envio externo foi realizado.
- Validação desta integração: 14 testes dirigidos, TypeScript, lint dos arquivos alterados, lint de canais/papéis e build de produção passaram. Sabotagem após commit: retirar o desempacotamento do envelope REST derrubou os 3 testes de tela previstos; código restaurado e os 3 passaram. Suíte completa Docker/E2E de banco fresco não executada nesta etapa; prova de interface no DEV autenticado.

### Pesquisa NPS tradicional (09/10/2026)
- Aba NPS na ficha existente. Pergunta de recomendação de 0 a 10, comentário opcional até 2.000 caracteres; 0–6 detrator, 7–8 neutro, 9–10 promotor. Lista mostra até as últimas 100 pesquisas com datas, estado, nota e comentário. Ainda não há indicador NPS agregado por carteira/período.
- Gerar link cria convite individual de 30 dias. Token aleatório de 256 bits, somente hash SHA-256 armazenado; token não entra na auditoria nem em query de servidor. Link usa fragmento e origem do navegador, que evita logs HTTP e mantém o domínio público de acesso correto. A UI permite copiar uma única vez; gerar outro cancela o convite pendente anterior. Comentário é exibido como texto React, sem HTML.
- Entrada: gerar/cancelar na ficha → POST autenticado contacts/[id]/nps → fn_manage_customer_nps com org da sessão. Leitura por RLS e privilégios de coluna: hash não é acessível aos usuários. Agente cria para cliente acessível e substitui/cancela seus convites pendentes; gestor/admin substitui/cancela os da equipe; viewer e suporte somente leitura não gravam.
- Entrada externa: página /pesquisa/nps → POST /api/v1/public/nps, sem cookie obrigatório, validando token/body e rate limit por IP/hash. RPC fn_public_customer_nps executável apenas por service_role: organização/contato resolvidos pela linha do hash, nunca enviados pelo cliente. A rota retorna só estado, com no-store; não retorna dados cadastrais, IDs de conta, nota ou comentário anterior. As duas URLs públicas são ancoradas na allowlist do proxy; não liberam o restante do CRM.
- Saídas: resposta e convite → customer_nps_surveys → NpsDoCliente; atividade customer_nps_answered com ator contact e nota → TimelineView → Ver resposta NPS; auditoria no banco sem conteúdo do comentário ou credencial. Estado e atividade são gravados atomicamente; row lock impede resposta repetida/sobrescrita. Erro no envio permite tentar novamente, mas link já respondido só mostra agradecimento.
- Continuidade e configuração: pesquisa manual, equipe compartilha link; nenhum convite externo ou alerta automático enviado. Datas/estado/falhas visíveis na ficha; cancelar/gerar novamente corrige convite errado. IA ainda não consome NPS, e tratamento de detratores usa tarefas e atendimentos já disponíveis. Cadência/alertas automáticos aguardam definição.
- Expirado, cancelado, mesclado ou anonimizado não aceita resposta. Anonimização limpa nota/comentário/datas de resposta e payload NPS no Histórico. Sanitização da telemetria redige fragmento NPS e URLs de navegação; credencial não segue para monitoramento.
- Migrations 0268–0269 aplicadas somente ao Supabase DEV, com baseline idempotente e manifesto. tests/vendepay/nps-rls.mjs verifica duas aplicações em transação com rollback, escopo de org, hash inacessível, resposta única (incluindo 0), substituição/cancelamento/expiração, grants, viewer/anon negados, substituição de convite alheio recusada para agente, auditoria, histórico e anonimização.
- Prova pela interface: convite do Cliente de teste CS, resposta fictícia 9 com comentário, Promotor visível na ficha e Histórico, link do histórico abre aba NPS; novo convite correto em 127.0.0.1 e cancelamento confirmado pela página pública. Apenas dados fictícios. Evidências docs/vendepay-nps-publico.jpg e docs/vendepay-nps-resposta.jpg.
- O link local só funciona neste computador; compartilhar com clientes reais depende de publicar a adaptação no endereço acessível do CRM. Não houve alteração da VPS/produção.
- Validação final: build de produção, TypeScript, lint dos arquivos alterados, lint de canais/papéis e 52 testes dirigidos passaram. Invariantes no PostgreSQL DEV passaram em transação com rollback. Suíte completa Docker/Playwright contra baseline fresco não executada porque Docker não está instalado; prova de tela realizada no DEV autenticado e na página por token.
- Sabotagem após commit: aumentar o mínimo da API de 0 para 1 derrubou exatamente o teste de aceitação da nota zero (1 de 9 casos da rota, como previsto). Código restaurado; os 9 casos passaram novamente.
