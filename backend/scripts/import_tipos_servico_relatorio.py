#!/usr/bin/env python3
"""
Importa os tipos de serviço do sistema anterior a partir do XLSX exportado.
"""
import asyncio
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import uuid
from datetime import timezone

import pandas as pd
from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URL = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
DB_NAME = os.environ.get('DB_NAME', 'containerlogix')

EXCEL_PATH = r"C:\Users\victo\OneDrive\Área de Trabalho\Lista de cadrasto de Tipos de Serviço.xlsx"

IMPORT_USER_ID = "c0138c4d-a3fe-4fd4-bf1a-987fa606c648"


def clean(value):
    if value is None:
        return None
    s = str(value).strip()
    return None if s == "" or s == "-" else s


async def import_service_types(dry_run: bool = False):
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    df = pd.read_excel(EXCEL_PATH)

    imported = 0
    skipped = 0
    errors = 0

    for _, row in df.iterrows():
        name = str(row["Nome"]).strip()
        try:
            existing = await db.service_types.find_one({"name": name}, {"_id": 0, "id": 1})
            if existing:
                print(f"pulando - {name} já existe")
                skipped += 1
                continue

            created_at = row["Cadastrado em"].to_pydatetime().replace(tzinfo=timezone.utc)
            doc = {
                "id": str(uuid.uuid4()),
                "name": name,
                "description": clean(row["Descrição"]),
                "created_at": created_at.isoformat(),
                "created_by": IMPORT_USER_ID,
            }

            if not dry_run:
                await db.service_types.insert_one(doc)

            imported += 1

        except Exception as e:
            print(f"ERRO - {name}: {e}")
            errors += 1

    print("\n" + "=" * 50)
    print("Importação concluída!" if not dry_run else "Dry-run concluído (nada foi gravado)")
    print(f"  - Importadas: {imported}")
    print(f"  - Puladas (já existiam): {skipped}")
    print(f"  - Erros: {errors}")
    print("=" * 50)

    client.close()
    return imported, skipped, errors


if __name__ == "__main__":
    dry_run = "--dry-run" in sys.argv
    asyncio.run(import_service_types(dry_run=dry_run))
