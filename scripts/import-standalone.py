#!/usr/bin/env python3
"""Recupera los datasets integrados de un HTML ZPOT antiguo, en una carpeta gitignored."""
from pathlib import Path
import argparse, re, json

parser=argparse.ArgumentParser(description='Importar ZIP históricos desde HTML standalone ZPOT, únicamente al equipo local.')
parser.add_argument('html',type=Path,help='HTML anterior con datasets incrustados')
parser.add_argument('--output',type=Path,default=Path('private-data'),help='Directorio local privado')
args=parser.parse_args()
s=args.html.read_text(encoding='utf-8')
args.output.mkdir(parents=True,exist_ok=True)
for tag,filename in [('reference-data','reference.json'),('sources-data','sources.json'),('packs-data','packs.json')]:
    m=re.search(r'<script\s+type="application/json"\s+id="'+tag+r'">(.*?)</script>',s,re.S)
    if not m:raise SystemExit(f'No encontré el bloque {tag}')
    json.loads(m.group(1))
    (args.output/filename).write_text(m.group(1),encoding='utf-8')
    print(f'{filename}: {(args.output/filename).stat().st_size:,} bytes')
print('Datos guardados localmente. NO subas private-data al repositorio GitHub.')
