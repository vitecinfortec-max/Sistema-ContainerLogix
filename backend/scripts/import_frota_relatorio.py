#!/usr/bin/env python3
"""
Importa o cadastro de veículos (Frota) do sistema anterior a partir do
XLSX exportado.
"""
import asyncio
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import uuid
from datetime import datetime, timezone

import pandas as pd
from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URL = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
DB_NAME = os.environ.get('DB_NAME', 'containerlogix')

EXCEL_PATH = r"C:\Users\victo\OneDrive\Área de Trabalho\Lista de cadrasto de Frota.xlsx"

IMPORT_USER_ID = "c0138c4d-a3fe-4fd4-bf1a-987fa606c648"
IMPORT_USER_NAME = "João Victor Pinheiro"

TIPO_MAP = {
    "Cavalo Mecânico": "CAVALO",
    "Carreta": "CARRETA",
    "Caminhão": "CAMINHÃO",
    "Empilhadeira": "EMPILHADEIRA",
    "Guindaste": "GUINDASTE",
    "Reach Stacker": "REACH_STACKER",
}

STATUS_MAP = {
    "Ativo": "ATIVO",
    "Inativo": "INATIVO",
    "Manutenção": "MANUTENÇÃO",
}


def clean(value):
    if value is None:
        return None
    s = str(value).strip()
    return None if s == "" or s == "-" else s


async def import_vehicles(dry_run: bool = False):
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    df = pd.read_excel(EXCEL_PATH)

    imported = 0
    skipped = 0
    errors = 0

    for _, row in df.iterrows():
        plate = str(row["Placa"]).strip().upper()
        try:
            existing = await db.vehicles.find_one({"plate": plate}, {"_id": 0, "id": 1})
            if existing:
                print(f"pulando - placa {plate} já existe")
                skipped += 1
                continue

            tipo_raw = str(row["Tipo"]).strip()
            vehicle_type = TIPO_MAP.get(tipo_raw, tipo_raw.upper())

            status_raw = str(row["Status"]).strip()
            status = STATUS_MAP.get(status_raw, status_raw.upper())

            doc = {
                "id": str(uuid.uuid4()),
                "plate": plate,
                "model": clean(row["Modelo"]),
                "brand": clean(row["Marca"]),
                "year": int(row["Ano"]) if not pd.isna(row["Ano"]) else None,
                "vehicle_type": vehicle_type,
                "status": status,
                "observations": None,
                "created_by": IMPORT_USER_ID,
                "created_by_name": IMPORT_USER_NAME,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": None,
            }

            if not dry_run:
                await db.vehicles.insert_one(doc)

            imported += 1

        except Exception as e:
            print(f"ERRO - placa {plate}: {e}")
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
    asyncio.run(import_vehicles(dry_run=dry_run))
