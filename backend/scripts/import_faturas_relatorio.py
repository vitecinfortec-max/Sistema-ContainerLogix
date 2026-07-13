#!/usr/bin/env python3
"""
Importa as faturas (Fatura) do sistema anterior a partir dos arquivos
fatura_N.xlsx exportados pelo próprio sistema, vinculando às movimentações
já importadas (por transaction_id), marcando-as como faturadas e ajustando
o contador de invoice_number para dar continuidade à sequência.
"""
import asyncio
import os
import re
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import uuid
from datetime import datetime, timezone, timedelta

import pandas as pd
from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URL = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
DB_NAME = os.environ.get('DB_NAME', 'containerlogix')

DOWNLOADS_DIR = r"C:\Users\victo\Downloads"
INVOICE_NUMBERS = [22, 23, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37]

IMPORT_USER_ID = "c0138c4d-a3fe-4fd4-bf1a-987fa606c648"
IMPORT_USER_NAME = "João Victor Pinheiro"

BRT_OFFSET = timedelta(hours=3)

TITLE_RE = re.compile(r"FATURA Nº (\d+) - Cliente: (.+)")
STATS_RE = re.compile(
    r"Total: (\d+) movimenta[cç][oõ]es\s*\|\s*Valor: R\$\s*([\d\.,]+)\s*\|\s*Data: (\d{2}/\d{2}/\d{4} \d{2}:\d{2})"
)


def parse_brl(value: str) -> float:
    return float(value.replace(".", "").replace(",", "."))


def parse_datetime(value: str) -> datetime:
    naive = datetime.strptime(value.strip(), "%d/%m/%Y %H:%M")
    return (naive + BRT_OFFSET).replace(tzinfo=timezone.utc)


def clean(value):
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    s = str(value).strip()
    if s == "" or s == "-":
        return None
    return s


def parse_fatura_file(path: str) -> dict:
    df = pd.read_excel(path, header=None)

    title_match = TITLE_RE.match(str(df.iloc[3, 1]))
    if not title_match:
        raise ValueError(f"Título não encontrado/formato inesperado em {path}")
    invoice_number = int(title_match.group(1))
    client_name = title_match.group(2).strip()

    stats_match = STATS_RE.match(str(df.iloc[5, 1]))
    if not stats_match:
        raise ValueError(f"Estatísticas não encontradas/formato inesperado em {path}")
    expected_count = int(stats_match.group(1))
    expected_total = parse_brl(stats_match.group(2))
    created_at = parse_datetime(stats_match.group(3))

    items = []
    for i in range(8, len(df)):
        transaction_id = df.iloc[i, 1]
        if pd.isna(transaction_id):
            break
        items.append({
            "transaction_id": int(transaction_id),
            "service_type": clean(df.iloc[i, 11]),
            "nota_fiscal": clean(df.iloc[i, 12]),
            "service_value": float(df.iloc[i, 13]) if not pd.isna(df.iloc[i, 13]) else 0.0,
        })

    if len(items) != expected_count:
        raise ValueError(
            f"{path}: esperado {expected_count} movimentações, encontrado {len(items)}"
        )

    return {
        "invoice_number": invoice_number,
        "client_name": client_name,
        "created_at": created_at,
        "expected_total": expected_total,
        "items": items,
    }


async def import_invoices(dry_run: bool = False):
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    imported = 0
    skipped = 0
    errors = 0
    max_invoice_number = 0

    for n in INVOICE_NUMBERS:
        path = os.path.join(DOWNLOADS_DIR, f"fatura_{n}.xlsx")
        try:
            data = parse_fatura_file(path)
            invoice_number = data["invoice_number"]
            max_invoice_number = max(max_invoice_number, invoice_number)

            existing = await db.invoices.find_one({"invoice_number": invoice_number}, {"_id": 0, "id": 1})
            if existing:
                print(f"fatura_{n}: pulando - invoice_number {invoice_number} já existe")
                skipped += 1
                continue

            transaction_ids = [item["transaction_id"] for item in data["items"]]
            movements = await db.movements.find(
                {"transaction_id": {"$in": transaction_ids}},
                {"_id": 0, "id": 1, "transaction_id": 1, "billed": 1},
            ).to_list(None)
            movements_by_tid = {m["transaction_id"]: m for m in movements}

            missing = [tid for tid in transaction_ids if tid not in movements_by_tid]
            if missing:
                raise ValueError(f"movimentações não encontradas no banco: {missing}")

            already_billed = [tid for tid in transaction_ids if movements_by_tid[tid].get("billed")]
            if already_billed:
                raise ValueError(f"movimentações já faturadas: {already_billed}")

            total_value = round(sum(item["service_value"] for item in data["items"]), 2)
            if abs(total_value - data["expected_total"]) > 0.01:
                raise ValueError(
                    f"total calculado ({total_value}) difere do total do relatório ({data['expected_total']})"
                )

            movement_ids = [movements_by_tid[tid]["id"] for tid in transaction_ids]
            invoice_id = str(uuid.uuid4())
            created_at_iso = data["created_at"].isoformat()

            invoice_doc = {
                "id": invoice_id,
                "invoice_number": invoice_number,
                "client_name": data["client_name"],
                "client_cnpj": None,
                "movement_ids": movement_ids,
                "total_value": total_value,
                "notes": f"Importado do sistema anterior (fatura_{n}.xlsx)",
                "created_at": created_at_iso,
                "created_by": IMPORT_USER_ID,
                "user_name": IMPORT_USER_NAME,
            }

            if not dry_run:
                await db.invoices.insert_one(invoice_doc)

                for item in data["items"]:
                    mov = movements_by_tid[item["transaction_id"]]
                    update_fields = {
                        "billed": True,
                        "billed_at": created_at_iso,
                        "invoice_id": invoice_id,
                        "service_value": item["service_value"],
                    }
                    if item["service_type"]:
                        update_fields["service_type"] = item["service_type"]
                    if item["nota_fiscal"]:
                        update_fields["invoice_number"] = item["nota_fiscal"]
                    await db.movements.update_one({"id": mov["id"]}, {"$set": update_fields})

            imported += 1
            print(f"fatura_{n}: importada - invoice_number={invoice_number}, "
                  f"cliente={data['client_name']}, movimentações={len(data['items'])}, total=R$ {total_value:.2f}")

        except Exception as e:
            print(f"fatura_{n}: ERRO - {e}")
            errors += 1

    if not dry_run and max_invoice_number > 0:
        counter = await db.counters.find_one({"_id": "invoice_number"})
        current_seq = counter["seq"] if counter else 0
        if max_invoice_number > current_seq:
            await db.counters.update_one(
                {"_id": "invoice_number"},
                {"$set": {"seq": max_invoice_number}},
                upsert=True,
            )
            print(f"Contador invoice_number atualizado de {current_seq} para {max_invoice_number} "
                  f"(próximo será {max_invoice_number + 1})")
        else:
            print(f"Contador invoice_number mantido em {current_seq} (>= {max_invoice_number})")

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
    asyncio.run(import_invoices(dry_run=dry_run))
