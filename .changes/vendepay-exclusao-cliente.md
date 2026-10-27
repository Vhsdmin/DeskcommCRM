---
impacto: exige_acao
secao: corrigido
titulo: Exclusão de cliente preserva os dados quando encontra impedimento
---
A exclusão passa a ocorrer numa única transação. Atividades de CS sem negócio são removidas com a ficha; atividades vinculadas a negócios permanecem. Compromissos na agenda continuam impedindo a exclusão, sem perda de mensagens ou atividades. IDs inválidos e falta de permissão recebem erros próprios. Crédito: @filipefagundes.

## Requer atenção

Aplicar a migration 0281, após backup, antes de publicar a nova imagem do aplicativo. O schema-init do EasyPanel não atualiza bancos existentes. Não reaplicar o baseline nem apagar volumes para instalar esta correção.
