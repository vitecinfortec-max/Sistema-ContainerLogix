#!/usr/bin/env python3
"""
Importa as Invoices Internacionais do sistema anterior a partir dos PDFs
invoice_N.pdf exportados pelo próprio sistema, preservando invoice_number
e ajustando o contador para dar continuidade à sequência.
"""
import asyncio
import os
import re
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import uuid
from datetime import datetime, timezone

from pypdf import PdfReader
from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URL = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
DB_NAME = os.environ.get('DB_NAME', 'containerlogix')

DOWNLOADS_DIR = r"C:\Users\victo\Downloads"
INVOICE_NUMBERS = [11, 12, 13, 14]

IMPORT_USER_ID = "c0138c4d-a3fe-4fd4-bf1a-987fa606c648"
IMPORT_USER_NAME = "João Victor Pinheiro"

RECEIVER_DATA = {
    "company": "J.A LOGÍSTICA E ARMAZENAGEM LTDA",
    "cnpj": "58.180.321/0001-03",
    "email": "operacional@jalogisticas.com",
    "phone": "(85) 9 9175-1472",
    "address": "Rodovia CE-155, 16226 - Distrito Industrial",
    "city_state": "São Gonçalo do Amarante - CE",
    "zip": "62670-000",
    "complement": ""
}

HEADER_RE = re.compile(
    r"INVOICE Nº (\d+)\s*Moeda: (\w+) \| Emissão: ([\d-]+) \| Vencimento: ([\d-]+) \| Total: \$ ([\d,\.]+)"
)
PAYER_RE = re.compile(
    r"PAGADOR / PAYER\s*(.+?)\s*CNPJ: (.+?)\s*Contato: (.+?)\s*E-mail: (\S+)\s*(.+?)\s*SERVIÇOS / SERVICES",
    re.DOTALL
)
MONEY_RE = re.compile(r"\$ ([\d,]+\.\d{2})")


def parse_money(s: str) -> float:
    return float(s.replace(",", ""))


def parse_invoice_pdf(path: str) -> dict:
    reader = PdfReader(path)
    full_text = "\n".join(page.extract_text() for page in reader.pages)
    # Normaliza quebras de linha e espaços para facilitar regex
    normalized = re.sub(r"\n\s*\n", "\n", full_text)
    single_line = re.sub(r"\s*\n\s*", " ", normalized)

    header_match = HEADER_RE.search(single_line)
    if not header_match:
        raise ValueError(f"Cabeçalho não encontrado em {path}")
    invoice_number = int(header_match.group(1))
    currency = header_match.group(2)
    issue_date = header_match.group(3)
    due_date = header_match.group(4)
    expected_total = parse_money(header_match.group(5))

    payer_match = PAYER_RE.search(single_line)
    if not payer_match:
        raise ValueError(f"Dados do pagador não encontrados em {path}")
    payer_company = payer_match.group(1).strip()
    payer_cnpj_raw = payer_match.group(2).strip()
    payer_cnpj = None if payer_cnpj_raw == "-" else payer_cnpj_raw
    payer_contact = payer_match.group(3).strip()
    payer_email = payer_match.group(4).strip()
    payer_address = payer_match.group(5).strip()

    # Itens: percorre linha a linha o texto original (não normalizado em single-line)
    lines = [l.strip() for l in normalized.split("\n") if l.strip()]
    items = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if line in ("Descrição / Description", "Qtd", "Valor Unitário", "Total",
                     "PAGADOR / PAYER", "SERVIÇOS / SERVICES") or line.startswith("TOTAL:") \
                or line.startswith("Usuário:") or line.startswith("Data da impressão:") \
                or line.startswith("Documento gerado em") or "INVOICE Nº" in line \
                or line.startswith("Moeda:") or line.startswith("CARU") or line.startswith("CNPJ:") \
                or line.startswith("Contato:") or line.startswith("E-mail:") \
                or "Seattleweg" in line or "J.A LOGÍSTICA" in line or "operacional@" in line \
                or "Rodovia CE-155" in line or "São Gonçalo" in line:
            i += 1
            continue
        # Linha de descrição de item: seguida por qtd, valor unitário e total
        if i + 3 < len(lines):
            qty_str, unit_str, total_str = lines[i + 1], lines[i + 2], lines[i + 3]
            qty_m = re.match(r"^([\d.]+)$", qty_str)
            unit_m = MONEY_RE.match(unit_str)
            total_m = MONEY_RE.match(total_str)
            if qty_m and unit_m and total_m:
                items.append({
                    "description": line,
                    "quantity": float(qty_m.group(1)),
                    "unit_price": parse_money(unit_m.group(1)),
                    "total": parse_money(total_m.group(1)),
                })
                i += 4
                continue
        i += 1

    calculated_total = round(sum(item["total"] for item in items), 2)
    if abs(calculated_total - expected_total) > 0.01:
        raise ValueError(
            f"{path}: total calculado ({calculated_total}) difere do total do PDF ({expected_total}); "
            f"{len(items)} itens extraídos"
        )

    return {
        "invoice_number": invoice_number,
        "currency": currency,
        "issue_date": issue_date,
        "due_date": due_date,
        "total": expected_total,
        "payer_company": payer_company,
        "payer_cnpj": payer_cnpj,
        "payer_contact": payer_contact,
        "payer_email": payer_email,
        "payer_address": payer_address,
        "items": items,
    }


async def import_intl_invoices(dry_run: bool = False):
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    imported = 0
    skipped = 0
    errors = 0
    max_invoice_number = 0

    for n in INVOICE_NUMBERS:
        path = os.path.join(DOWNLOADS_DIR, f"invoice_{n}.pdf")
        try:
            data = parse_invoice_pdf(path)
            invoice_number = data["invoice_number"]
            max_invoice_number = max(max_invoice_number, invoice_number)

            existing = await db.intl_invoices.find_one({"invoice_number": invoice_number}, {"_id": 0, "id": 1})
            if existing:
                print(f"invoice_{n}: pulando - invoice_number {invoice_number} já existe")
                skipped += 1
                continue

            items_data = data["items"]
            subtotal = round(sum(item["total"] for item in items_data), 2)
            total = subtotal

            invoice_doc = {
                "id": str(uuid.uuid4()),
                "invoice_number": invoice_number,
                "receiver_company": RECEIVER_DATA["company"],
                "receiver_cnpj": RECEIVER_DATA["cnpj"],
                "receiver_email": RECEIVER_DATA["email"],
                "receiver_phone": RECEIVER_DATA["phone"],
                "receiver_address": RECEIVER_DATA["address"],
                "receiver_city_state": RECEIVER_DATA["city_state"],
                "receiver_zip": RECEIVER_DATA["zip"],
                "receiver_complement": RECEIVER_DATA["complement"],
                "payer_client_id": None,
                "payer_company": data["payer_company"],
                "payer_cnpj": data["payer_cnpj"],
                "payer_contact": data["payer_contact"],
                "payer_email": data["payer_email"],
                "payer_address": data["payer_address"],
                "issue_date": data["issue_date"],
                "due_date": data["due_date"],
                "currency": data["currency"],
                "items": items_data,
                "subtotal": subtotal,
                "total": total,
                "notes": f"Importado do sistema anterior (invoice_{n}.pdf)",
                "status": "EMITIDA",
                "created_by": IMPORT_USER_ID,
                "created_by_name": IMPORT_USER_NAME,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": None,
            }

            if not dry_run:
                await db.intl_invoices.insert_one(invoice_doc)

            imported += 1
            print(f"invoice_{n}: importada - invoice_number={invoice_number}, "
                  f"payer={data['payer_company']}, itens={len(items_data)}, total=$ {total:.2f}")

        except Exception as e:
            print(f"invoice_{n}: ERRO - {e}")
            errors += 1

    if not dry_run and max_invoice_number > 0:
        counter = await db.counters.find_one({"_id": "intl_invoice_number"})
        current_seq = counter["seq"] if counter else 0
        if max_invoice_number > current_seq:
            await db.counters.update_one(
                {"_id": "intl_invoice_number"},
                {"$set": {"seq": max_invoice_number}},
                upsert=True,
            )
            print(f"Contador intl_invoice_number atualizado de {current_seq} para {max_invoice_number} "
                  f"(próximo será {max_invoice_number + 1})")
        else:
            print(f"Contador intl_invoice_number mantido em {current_seq} (>= {max_invoice_number})")

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
    asyncio.run(import_intl_invoices(dry_run=dry_run))
