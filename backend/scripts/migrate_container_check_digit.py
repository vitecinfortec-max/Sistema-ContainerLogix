"""
Recalcula e acrescenta o digito verificador (padrao ISO 6346) em todo
numero de container ja cadastrado, formatando como "XXXX999999-9".

Uso:
    python migrate_container_check_digit.py           # dry-run (nao grava nada)
    python migrate_container_check_digit.py --apply    # aplica de fato

Cobre as colecoes: movements, photo_registries, container_inspections,
flex_tank_movements, loading_orders (campo container_number direto) e
unit_segregations (campo container_number dentro de items[]).
"""
import asyncio
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from motor.motor_asyncio import AsyncIOMotorClient

LETTER_VALUES = {
    'A': 10, 'B': 12, 'C': 13, 'D': 14, 'E': 15, 'F': 16, 'G': 17, 'H': 18, 'I': 19, 'J': 20,
    'K': 21, 'L': 23, 'M': 24, 'N': 25, 'O': 26, 'P': 27, 'Q': 28, 'R': 29, 'S': 30, 'T': 31,
    'U': 32, 'V': 34, 'W': 35, 'X': 36, 'Y': 37, 'Z': 38,
}


def char_value(ch):
    return int(ch) if ch.isdigit() else LETTER_VALUES[ch]


def calculate_check_digit(first10: str) -> int:
    total = sum(char_value(ch) * (2 ** i) for i, ch in enumerate(first10))
    remainder = total % 11
    return 0 if remainder == 10 else remainder


def format_container_number(raw):
    """Retorna o numero formatado "XXXX999999-9", ou None se o valor
    existente nao tem como ser interpretado como um numero de container
    valido (menos de 10 caracteres alfanumericos, ou nao é 4 letras+6 digitos)."""
    if not raw:
        return None
    clean = re.sub(r'[^A-Z0-9]', '', raw.upper())
    first10 = clean[:10]
    if not re.match(r'^[A-Z]{4}[0-9]{6}$', first10):
        return None
    check_digit = calculate_check_digit(first10)
    return f"{first10}-{check_digit}"


async def migrate_flat_field(db, collection_name, field="container_number"):
    """Para colecoes onde container_number e um campo direto do documento."""
    coll = db[collection_name]
    changes = []
    async for doc in coll.find({field: {"$exists": True, "$ne": None}}, {"_id": 0, "id": 1, field: 1}):
        old_value = doc.get(field)
        new_value = format_container_number(old_value)
        if new_value and new_value != old_value:
            changes.append((doc["id"], old_value, new_value))
    return collection_name, changes


async def migrate_items_field(db, collection_name, field="container_number"):
    """Para colecoes onde container_number fica dentro de um array items[]."""
    coll = db[collection_name]
    changes = []
    async for doc in coll.find({}, {"_id": 0, "id": 1, "items": 1}):
        items = doc.get("items") or []
        doc_changes = []
        for idx, item in enumerate(items):
            old_value = item.get(field)
            new_value = format_container_number(old_value)
            if new_value and new_value != old_value:
                doc_changes.append((idx, old_value, new_value))
        if doc_changes:
            changes.append((doc["id"], doc_changes))
    return collection_name, changes


async def apply_flat_field(db, collection_name, changes, field="container_number"):
    coll = db[collection_name]
    for doc_id, _old, new_value in changes:
        await coll.update_one({"id": doc_id}, {"$set": {field: new_value}})


async def apply_items_field(db, collection_name, changes, field="container_number"):
    coll = db[collection_name]
    for doc_id, doc_changes in changes:
        doc = await coll.find_one({"id": doc_id}, {"_id": 0, "items": 1})
        items = doc.get("items") or []
        for idx, _old, new_value in doc_changes:
            items[idx][field] = new_value
        await coll.update_one({"id": doc_id}, {"$set": {"items": items}})


async def main():
    apply_changes = "--apply" in sys.argv

    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    flat_collections = [
        "movements",
        "photo_registries",
        "container_inspections",
        "flex_tank_movements",
        "loading_orders",
    ]
    items_collections = [
        "unit_segregations",
    ]

    all_flat_changes = []
    for name in flat_collections:
        all_flat_changes.append(await migrate_flat_field(db, name))

    all_items_changes = []
    for name in items_collections:
        all_items_changes.append(await migrate_items_field(db, name))

    total = 0
    print(f"=== {'APLICANDO' if apply_changes else 'DRY-RUN (nada sera gravado)'} ===\n")
    for name, changes in all_flat_changes:
        print(f"[{name}] {len(changes)} registro(s) a atualizar")
        for doc_id, old, new in changes[:5]:
            print(f"    {doc_id[:8]}...  {old!r} -> {new!r}")
        if len(changes) > 5:
            print(f"    ... e mais {len(changes) - 5}")
        total += len(changes)
        if apply_changes and changes:
            await apply_flat_field(db, name, changes)

    for name, doc_changes in all_items_changes:
        item_count = sum(len(c) for _id, c in doc_changes)
        print(f"[{name}] {len(doc_changes)} documento(s) / {item_count} item(ns) a atualizar")
        for doc_id, changes in doc_changes[:5]:
            for idx, old, new in changes:
                print(f"    {doc_id[:8]}... item[{idx}]  {old!r} -> {new!r}")
        if len(doc_changes) > 5:
            print(f"    ... e mais {len(doc_changes) - 5} documento(s)")
        total += item_count
        if apply_changes and doc_changes:
            await apply_items_field(db, name, doc_changes)

    print(f"\nTotal de valores de container_number afetados: {total}")
    if not apply_changes:
        print("Nada foi gravado - rode com --apply para aplicar de fato.")

    client.close()


if __name__ == "__main__":
    asyncio.run(main())
