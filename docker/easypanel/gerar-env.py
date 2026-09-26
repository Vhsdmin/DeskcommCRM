#!/usr/bin/env python3
"""Gera .env para instalação NOVA, reutilizando as chaves do Supabase próprio."""
import argparse
import base64
import os
from pathlib import Path
import re
import secrets
import hashlib
from urllib.parse import quote, urlparse


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--supabase-env', type=Path, required=True)
    parser.add_argument('--owner-email')
    parser.add_argument('--org-name', default='VendePay')
    args = parser.parse_args()
    target = Path(__file__).resolve().parents[2] / '.env'
    if target.exists():
        raise SystemExit('Já existe .env; nada alterado. Não regenere chaves de uma instalação existente.')
    supa = {}
    for line in args.supabase_env.read_text(encoding='utf-8').splitlines():
        if re.match(r'^[A-Z][A-Z_0-9]*=', line):
            key, value = line.split('=', 1)
            supa[key] = value.strip().strip('"').strip("'")
    for key in ['POSTGRES_PASSWORD', 'ANON_KEY', 'SERVICE_ROLE_KEY', 'SUPABASE_PUBLIC_URL', 'SITE_URL']:
        if not supa.get(key):
            raise SystemExit('Falta no ambiente do Supabase: ' + key)
    for key in ['SUPABASE_PUBLIC_URL', 'SITE_URL']:
        url = urlparse(supa[key])
        if url.scheme != 'https' or not url.hostname or url.username or url.password or url.query or url.fragment:
            raise SystemExit('Use uma URL HTTPS pública válida em ' + key)
    owner = (args.owner_email or input('E-mail do administrador inicial: ')).strip()
    if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', owner):
        raise SystemExit('E-mail inválido.')
    if any(c in args.org_name + owner for c in '\r\n\x00'):
        raise SystemExit('Nome e e-mail devem estar em uma única linha.')
    token = secrets.token_hex(32)
    waha_key = secrets.token_hex(32)
    app_url = supa['SITE_URL'].rstrip('/')
    values = {
        'COMPOSE_FILE': 'docker-compose.easypanel.yml',
        'SINGLE_SERVER_NETWORK': supa.get('SINGLE_SERVER_NETWORK', 'crmvendepay_backend'),
        'NODE_ENV': 'production',
        'NEXT_PUBLIC_APP_URL': app_url,
        'NEXT_PUBLIC_ADMIN_URL': app_url,
        'NEXT_PUBLIC_SUPABASE_URL': supa['SUPABASE_PUBLIC_URL'].rstrip('/'),
        'NEXT_PUBLIC_SUPABASE_ANON_KEY': supa['ANON_KEY'],
        'SUPABASE_SERVICE_ROLE_KEY': supa['SERVICE_ROLE_KEY'],
        'SUPABASE_DB_URL': 'postgresql://postgres:' + quote(supa['POSTGRES_PASSWORD'], safe='') + '@supabase-db:5432/postgres',
        'SUPABASE_DB_ADMIN_URL': '',
        'POSTGRES_PASSWORD': supa['POSTGRES_PASSWORD'],
        'INTERNAL_SECRET': secrets.token_hex(32),
        'INTERNAL_CRON_SECRET': secrets.token_hex(32),
        'IMPERSONATE_COOKIE_SECRET': secrets.token_hex(32),
        'LGPD_SIGNING_KEY': secrets.token_hex(32),
        'WAHA_API_BASE_URL': 'http://waha:3000',
        'WAHA_WEBHOOK_BASE_URL': 'http://app:3000',
        'WAHA_API_KEY': waha_key,
        'WAHA_API_KEY_SHA512': hashlib.sha512(waha_key.encode()).hexdigest(),
        'WAHA_HMAC_SECRET': secrets.token_hex(32),
        'WAHA_WEBHOOK_REQUIRE_SIGNATURE': 'false',
        'SRH_TOKEN': token,
        'UPSTASH_REDIS_REST_URL': 'http://srh:80',
        'UPSTASH_REDIS_REST_TOKEN': token,
        'SENTRY_DSN': 'off',
        'NUVEMSHOP_ENABLED': 'false',
        'SIGNUP_MODE': 'so_convite',
        'OWNER_EMAIL': owner,
        'OWNER_PASSWORD': secrets.token_hex(24),
        'OWNER_ORG_NAME': args.org_name,
        'SMTP_HOST': '', 'SMTP_PORT': '587', 'SMTP_SECURITY': 'starttls',
        'SMTP_USERNAME': '', 'SMTP_PASSWORD': '', 'SMTP_FROM_EMAIL': '',
        'SMTP_FROM_NAME': args.org_name,
    }
    for key in ['CPF_ENCRYPTION_KEY', 'WAHA_BYO_ENCRYPTION_KEY', 'AI_CRED_AES_KEY']:
        values[key] = base64.b64encode(secrets.token_bytes(32)).decode()
    # Aspas simples do dotenv preservam $, espaços e caracteres da senha.
    def encode(value):
        return "'" + value.replace('\\', '\\\\').replace("'", "\\'") + "'"
    content = '# Privado: cole em Environment do Compose Deskcomm no EasyPanel.\n'
    content += '\n'.join(key + '=' + encode(value) for key, value in values.items()) + '\n'
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as output:
        output.write(content)
    print('.env criado na raiz do DeskcommCRM. Copie para Environment e guarde OWNER_PASSWORD para o primeiro login.')


if __name__ == '__main__':
    main()
