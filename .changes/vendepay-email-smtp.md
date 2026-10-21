---
impacto: capacidade_nova
secao: adicionado
titulo: E-mails do CRM pelo SMTP (Google Workspace), além do Resend
---
Convites da equipe e avisos de LGPD podem sair por qualquer servidor SMTP, como o do Google Workspace, sem conta no Resend. Basta preencher `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL` e `SMTP_FROM_NAME` no ambiente do CRM: com SMTP configurado, ele tem prioridade; sem ele, o envio segue pelo Resend como antes, e sem nenhum dos dois a tela de convite mostra o link para copiar. A escolha é pela configuração, nunca por falha, para não entregar em dobro. Porta ou segurança inválidas não derrubam o app. A auditoria do convite registra por onde o e-mail tentou sair e o erro, quando houver. Crédito: @filipefagundes.
