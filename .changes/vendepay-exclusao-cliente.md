---
impacto: exige_acao
secao: corrigido
titulo: Exclusão de cliente preserva os dados quando encontra impedimento
---
A exclusão passa a ocorrer numa única transação. Atividades de CS sem negócio são removidas com a ficha; atividades vinculadas a negócios permanecem. Compromissos na agenda continuam impedindo a exclusão, sem perda de mensagens ou atividades. IDs inválidos e falta de permissão recebem erros próprios. A exclusão direta pela API do banco também exige papel agent ou superior; usuários de somente leitura não podem acionar a limpeza do histórico. Crédito: @filipefagundes.

## Requer atenção

Aplicar as migrations 0281 e 0282, após backup, antes de publicar a nova imagem do aplicativo. O schema-init do EasyPanel não atualiza bancos existentes. Não reaplicar o baseline nem apagar volumes para instalar esta correção.
