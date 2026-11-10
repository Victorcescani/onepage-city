"""Validate aggregate snapshots, without exposing professional identifiers."""
import json
import re
from pathlib import Path


def validate(path, uf):
    data = json.loads(Path(path).read_text())
    assert data['uf'] == uf
    assert re.fullmatch(r'\d{4}(0[1-9]|1[0-2])', data['comp'])
    assert data['identifier'] == 'CNS_PROF'
    assert data['source_file'] == f"PF{uf}{data['comp'][2:]}.DBC"
    assert data['cities']
    prefix = {'RS': '43', 'SC': '42'}[uf]
    for code, city in data['cities'].items():
        assert re.fullmatch(prefix + r'\d{4}', code)
        total = city['total']
        assert type(total) is int and total > 0
        rows = city['especialidades']
        assert rows and len({r['cbo'] for r in rows}) == len(rows)
        for row in rows:
            assert re.fullmatch(r'225\d{3}', row['cbo'])
            assert type(row['medicos']) is int and 0 < row['medicos'] <= total
        assert sum(r['medicos'] for r in rows) >= total
    return data


if __name__ == '__main__':
    snapshots = [validate(f'data/cnes_medicos_{uf}.json', uf) for uf in ('RS', 'SC')]
    assert snapshots[0]['comp'] == snapshots[1]['comp'], 'Competências RS/SC diferentes'
    for data in snapshots:
        print(data['uf'], data['comp'], len(data['cities']), 'municípios: OK')
    for code in ('431680', '430510', '431490'):
        city = snapshots[0]['cities'][code]
        print(code, 'únicos:', city['total'], 'soma CBO (não aditiva):', sum(r['medicos'] for r in city['especialidades']))
