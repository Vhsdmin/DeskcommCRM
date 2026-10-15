---
impacto: capacidade_nova
secao: corrigido
titulo: Recupere consultas de sessão após falha transitória de rede
---
Consultas de leitura ao Supabase têm uma segunda tentativa limitada para falhas de transporte e não usam cache de fetch. Login ou gravações nunca são reenviados automaticamente. Falhas de conexão no login recebem uma mensagem própria e não incrementam o bloqueio por senha incorreta. No desenvolvimento, o cache HMR de consultas está desligado e os logs de requisição do login omitem argumentos de credenciais, preservando a auditoria da aplicação. Crédito: @filipefagundes.
