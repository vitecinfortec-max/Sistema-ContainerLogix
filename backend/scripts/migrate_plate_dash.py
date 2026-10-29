"""
Padroniza as placas já gravadas no formato com traço (ABC-1D23 / ABC-1234),
o mesmo que as telas passaram a gravar em 29/10/2026.

Uso:
    python scripts/migrate_plate_dash.py            # simulação (não grava nada)
    python scripts/migrate_plate_dash.py --apply    # aplica de fato
    python scripts/migrate_plate_dash.py --db NOME  # só um banco

Com MULTI_TENANT ligado, percorre o banco de cada empresa do cadastro
central; senão, o DB_NAME do .env.

Altera todo campo `plate` ou `*_plate` (também dentro de listas, ex. os
itens da Solicitação de Diária), só quando o valor é uma placa (3 letras +
número, 7 caracteres). Código de equipamento ("EMPILHADEIRA 02") fica como
está. CT-e e MDF-e ficam de fora (guardam a placa no formato da SEFAZ),
assim como os logs de auditoria (são o histórico do que foi gravado).

O valor antigo de cada campo alterado fica na coleção
`migration_backup_plate_dash` do próprio banco.
"""
import argparse
import asyncio
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from motor.motor_asyncio import AsyncIOMotorClient

BACKUP = "migration_backup_plate_dash"
SKIP = {"ctes", "mdfes", "fiscal_settings", "audit_log", "stock_audit_log", "counters", "users",
        "movement_locks", "invoice_history", "freight_payment_history", BACKUP}


def plate_key(value) -> str:
    return "".join(ch for ch in str(value or "").upper() if ch.isascii() and ch.isalnum())


def dashed(value):
    """Placa com traço, ou None se o valor não é placa ou já está no formato."""
    if not isinstance(value, str):
        return None
    key = plate_key(value)
    if len(key) != 7 or not key[:3].isalpha() or not key[3].isdigit():
        return None
    new = f"{key[:3]}-{key[3:]}"
    return None if new == value else new


def is_plate_field(name: str) -> bool:
    """plate, truck_plate, carreta1_plate, trailer_plate_1..."""
    return re.search(r"(^|_)plate(_\d+)?$", name) is not None


def fix(value, path, changes):
    """Percorre o documento; devolve o valor corrigido e anota cada troca."""
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            if is_plate_field(k) and dashed(v):
                changes.append((f"{path}.{k}".lstrip("."), v, dashed(v)))
                out[k] = dashed(v)
            else:
                out[k] = fix(v, f"{path}.{k}", changes)
        return out
    if isinstance(value, list):
        return [fix(v, f"{path}[{i}]", changes) for i, v in enumerate(value)]
    return value


async def migrate_db(db, apply: bool) -> int:
    total = 0
    now = datetime.now(timezone.utc).isoformat()
    for name in sorted(await db.list_collection_names()):
        if name in SKIP or name.startswith("system.") or "backup" in name:
            continue
        coll = db[name]
        count = 0
        async for doc in coll.find({}):
            changes = []
            fixed = fix({k: v for k, v in doc.items() if k != "_id"}, "", changes)
            if not changes:
                continue
            count += 1
            # Só os campos do topo que mudaram (listas vão inteiras)
            top = {c[0].split(".")[0].split("[")[0] for c in changes}
            if apply:
                await db[BACKUP].insert_one({
                    "collection": name, "doc_id": doc["_id"], "migrated_at": now,
                    "old": {f: doc.get(f) for f in top},
                })
                await coll.update_one({"_id": doc["_id"]}, {"$set": {f: fixed[f] for f in top}})
            if count <= 3:
                for path, old, new in changes[:3]:
                    print(f"      {name}: {path}: {old!r} -> {new!r}")
        if count:
            print(f"   {name}: {count} registro(s)")
            total += count
    return total


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--db")
    args = parser.parse_args()

    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    if args.db:
        names = [args.db]
    elif os.environ.get("MULTI_TENANT", "").strip().lower() in ("1", "true", "yes", "sim"):
        from tenants import CENTRAL_DB_NAME_DEFAULT
        central = client[os.environ.get("CENTRAL_DB_NAME", CENTRAL_DB_NAME_DEFAULT)]
        names = [t["db_name"] async for t in central.tenants.find({}, {"db_name": 1})]
    else:
        names = [os.environ["DB_NAME"]]

    print("APLICANDO" if args.apply else "SIMULAÇÃO (nada é gravado; use --apply para aplicar)")
    grand = 0
    for name in names:
        print(f"\n== banco {name}")
        grand += await migrate_db(client[name], args.apply)
    print(f"\nTotal: {grand} registro(s) {'alterados' if args.apply else 'a alterar'}")


if __name__ == "__main__":
    asyncio.run(main())
