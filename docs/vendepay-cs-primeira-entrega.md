# VendePay: primeira entrega de CS

## Disponível nesta branch

- `/app/cs`: destino Sucesso do cliente dentro do CRM, mantendo autenticação e organização existentes. Ainda apresenta fixtures, identificadas como demonstração.
- `/cs-preview`: mesma interface, disponível somente em desenvolvimento local. Produção não libera a prévia; APIs e rotas autenticadas não usam essa exceção.
- Busca de contas, filtro de responsável, conta 360 com GMV, reembolsos, chargebacks e produtos fictícios.
- Carteiras por GMV acumulado em centavos: Suporte até R$9.999,99; Náthali até R$99.999,99; Fernanda até R$999.999,99; Filipe a partir de R$1 milhão.
- Taxa de US$27 por ID único de disputa, separada de BRL.
- Registro de atendimento, reunião, EBR, QBR e tarefa com responsável, data e resumo. Histórico por conta, conclusão/reabertura de tarefas e contagens por responsável.
- Registros locais persistem no navegador; não há banco compartilhado ou usuário real. Não inserir dados reais de clientes.

## Prévia local

Node 22+ e pnpm 9.15.9:

```sh
pnpm install --frozen-lockfile
pnpm dev:cs
```

Abrir http://127.0.0.1:3000/cs-preview. O comando usa placeholders sem validade e desliga telemetria. Nenhum segredo é necessário para a prévia. Avisos de conexão ao Supabase local ausente podem ocorrer no branding existente, que usa sua marca de fallback.

## Direção visual

Manter tipografia Atkinson do produto, base clara, texto em azul escuro, roxo para ações e seleção. Carteira à esquerda e conta à direita; dados financeiros em uma grade compacta. Formulário com foco preso pelo Radix Dialog, rótulos visíveis, teclado, feedback de salvamento e layout empilhado no celular. Sem pontuação inventada de saúde.

## Próximas etapas

1. Criar projeto **de desenvolvimento** Supabase na organização do usuário e informar URL do projeto. Configurar credenciais por ambiente seguro, sem inserir service role no frontend ou no chat.
2. Conferir a baseline/migrations deste repositório antes de aplicar: ele já possui um modelo multi-tenant extenso. O repositório `Vhsdmin/supabase` não equivale a uma instância de banco configurada.
3. Criar tabelas de conta VendePay e atividades com organização, RLS, responsáveis e auditoria; substituir armazenamento local por persistência autenticada.
4. Criar usuário de teste `filipe.fagundes@vendepay.com` e organização, após configurar autenticação.
5. Implementar séries históricas e filtros 7/30/90 dias, 6 meses, ano e personalizado. Filtro de análise não altera carteira acumulada. Ainda não há esses filtros nesta entrega.
6. Jornadas, NPS, alertas com primeira ação e prazo, desempenho por período, conectores/API/webhooks e análise por IA. Nenhum endpoint de produção foi configurado.
7. Reorganizar os menus antigos e retirar as áreas dispensáveis após verificar dependências e acesso ao ambiente oficial.

## Validação

Testes de limites de carteira, taxa única por disputa, recuperação de registros e bloqueio da prévia fora de desenvolvimento. Navegação verificada pelo teste de completude. Validação no navegador: registrar tarefa, recarregar e concluir, com atualização das contagens.

Verificações locais: typecheck passou; lint completo terminou sem erros, com 356 avisos no código existente. A suíte completa não ficou verde neste ambiente: testes de servidor encontraram `listen EPERM`, e houve falhas em outras áreas como importação de leads e notificações. Os testes relacionados à entrega foram executados novamente após corrigir tradução, catálogo e geração de UUID. Não foi validado build de produção, login real nem persistência Supabase.
