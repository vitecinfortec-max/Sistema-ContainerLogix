"""Gera um backup no formato portátil (zip com JSON + fotos), usado para levar dados
do sistema Windows para o app Android offline (que usa SQLite, não MongoDB).

Uso: python export_portable_backup.py <pasta_destino>

Cria em <pasta_destino> um arquivo containerlogix-backup-android-<timestamp>.zip com:
  manifest.json
  data/<colecao>.json   (um array JSON por coleção, sem o campo interno _id do Mongo)
  uploads/<...>          (cópia achatada de todos os arquivos referenciados pelas fotos)
"""
import sys
import os
import json
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from pymongo import MongoClient

ROOT_DIR = Path(__file__).parent
UPLOADS_DIR = ROOT_DIR.parent / 'uploads'

MONGO_URL = os.environ.get('MONGO_URL', 'mongodb://127.0.0.1:27017')
DB_NAME = os.environ.get('DB_NAME', 'containerlogix')

# Coleções incluídas no backup portátil (os módulos habilitados no app Android offline)
COLLECTIONS = [
    'drivers',
    'transport_companies',
    'clients',
    'shipping_lines',
    'container_movements',
    'container_inspections',
]

FORMAT_NAME = 'containerlogix-portable-backup'
FORMAT_VERSION = 1


def json_default(value):
    if isinstance(value, datetime):
        return value.isoformat()
    raise TypeError(f'Tipo não serializável: {type(value)!r}')


def resolve_upload_path(url):
    """Converte uma URL de foto salva no banco (ex: '/api/uploads/xyz.jpg' ou
    '/api/uploads/container_inspections/<id>/frente.jpg') no caminho relativo do
    arquivo dentro de UPLOADS_DIR."""
    if not url:
        return None
    marker = '/api/uploads/'
    if marker in url:
        return url.split(marker, 1)[1]
    return url.lstrip('/')


def collect_upload_refs(collection_name, doc):
    refs = []
    if collection_name == 'container_movements':
        photos = doc.get('container_photos') or {}
        if isinstance(photos, dict):
            refs.extend(photos.values())
    elif collection_name == 'container_inspections':
        for photo in doc.get('photos') or []:
            if isinstance(photo, dict) and photo.get('url'):
                refs.append(photo['url'])
    return [r for r in refs if isinstance(r, str) and r]


def export_backup(dest_dir: str) -> str:
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]

    with tempfile.TemporaryDirectory(prefix='containerlogix-export-') as tmp:
        staging = Path(tmp)
        data_dir = staging / 'data'
        uploads_out_dir = staging / 'uploads'
        data_dir.mkdir(parents=True, exist_ok=True)

        counts = {}
        upload_refs = []

        for collection_name in COLLECTIONS:
            docs = list(db[collection_name].find({}, {'_id': 0}))
            counts[collection_name] = len(docs)
            with open(data_dir / f'{collection_name}.json', 'w', encoding='utf-8') as f:
                json.dump(docs, f, ensure_ascii=False, default=json_default)
            for doc in docs:
                upload_refs.extend(collect_upload_refs(collection_name, doc))

        copied, missing = 0, 0
        for ref in sorted(set(upload_refs)):
            rel_path = resolve_upload_path(ref)
            if not rel_path:
                continue
            src = UPLOADS_DIR / rel_path
            if not src.exists():
                missing += 1
                continue
            dst = uploads_out_dir / rel_path
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
            copied += 1

        manifest = {
            'format': FORMAT_NAME,
            'version': FORMAT_VERSION,
            'generated_at': datetime.now(timezone.utc).isoformat(),
            'source_platform': 'windows-desktop',
            'collections': counts,
            'uploads_copied': copied,
            'uploads_missing': missing,
        }
        with open(staging / 'manifest.json', 'w', encoding='utf-8') as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)

        timestamp = datetime.now().strftime('%Y-%m-%dT%H-%M-%S')
        zip_basename = f'containerlogix-backup-android-{timestamp}'
        os.makedirs(dest_dir, exist_ok=True)
        zip_path = shutil.make_archive(
            str(Path(dest_dir) / zip_basename), 'zip', root_dir=str(staging)
        )
        return zip_path


if __name__ == '__main__':
    if len(sys.argv) != 2:
        print('Uso: python export_portable_backup.py <pasta_destino>', file=sys.stderr)
        sys.exit(1)

    result_path = export_backup(sys.argv[1])
    print(json.dumps({'zip_path': result_path}))
