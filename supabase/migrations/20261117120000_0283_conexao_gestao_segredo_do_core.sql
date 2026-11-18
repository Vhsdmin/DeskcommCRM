-- 0283: o segredo da conexão com o Gestão passa a vir do core da VendePay.
--
-- Quem tem os dados (o core) gera o segredo ao configurar o destino e o exibe uma
-- vez na Gestão; a pessoa cola esse segredo no CRM. A conexão nasce só com o
-- endereço e fica sem segredo até a colagem — o receptor responde 503 nesse
-- intervalo, e o core tenta de novo.
--
-- Os segredos já gravados foram gerados pelo próprio CRM e nunca coincidem com
-- o do core: são apagados, para a tela pedir a colagem em vez de recusar tudo
-- com 401 (que o core trata como falha definitiva).

-- Só na primeira aplicação (coluna ainda NOT NULL): re-aplicar não apaga
-- segredos já colados.
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'gestao_conexoes'
      and column_name = 'secret_encrypted' and is_nullable = 'NO'
  ) then
    alter table public.gestao_conexoes alter column secret_encrypted drop not null;
    update public.gestao_conexoes set secret_encrypted = null where secret_encrypted is not null;
  end if;
end $$;

comment on column public.gestao_conexoes.secret_encrypted is
  'Segredo do HMAC SHA-256 gerado pelo core da VendePay e colado no CRM, cifrado por fn_encrypt_oauth. Nulo até a colagem (receptor responde 503). Nunca volta ao navegador.';
