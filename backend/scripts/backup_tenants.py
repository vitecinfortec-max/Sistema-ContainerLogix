"""Backup e teste de restauração dos bancos do servidor multi-cliente.

backup: exporta o banco central e o banco de cada empresa do cadastro central,
coleção por coleção, para <saida>/<AAAA-MM-DD>/<banco>/<coleção>.jsonl.gz
(JSON estendido do Mongo: datas, ids e números voltam com o mesmo tipo) e
grava um manifest.json com as contagens. Só lê do banco.

    python scripts/backup_tenants.py backup --out backups [--keep 5]

restore: carrega um banco do backup num banco NOVO, para conferir que o backup
abre. Recusa os bancos em uso (central e os das empresas) e banco que já tenha
dados, e compara as contagens com o manifest no fim.

    python scripts/backup_tenants.py restore --from backups/2026-11-08 --db containerlogix_jalogistica --into restore_teste_ja

Conexão: MONGO_URL (a mesma do servidor; para o backup basta um usuário só de
leitura). Arquivos (fotos, PDFs) não entram: ficam no disco do servidor.
"""
import argparse
import gzip
import json
import os
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

from bson import json_util
from pymongo import MongoClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tenants import CENTRAL_DB_NAME_DEFAULT  # noqa: E402

CENTRAL_DB_NAME = os.environ.get("CENTRAL_DB_NAME", CENTRAL_DB_NAME_DEFAULT)
BATCH = 1000


def connect():
    url = os.environ.get("MONGO_URL", "").strip()
    if not url:
        sys.exit("Defina MONGO_URL com a conexão do banco.")
    return MongoClient(url, tz_aware=True, serverSelectionTimeoutMS=15000)


def databases_in_use(client):
    """Banco central + o banco de cada empresa cadastrada."""
    tenants = list(client[CENTRAL_DB_NAME].tenants.find({}, {"_id": 0, "slug": 1, "db_name": 1}))
    return [CENTRAL_DB_NAME] + [t["db_name"] for t in tenants if t.get("db_name")]


def dump_database(client, name, dest: Path):
    dest.mkdir(parents=True, exist_ok=True)
    db = client[name]
    counts = {}
    for coll in sorted(db.list_collection_names()):
        if coll.startswith("system."):
            continue
        n = 0
        with gzip.open(dest / f"{coll}.jsonl.gz", "wt", encoding="utf-8") as out:
            for doc in db[coll].find({}, batch_size=BATCH):
                out.write(json_util.dumps(doc, json_options=json_util.CANONICAL_JSON_OPTIONS))
                out.write("\n")
                n += 1
        counts[coll] = n
    return counts


def cmd_backup(args):
    client = connect()
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    root = Path(args.out) / day
    manifest = {"created_at": datetime.now(timezone.utc).isoformat(), "databases": {}}
    for name in databases_in_use(client):
        counts = dump_database(client, name, root / name)
        manifest["databases"][name] = counts
        print(f"{name}: {len(counts)} coleções, {sum(counts.values())} registros")
    (root / "manifest.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False), encoding="utf-8")
    if args.keep:
        days = sorted(p for p in Path(args.out).iterdir() if p.is_dir() and len(p.name) == 10)
        for old in days[:-args.keep]:
            shutil.rmtree(old)
            print(f"apagado backup antigo {old.name}")
    print(f"Backup em {root}")


def cmd_restore(args):
    client = connect()
    source = Path(args.source) / args.db
    if not source.is_dir():
        sys.exit(f"Não achei {source}")
    if args.into in databases_in_use(client) or args.into == args.db:
        sys.exit(f"Recusado: {args.into} é um banco em uso. Restaure num banco novo.")
    target = client[args.into]
    if target.list_collection_names():
        sys.exit(f"Recusado: o banco {args.into} já tem dados.")
    manifest = json.loads((Path(args.source) / "manifest.json").read_text(encoding="utf-8"))
    expected = manifest["databases"].get(args.db, {})
    problems = []
    for file in sorted(source.glob("*.jsonl.gz")):
        coll = file.name[: -len(".jsonl.gz")]
        batch, n = [], 0
        with gzip.open(file, "rt", encoding="utf-8") as src:
            for line in src:
                batch.append(json_util.loads(line))
                if len(batch) >= BATCH:
                    target[coll].insert_many(batch)
                    n += len(batch)
                    batch = []
        if batch:
            target[coll].insert_many(batch)
            n += len(batch)
        ok = n == expected.get(coll)
        if not ok:
            problems.append(coll)
        print(f"{coll}: {n} registros{'' if ok else f' (esperado {expected.get(coll)})'}")
    if problems:
        sys.exit(f"Restauração com diferença em: {', '.join(problems)}")
    print(f"Restauração conferida em {args.into}. Apague esse banco depois do teste.")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    b = sub.add_parser("backup")
    b.add_argument("--out", default="backups")
    b.add_argument("--keep", type=int, default=0, help="quantos backups (dias) manter na pasta")
    r = sub.add_parser("restore")
    r.add_argument("--from", dest="source", required=True, help="pasta do dia, ex.: backups/2026-11-08")
    r.add_argument("--db", required=True, help="banco do backup a restaurar")
    r.add_argument("--into", required=True, help="banco NOVO de destino")
    args = parser.parse_args()
    {"backup": cmd_backup, "restore": cmd_restore}[args.command](args)


if __name__ == "__main__":
    main()
