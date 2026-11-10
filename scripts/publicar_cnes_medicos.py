"""Publish generated snapshots atop the current remote HEAD, never force-push.

A separate worktree preserves concurrent source edits. Retry non-fast-forward
pushes; never replace a newer competence or publish with a stale generator.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from validar_cnes_medicos import validate


def git(*args, cwd=None):
    return subprocess.check_output(['git', *args], cwd=cwd, text=True).strip()


root = Path.cwd()
branch = os.environ['GITHUB_REF_NAME']
git('check-ref-format', '--branch', branch)
files = [f'data/cnes_medicos_{uf}.json' for uf in ('RS', 'SC')]
generator = 'scripts/gerar_cnes_medicos.R'
source_blob = git('rev-parse', f'HEAD:{generator}')
for attempt in range(4):
    git('fetch', 'origin', branch)
    remote = git('rev-parse', 'FETCH_HEAD')
    if git('rev-parse', f'{remote}:{generator}') != source_blob:
        raise SystemExit('Gerador mudou durante a execução; execute novamente para evitar publicar dados obsoletos.')
    with tempfile.TemporaryDirectory() as temp:
        work = Path(temp) / 'publish'
        git('worktree', 'add', '--detach', str(work), remote)
        try:
            for uf, name in zip(('RS', 'SC'), files):
                new = validate(root / name, uf)
                dest = work / name
                old = json.loads(dest.read_text()) if dest.exists() else {}
                if old.get('comp', '') > new['comp']:
                    raise SystemExit('Recusando regressão de competência.')
                if {k:v for k,v in old.items() if k != 'generated_at'} == {k:v for k,v in new.items() if k != 'generated_at'}:
                    continue
                shutil.copy2(root / name, dest)
            git('add', *files, cwd=work)
            if not git('diff', '--cached', '--name-only', cwd=work):
                print('Dados já publicados; sem alterações.')
                break
            git('commit', '-m', 'data: atualizar médicos CNES [skip cnes]', cwd=work)
            pushed = subprocess.run(['git', 'push', 'origin', f'HEAD:refs/heads/{branch}'], cwd=work)
            if pushed.returncode == 0:
                break
        finally:
            git('worktree', 'remove', '--force', str(work))
else:
    raise SystemExit('Branch mudou repetidamente; publicação abortada sem sobrescrever alterações.')
