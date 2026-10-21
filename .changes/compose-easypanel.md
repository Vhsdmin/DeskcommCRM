---
impacto: capacidade_nova
secao: adicionado
titulo: Instalação nova por Compose no EasyPanel com Supabase próprio
---

O fork oferece um Compose independente para o EasyPanel, com as imagens do
VendePay CRM fixadas por digest, rede privada compartilhada com o Supabase e inicialização do
banco e do administrador. O schema vem da mesma imagem do worker, evitando
misturar o banco da branch de desenvolvimento com o app de uma release.

O caminho é opt-in para instalações novas. Os instaladores e o Compose padrão
continuam iguais. A atualização de instalações existentes exige backup e
migração explícita; o inicializador recusa trocar versão ou assumir outro banco.

Destino: infraestrutura. Nenhuma organização precisa ativar uma extensão.
