#!/usr/bin/env python3
"""
Importa a lista de pessoas (motoristas) do sistema anterior a partir do
XLSX exportado, deduplicando por CPF (o relatório antigo tinha entradas
repetidas para a mesma pessoa).
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

EXCEL_PATH = r"C:\Users\victo\OneDrive\Área de Trabalho\Lista de cadrasto de pessoas.xlsx"

IMPORT_USER_ID = "c0138c4d-a3fe-4fd4-bf1a-987fa606c648"


def clean_phone(value):
    if value is None:
        return None
    s = str(value).strip()
    return None if s == "" or s == "-" else s


def dedupe_people(df: pd.DataFrame) -> list:
    people = []
    for cpf, group in df.groupby("CPF", sort=False):
        group = group.sort_values("Cadastrado em")
        with_phone = group[group["Telefone"].apply(lambda v: clean_phone(v) is not None)]
        chosen = with_phone.iloc[0] if len(with_phone) > 0 else group.iloc[0]
        people.append({
            "name": str(chosen["Nome"]).strip(),
            "cpf": str(cpf).strip(),
            "phone": clean_phone(chosen["Telefone"]),
            "created_at": group["Cadastrado em"].min().to_pydatetime().replace(tzinfo=timezone.utc),
        })
    return people


async def import_people(dry_run: bool = False):
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    df = pd.read_excel(EXCEL_PATH)
    total_rows = len(df)
    people = dedupe_people(df)

    imported = 0
    skipped = 0
    errors = 0

    for person in people:
        try:
            existing = await db.drivers.find_one({"cpf": person["cpf"]}, {"_id": 0, "id": 1})
            if existing:
                print(f"pulando - CPF {person['cpf']} ({person['name']}) já existe")
                skipped += 1
                continue

            doc = {
                "id": str(uuid.uuid4()),
                "name": person["name"],
                "cpf": person["cpf"],
                "phone": person["phone"],
                "created_at": person["created_at"].isoformat(),
                "created_by": IMPORT_USER_ID,
            }

            if not dry_run:
                await db.drivers.insert_one(doc)

            imported += 1

        except Exception as e:
            print(f"ERRO - CPF {person.get('cpf')}: {e}")
            errors += 1

    print("\n" + "=" * 50)
    print("Importação concluída!" if not dry_run else "Dry-run concluído (nada foi gravado)")
    print(f"  - Linhas na planilha: {total_rows}")
    print(f"  - Pessoas únicas (por CPF): {len(people)}")
    print(f"  - Importadas: {imported}")
    print(f"  - Puladas (já existiam): {skipped}")
    print(f"  - Erros: {errors}")
    print("=" * 50)

    client.close()
    return imported, skipped, errors


if __name__ == "__main__":
    dry_run = "--dry-run" in sys.argv
    asyncio.run(import_people(dry_run=dry_run))
