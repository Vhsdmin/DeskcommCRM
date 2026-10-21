---
impacto: nada_mudou
secao: corrigido
titulo: Requisição repetida reconhece o recibo binário do banco
---
O helper compartilhado de idempotência interpreta o hash `bytea` retornado pelo PostgREST e grava novos hashes em hexadecimal binário. Reconhece também recibos antigos gravados como texto, evitando conflito falso ao repetir a mesma operação com a mesma chave. Não altera o schema nem os efeitos de requisições distintas. Crédito: @filipefagundes.
