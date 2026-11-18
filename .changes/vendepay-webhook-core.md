---
impacto: exige_acao
secao: alterado
titulo: Webhook do Gestão passa a usar o segredo gerado pelo core da VendePay
---
A conexão em Webhooks › Receber dados agora nasce só com o endereço. O segredo de assinatura é gerado pelo core da VendePay quando o endereço é informado na Gestão, e a pessoa o cola nesta tela. Enquanto o segredo não é colado (ou o colado não confere), o CRM pede ao core que tente de novo, sem processar nada. O envio aceito é a fotografia do vendedor (`crm.user.updated`): o CRM guarda nome, e-mail e telefone, e usa o e-mail como nome quando o nome vem vazio. O formato antigo (`account.created`, `account.updated`, `account.snapshot`) deixou de ser aceito.

## Requer atenção

Aplicar a migration 0283 antes de usar a conexão. Ela apaga os segredos gerados pelo CRM: quem já tinha conexão precisa informar o endereço na Gestão e colar aqui o segredo que o core gerar.
