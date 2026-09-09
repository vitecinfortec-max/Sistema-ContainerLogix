"""
Migra Ordem de Carregamento do formato antigo (um container solto por
documento) para o novo formato com items[] (uma ordem pode levar varios
containers, ver [[project_loading_order_multi_container]]).

Uso:
    python migrate_loading_order_items.py           # dry-run (nao grava nada)
    python migrate_loading_order_items.py --apply    # aplica de fato

So mexe em documentos que ainda nao tem items[] preenchido (documentos ja
migrados, ou criados depois da feature, sao pulados automaticamente).
"""
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from motor.motor_asyncio import AsyncIOMotorClient

LEGACY_ITEM_FIELDS = ["container_number", "size_type", "gross_weight", "seal", "shipping_line"]


async def find_candidates(db):
    """Documentos sem items[] (ou items vazio) - candidatos a migracao -
    junto com os que nao tem container_number utilizavel, pra aviso."""
    query = {"$or": [{"items": {"$exists": False}}, {"items": {"$size": 0}}]}
    changes = []
    warnings = []
    async for doc in db.loading_orders.find(query, {"_id": 0}):
        container_number = doc.get("container_number")
        if not container_number:
            warnings.append(doc.get("id"))
            continue
        item = {field: doc.get(field) for field in LEGACY_ITEM_FIELDS}
        changes.append((doc["id"], doc.get("order_number"), item))
    return changes, warnings


async def apply_changes(db, changes):
    for doc_id, _order_number, item in changes:
        unset_fields = {field: "" for field in LEGACY_ITEM_FIELDS}
        unset_fields["quantity"] = ""
        await db.loading_orders.update_one(
            {"id": doc_id},
            {"$set": {"items": [item]}, "$unset": unset_fields},
        )


async def main():
    apply_flag = "--apply" in sys.argv

    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    changes, warnings = await find_candidates(db)

    print(f"=== {'APLICANDO' if apply_flag else 'DRY-RUN (nada sera gravado)'} ===\n")
    print(f"[loading_orders] {len(changes)} ordem(ns) a migrar")
    for doc_id, order_number, item in changes[:5]:
        print(f"    {doc_id[:8]}... Nº{order_number}  items=[{item}]")
    if len(changes) > 5:
        print(f"    ... e mais {len(changes) - 5}")

    if warnings:
        print(f"\n[AVISO] {len(warnings)} ordem(ns) sem items[] e sem container_number utilizavel - revisar manualmente:")
        for doc_id in warnings:
            print(f"    {doc_id}")

    if apply_flag and changes:
        await apply_changes(db, changes)

    print(f"\nTotal de ordens migradas: {len(changes)}")
    if not apply_flag:
        print("Nada foi gravado - rode com --apply para aplicar de fato.")

    client.close()


if __name__ == "__main__":
    asyncio.run(main())
