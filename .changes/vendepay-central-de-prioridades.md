---
impacto: capacidade_nova
secao: adicionado
titulo: Central de Prioridades do CS, sobre sinais que abrem e se resolvem sozinhos
---
A tela inicial do CRM passa a ser a Central de Prioridades: clientes sem vender (7, 15 e 30 dias, quando o Gestão enviar a data da última venda), detratores sem retorno, tarefas vencidas, sem contato há 30/60 dias, onboarding parado há 14 dias e clientes sem responsável, ordenados por severidade e prazo, na carteira do CSM ou de toda a equipe. Os sinais são um modelo único (migration 0273) com motivo, evidência, dono, prazo e versão da regra; nascem quando a condição aparece e se resolvem sozinhos quando ela deixa de valer. Uma fotografia diária guarda o histórico para Health Score e risco. Recalculados ao abrir a tela e a cada hora (cron `cs-sinais`). Crédito: @filipefagundes.
