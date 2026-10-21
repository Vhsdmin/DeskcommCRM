# Integração de configuração: dois forks, credenciais descartáveis, sem daemon Docker.
from pathlib import Path
import tempfile,shutil,subprocess,json,base64,hmac,hashlib,re,argparse
parser=argparse.ArgumentParser()
parser.add_argument('--supabase-repo',type=Path,required=True)
parser.add_argument('--compose-bin',type=Path,required=True)
args=parser.parse_args()
crm_root=Path(__file__).resolve().parents[2]
supa_root=args.supabase_repo.resolve()
compose=args.compose_bin.resolve()
with tempfile.TemporaryDirectory() as tmp:
 tmp=Path(tmp); supa=tmp/'supabase/docker'; crm=tmp/'DeskcommCRM'
 supa.mkdir(parents=True); (crm/'docker/easypanel').mkdir(parents=True)
 for f in ['generate-easypanel-env.py','.env.easypanel.example','docker-compose.easypanel.yml']:
  shutil.copy(supa_root/'docker'/f,supa/f)
 shutil.copytree(supa_root/'docker/volumes',supa/'volumes')
 for f in ['gerar-env.py','init-db.sh','bootstrap.sh','atualizar-equipe-db.sh','equipe-0280.sha256']:
  shutil.copy(crm_root/'docker/easypanel'/f,crm/'docker/easypanel'/f)
 shutil.copy(crm_root/'docker-compose.easypanel.yml',crm/'docker-compose.easypanel.yml')
 shutil.copy(crm_root/'docker-compose.easypanel-upgrade.yml',crm/'docker-compose.easypanel-upgrade.yml')
 (crm/'supabase/migrations').mkdir(parents=True)
 shutil.copy(crm_root/'supabase/baseline.sql',crm/'supabase/baseline.sql')
 for migration in (crm_root/'supabase/migrations').glob('*.sql'):
  if any(f'_{n:04}_' in migration.name for n in range(276,281)):
   shutil.copy(migration,crm/'supabase/migrations'/migration.name)
 subprocess.run(['python3',str(supa/'generate-easypanel-env.py')],check=True,capture_output=True)
 subprocess.run(['python3',str(crm/'docker/easypanel/gerar-env.py'),'--supabase-env',str(supa/'.env'),'--owner-email','qa@example.com'],check=True,capture_output=True)
 outputs=[]
 for directory in [supa,crm]:
  r=subprocess.run([str(compose),'-f','docker-compose.easypanel.yml','--env-file','.env','--profile','maintenance','config','--format','json'],cwd=directory,capture_output=True,text=True)
  if r.returncode: raise RuntimeError(r.stderr)
  d=json.loads(r.stdout); outputs.append(d)
  for n,s in d['services'].items():
   assert not s.get('ports') and not s.get('container_name') and not s.get('build'),n
   for v in s.get('volumes',[]):
    if v['type']=='bind': assert Path(v['source']).exists(), v['source']
  assert subprocess.run([str(compose),'-f','docker-compose.easypanel.yml','--env-file','/dev/null','config','--quiet'],cwd=directory,capture_output=True).returncode!=0
 a,b=outputs
 upgrade=b['services']['equipe-upgrade']
 assert upgrade['profiles']==['maintenance']
 assert upgrade['environment']['PGPASSWORD']==b['services']['schema-init']['environment']['PGPASSWORD']
 assert all('equipe-upgrade' not in service.get('depends_on',{}) for service in b['services'].values())
 assert all(mount['read_only'] for mount in upgrade['volumes'] if mount['target'] in ['/setup/atualizar-equipe-db.sh','/setup/equipe-0280.sha256','/release','/schema'])
 assert not any(mount['target']=='/backups' for mount in b['services']['app'].get('volumes',[]))
 assert a['networks']['deskcomm_private']['name']==b['networks']['supabase_private']['name']
 assert 'realtime-dev.supabase-realtime' in a['services']['realtime']['networks']['default']['aliases']
 assert {n for n,s in a['services'].items() if 'deskcomm_private' in s.get('networks',{})}=={'api-gw','db'}
 app=b['services']['app']['environment']; scheduler=b['services']['scheduler']['environment']
 assert app['POSTGRES_PASSWORD']==app['OWNER_PASSWORD']==app['SUPABASE_DB_ADMIN_URL']==''
 assert scheduler['INTERNAL_SECRET']==app['INTERNAL_CRON_SECRET']
 assert app['UPSTASH_REDIS_REST_TOKEN']==b['services']['srh']['environment']['SRH_TOKEN']
 assert b['services']['waha']['environment']['WAHA_API_KEY']=='sha512:'+hashlib.sha512(app['WAHA_API_KEY'].encode()).hexdigest()
 assert a['services']['api-gw']['environment']['ANON_KEY']==app['NEXT_PUBLIC_SUPABASE_ANON_KEY']
 assert b['services']['schema-init']['environment']['PGPASSWORD']==a['services']['db']['environment']['POSTGRES_PASSWORD']
 secret=a['services']['auth']['environment']['GOTRUE_JWT_SECRET']
 for name in ['ANON_KEY','SERVICE_ROLE_KEY']:
  h,p,s=a['services']['api-gw']['environment'][name].split('.')
  signed=base64.urlsafe_b64encode(hmac.new(secret.encode(),(h+'.'+p).encode(),hashlib.sha256).digest()).decode().rstrip('=')
  assert s==signed
 assert b['services']['schema-export']['image']==b['services']['worker']['image']==b['services']['bootstrap']['image']
 maintenance=subprocess.run([str(compose),'-f','docker-compose.easypanel-upgrade.yml','--env-file','.env','config','--format','json'],cwd=crm,capture_output=True,text=True)
 assert maintenance.returncode==0,maintenance.stderr
 m=json.loads(maintenance.stdout)
 assert set(m['services'])=={'schema-export','equipe-upgrade'}
 assert m['services']['schema-export']['image']==b['services']['worker']['image']
 assert m['services']['equipe-upgrade']['command']==['--apply']
 assert m['volumes']['setup-state']['external'] is True
 assert m['volumes']['setup-state']['name']=='crmvendepay_crm_setup-state'
 assert m['volumes']['upgrade-backups']['name']=='crmvendepay_crm_upgrade-backups'
 assert m['networks']['supabase_private']['name']==b['networks']['supabase_private']['name']
 for service in m['services'].values():
  assert service['restart']=='no'
  assert not service.get('ports') and not service.get('build')
  for mount in service.get('volumes',[]):
   if mount['type']=='bind': assert Path(mount['source']).exists(),mount['source']
 for path in [supa/'generate-easypanel-env.py',crm/'docker/easypanel/gerar-env.py']:
  cmd=['python3',str(path)]
  if path.name=='gerar-env.py': cmd+=['--supabase-env',str(supa/'.env'),'--owner-email','qa@example.com']
  assert subprocess.run(cmd,capture_output=True).returncode!=0
 print('PASS: application, Supabase and maintenance Compose files rendered with Docker Compose 2.39.4; all mounts exist; manual upgrade isolated by profile; private network matches; no host ports/builds/fixed names; JWT/HMAC/Redis/cron consistency; setup secrets cleared in runtime; generators refuse overwrites; empty env rejected.')
