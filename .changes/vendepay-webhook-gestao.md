---
impacto: capacidade_nova
secao: adicionado
titulo: Receba as contas do Gestão VendePay por webhook assinado
---
Webhooks › Receber dados passa a ser a conexão com o Gestão VendePay: o gestor cria um endereço e um segredo de assinatura, e o Gestão envia "conta cadastrada" e "conta atualizada". Conta nova vira cliente na fase Entrada; atualização chega pelo ID da conta no Gestão, nunca por e-mail ou telefone. Envio sem assinatura válida é recusado, reenvio do mesmo evento não duplica e conflito de e-mail ou telefone fica registrado para uma pessoa resolver. "Leads recebidos" e Meta Ads ficam ocultos. Exige a migration 0271. Crédito: @filipefagundes.
