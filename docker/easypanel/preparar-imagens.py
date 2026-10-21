#!/usr/bin/env python3
"""Fixa as três imagens publicadas, somente se vierem do commit solicitado."""
import argparse
import json
from pathlib import Path
import re
import urllib.request

ACCEPT = ', '.join(['application/vnd.oci.image.index.v1+json', 'application/vnd.docker.distribution.manifest.list.v2+json', 'application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json'])
ROOT = Path(__file__).resolve().parents[2]


def get(url, token=None):
    headers = {'Accept': ACCEPT}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60) as response:
        return json.load(response), response.headers


def resolve(name, commit):
    repo = 'filipefagundes/' + name
    token, _ = get('https://ghcr.io/token?service=ghcr.io&scope=repository:' + repo + ':pull')
    base = 'https://ghcr.io/v2/' + repo
    manifest, headers = get(base + '/manifests/main', token['token'])
    digest = headers.get('Docker-Content-Digest', '')
    if not re.fullmatch(r'sha256:[0-9a-f]{64}', digest):
        raise RuntimeError('Digest inválido para ' + name)
    if 'manifests' in manifest:
        platforms = [m for m in manifest['manifests'] if m.get('platform', {}).get('os') == 'linux' and m.get('platform', {}).get('architecture') == 'amd64']
        if len(platforms) != 1:
            raise RuntimeError('Plataforma amd64 ausente ou ambígua: ' + name)
        manifest, _ = get(base + '/manifests/' + platforms[0]['digest'], token['token'])
    config, _ = get(base + '/blobs/' + manifest['config']['digest'], token['token'])
    revision = config.get('config', {}).get('Labels', {}).get('org.opencontainers.image.revision')
    if revision != commit:
        raise RuntimeError(name + ' ainda não corresponde ao commit solicitado. Aguarde o CI.')
    return 'ghcr.io/' + repo + '@' + digest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--commit', required=True)
    args = parser.parse_args()
    if not re.fullmatch('[0-9a-f]{40}', args.commit):
        parser.error('Use o SHA completo do commit revisado.')
    images = {name: resolve(name, args.commit) for name in ['deskcommcrm', 'deskcomm-worker', 'deskcomm-scheduler']}
    compose = ROOT / 'docker-compose.easypanel.yml'
    text = compose.read_text()
    for name, image in images.items():
        text, count = re.subn(r'ghcr\.io/filipefagundes/' + name + r'@sha256:[0-9a-f]{64}', image, text)
        if count != (3 if name == 'deskcomm-worker' else 1):
            raise RuntimeError('Quantidade inesperada de referências: ' + name)
    text = text.replace('# do PR #7, commit fd3354e0)', '# do PR #9, commit ' + args.commit[:9] + ')')
    upgrade = ROOT / 'docker-compose.easypanel-upgrade.yml'
    upgrade_text = upgrade.read_text()
    upgrade_text, count = re.subn(r'ghcr\.io/filipefagundes/deskcomm-worker@sha256:[0-9a-f]{64}', images['deskcomm-worker'], upgrade_text)
    if count != 1:
        raise RuntimeError('Referência inesperada no Compose de manutenção.')
    compose.write_text(text)
    upgrade.write_text(upgrade_text)
    print('Três imagens conferidas pelo commit e fixadas juntas no Compose.')


if __name__ == '__main__':
    main()
