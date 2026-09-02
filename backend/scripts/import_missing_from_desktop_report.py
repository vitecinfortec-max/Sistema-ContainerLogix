#!/usr/bin/env python3
"""
Importa pra nuvem os registros de movimentação que existem no relatório
exportado do app Desktop (relatorio_movimentacoes_02-09-2026_16-54.xlsx) mas
NÃO existem no banco da nuvem - o Desktop tem um banco local próprio que
divergiu da nuvem, então só os transaction_id ausentes na nuvem são
importados (registros já existentes na nuvem NÃO são tocados/sobrescritos,
já que a nuvem é a fonte da verdade a partir de agora).
"""
import asyncio
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import uuid
from datetime import datetime, timezone, timedelta

import pandas as pd
from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URL = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
DB_NAME = os.environ.get('DB_NAME', 'containerlogix')

EXCEL_PATH = r"C:\Users\victo\OneDrive\Área de Trabalho\relatorio_movimentacoes_02-09-2026_16-54.xlsx"
SHEET_NAME = "Movimentações"

IMPORT_USER_ID = "c0138c4d-a3fe-4fd4-bf1a-987fa606c648"
IMPORT_USER_NAME = "João Victor Pinheiro"

BRT_OFFSET = timedelta(hours=3)

OPERATION_MAP = {
    "ENTRADA": "ENTRADA",
    "SAÍDA": "SAIDA",
    "SAIDA": "SAIDA",
}

_LETTER_VALUES = {
    'A': 10, 'B': 12, 'C': 13, 'D': 14, 'E': 15, 'F': 16, 'G': 17, 'H': 18, 'I': 19, 'J': 20,
    'K': 21, 'L': 23, 'M': 24, 'N': 25, 'O': 26, 'P': 27, 'Q': 28, 'R': 29, 'S': 30, 'T': 31,
    'U': 32, 'V': 34, 'W': 35, 'X': 36, 'Y': 37, 'Z': 38,
}


def _char_value(ch: str) -> int:
    return int(ch) if ch.isdigit() else _LETTER_VALUES[ch]


def format_container_number(raw: str) -> str:
    if not raw:
        return raw
    s = raw.strip().upper().replace('-', '').replace(' ', '')
    if len(s) == 11 and s[:4].isalpha() and s[4:].isdigit():
        first10 = s[:10]
    elif len(s) == 10 and s[:4].isalpha() and s[4:].isdigit():
        first10 = s
    else:
        return raw
    total = sum(_char_value(ch) * (2 ** i) for i, ch in enumerate(first10))
    remainder = total % 11
    check_digit = 0 if remainder == 10 else remainder
    return f"{first10}-{check_digit}"


def parse_datetime(value: str) -> datetime:
    naive = datetime.strptime(str(value).strip(), "%d/%m/%Y %H:%M")
    return (naive + BRT_OFFSET).replace(tzinfo=timezone.utc)


def clean(value):
    if value is None:
        return None
    s = str(value).strip()
    if s == "" or s == "-" or s.lower() == "nan":
        return None
    return s


async def import_movements(dry_run: bool = False):
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    df = pd.read_excel(EXCEL_PATH, sheet_name=SHEET_NAME, header=0)
    df = df.dropna(subset=['ID Trans.'])
    container_col = [c for c in df.columns if 'Container' in c][0]

    existing_docs = await db.movements.find({}, {"_id": 0, "transaction_id": 1}).to_list(None)
    existing_ids = set(d["transaction_id"] for d in existing_docs)

    imported = 0
    skipped = 0
    errors = 0
    max_transaction_id = 0

    for row_idx, row in df.iterrows():
        transaction_id = int(row["ID Trans."])
        if transaction_id in existing_ids:
            # Já existe na nuvem - não sobrescreve (nuvem é a fonte da verdade).
            skipped += 1
            continue
        try:
            operation_type = OPERATION_MAP[str(row["Tipo"]).strip()]
            created_at = parse_datetime(row["Data/Hora"])

            doc = {
                "id": str(uuid.uuid4()),
                "transaction_id": transaction_id,
                "operation_type": operation_type,
                "driver_name": clean(row["Motorista"]) or "",
                "driver_cpf": clean(row["CPF"]) or "",
                "truck_plate": clean(row["Placa Cavalo"]) or "",
                "trailer_plate_1": clean(row["Placa Carreta"]) or "",
                "trailer_plate_2": None,
                "transport_company": clean(row["Transportadora"]) or "",
                "client_name": None,  # não disponível neste formato de relatório
                "container_number": format_container_number(clean(row[container_col]) or ""),
                "status": clean(row["Status"]),
                "size_type": clean(row["Tamanho"]),
                "tare": clean(row["Tara"]),
                "shipping_line": clean(row["Armador"]) or "",
                "seal": None,
                "genset": None,
                "booking": clean(row["Booking"]),
                "origin_terminal": None,
                "service_type": None,
                "invoice_number": None,
                "service_value": None,
                "currency": "BRL",
                "observations": "Importado do relatório do app Desktop (ausente na nuvem) - relatorio_movimentacoes_02-09-2026_16-54.xlsx",
                "container_photos": None,
                "container_damages": [],
                "inspection_notes": None,
                "billed": False,
                "billed_at": None,
                "created_at": created_at.isoformat(),
                "created_by": IMPORT_USER_ID,
                "user_name": IMPORT_USER_NAME,
            }

            if not dry_run:
                await db.movements.insert_one(doc)

            imported += 1
            max_transaction_id = max(max_transaction_id, transaction_id)

            if imported % 50 == 0:
                print(f"Progresso: {imported} movimentações importadas...")

        except Exception as e:
            print(f"Linha {row_idx + 2}: erro no transaction_id {transaction_id} - {e}")
            errors += 1

    if not dry_run and max_transaction_id > 0:
        counter = await db.counters.find_one({"_id": "transaction_id"})
        current_seq = counter["seq"] if counter else 0
        if max_transaction_id > current_seq:
            await db.counters.update_one(
                {"_id": "transaction_id"},
                {"$set": {"seq": max_transaction_id}},
                upsert=True,
            )
            print(f"Contador transaction_id atualizado de {current_seq} para {max_transaction_id}")

    print("\n" + "=" * 50)
    print("Importação concluída!" if not dry_run else "Dry-run concluído (nada foi gravado)")
    print(f"  - Importadas (novas): {imported}")
    print(f"  - Puladas (já existiam na nuvem): {skipped}")
    print(f"  - Erros: {errors}")
    print("=" * 50)

    client.close()
    return imported, skipped, errors


if __name__ == "__main__":
    dry_run = "--dry-run" in sys.argv
    asyncio.run(import_movements(dry_run=dry_run))
