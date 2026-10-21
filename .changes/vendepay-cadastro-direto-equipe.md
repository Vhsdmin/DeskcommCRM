---
impacto: exige_acao
secao: alterado
titulo: Cadastro direto de usuários e permissões por módulo
---
Administradores cadastram nome, e-mail, senha inicial e acessos em Equipe → Novo usuário, sem convite ou envio de e-mail. Permissões podem ser ajustadas depois; administrador mantém acesso completo à organização. Convites ficam preservados no código e desligados por uma flag. Vínculos existentes preservam os direitos anteriores até a edição de seus acessos.

A autorização passa a verificar módulos em páginas, APIs e no PostgREST/RLS. Novos módulos e RPCs precisam ser classificados para usuários restritos. Rebaixar um administrador deixa a pessoa só com as áreas pessoais até que as Permissões sejam definidas. Nenhuma senha é incluída na auditoria ou no corpo de requisição enviado à telemetria. Crédito: @filipefagundes.


## Requer atenção

Antes de publicar o aplicativo em uma instalação existente, faça backup e aplique as migrações 0276, 0277, 0278, 0279 e 0280 pelo procedimento controlado do banco. O schema-init do Easypanel não faz essa atualização automaticamente. Preserve os volumes e os dados; não zere o banco.
