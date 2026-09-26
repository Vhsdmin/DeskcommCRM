#!/bin/sh
# Reutiliza o bootstrap da imagem publicada e não redefine a senha a cada deploy.
set -eu
test -s /state/schema.signature
if [ -f /state/owner.signature ] && cmp -s /state/schema.signature /state/owner.signature; then
  echo 'Administrador inicial já configurado; credenciais preservadas.'
  exit 0
fi

# Aguarda o PostgREST carregar o schema recém-instalado, com limite e sem logar chaves.
node --input-type=module <<'JS'
let ready = false;
for (let attempt = 0; attempt < 60; attempt++) {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/organizations?select=id&limit=1`, {
      headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
                 Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) { ready = true; break; }
  } catch { /* dependência ainda iniciando */ }
  await new Promise(resolve => setTimeout(resolve, 2000));
}
if (!ready) { process.stderr.write('Supabase REST indisponível para o bootstrap. Confira api-gw e rest.\n'); process.exit(1); }
JS
./node_modules/.bin/tsx scripts/bootstrap-owner.ts >/dev/null
cp /state/schema.signature /state/owner.signature.tmp
mv /state/owner.signature.tmp /state/owner.signature
echo 'Administrador inicial configurado. Faça login no endereço do CRM.'
