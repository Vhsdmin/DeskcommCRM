---
impacto: exige_acao
secao: corrigido
titulo: Atualização controlada da exclusão de clientes no EasyPanel
---
As imagens da correção ficam fixadas na release revisada e o serviço de manutenção aceita as duas origens conhecidas, faz backup e aplica somente as migrations necessárias até 0282, conferindo as proteções de exclusão antes de avançar os recibos. Crédito: @filipefagundes.

## Requer atenção

Parar o CRM, implantar a manutenção e aguardar a conclusão até 0282; depois implantar o CRM. Não reaplicar baseline, recriar administrador ou remover volumes. Copiar o backup para armazenamento seguro fora da VPS.
