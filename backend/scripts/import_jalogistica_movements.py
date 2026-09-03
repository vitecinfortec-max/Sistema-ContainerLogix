#!/usr/bin/env python3
"""
Importa o histórico completo de movimentações ("Importação de Dados.xlsx")
pra dentro da instância nova e isolada da J.A Logística (containerlogix_jalogistica)
- banco começou vazio, então preserva o transaction_id original de cada linha
(sem risco de colisão, confirmado antes de rodar).
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
DB_NAME = os.environ.get('DB_NAME', 'containerlogix_jalogistica')

EXCEL_PATH = r"C:\Users\victo\OneDrive\Área de Trabalho\Importação de Dados.xlsx"
SHEET_NAME = "Movimentações"

IMPORT_USER_ID = "d8fba8ff-269c-4ecc-98ee-8b569ce89fc2"  # joao.victor@jalogisticas.com nesta instância
IMPORT_USER_NAME = "Joao Victor Pinheiro Vidal Paiva"

BRT_OFFSET = timedelta(hours=3)

OPERATION_MAP = {
    "ENTRADA": "ENTRADA",
    "SAÍDA": "SAIDA",
    "SAIDA": "SAIDA",
}

# Normaliza pro nome exato já cadastrado em Clientes nesta instância, senão as
# movimentações ficam sem vínculo (relatório por e-mail, agrupamento etc. casam
# por client_name exato).
CLIENT_NAME_MAP = {
    "TLL Container e Serviços": "TLL Container e Serviços LTDA",
}


def normalize_client_name(name):
    return CLIENT_NAME_MAP.get(name, name)

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


def clean_float(value):
    s = clean(value)
    if s is None:
        return None
    try:
        return float(s)
    except ValueError:
        return None


async def import_movements(dry_run: bool = False):
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    df = pd.read_excel(EXCEL_PATH, sheet_name=SHEET_NAME, header=0)
    df = df.dropna(subset=['ID Trans.'])
    container_col = [c for c in df.columns if 'Container' in c][0]
    valor_col = [c for c in df.columns if 'Valor' in c][0]
    tiposervico_col = [c for c in df.columns if 'Tipo de Servi' in c][0]

    existing_docs = await db.movements.find({}, {"_id": 0, "transaction_id": 1}).to_list(None)
    existing_ids = set(d["transaction_id"] for d in existing_docs)

    imported = 0
    skipped = 0
    errors = 0
    max_transaction_id = 0

    for row_idx, row in df.iterrows():
        transaction_id = int(row["ID Trans."])
        if transaction_id in existing_ids:
            print(f"Linha {row_idx + 2}: pulando - transaction_id {transaction_id} já existe")
            skipped += 1
            max_transaction_id = max(max_transaction_id, transaction_id)
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
                "client_name": normalize_client_name(clean(row["Cliente"])),
                "container_number": format_container_number(clean(row[container_col]) or ""),
                "status": clean(row["Status"]),
                "size_type": clean(row["Tamanho"]),
                "tare": clean(row["Tara"]),
                "shipping_line": clean(row["Armador"]) or "",
                "seal": None,
                "genset": None,
                "booking": clean(row["Booking"]),
                "origin_terminal": None,
                "service_type": clean(row[tiposervico_col]),
                "invoice_number": None,
                "service_value": clean_float(row[valor_col]),
                "currency": "BRL",
                "observations": "Importado - histórico inicial da instância (Importação de Dados.xlsx)",
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

            if imported % 100 == 0:
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
    print(f"  - Importadas: {imported}")
    print(f"  - Puladas (já existiam): {skipped}")
    print(f"  - Erros: {errors}")
    print("=" * 50)

    client.close()
    return imported, skipped, errors


if __name__ == "__main__":
    dry_run = "--dry-run" in sys.argv
    asyncio.run(import_movements(dry_run=dry_run))
