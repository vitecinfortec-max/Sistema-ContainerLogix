#!/usr/bin/env python3
"""
Importa os RPAs de Terceiro do sistema anterior a partir dos PDFs
RPA_N.pdf exportados pelo próprio sistema, preservando o rpa_number.
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
RPA_NUMBERS = [2, 3, 4, 5, 6, 7, 8, 9, 10]

IMPORT_USER_ID = "c0138c4d-a3fe-4fd4-bf1a-987fa606c648"
IMPORT_USER_NAME = "João Victor Pinheiro"

# Rótulos na ordem exata em que aparecem no PDF, mapeados para o campo do modelo
HEADER_LABELS = [
    ("Motorista", "driver_name"),
    ("CPF", "driver_cpf"),
    ("Telefone", "driver_phone"),
    ("Placa Cavalo", "truck_plate"),
    ("Renavan", "truck_renavam"),
    ("Proprietário", "truck_owner"),
    ("Placa Carreta", "trailer_plate"),
    ("Renavan Carreta", "trailer_renavam"),
    ("Proprietário Carreta", "trailer_owner"),
    ("Local", "service_local"),
    ("Data", "service_date"),
    ("Serviço", "service_type"),
    ("Tipo (LS/RODO)", "service_modality"),
    ("Origem", "origin"),
    ("Destino", "destination"),
    ("CTE", "cte"),
    ("Peso", "weight"),
    ("Nº Container", "container_number"),
    ("Data Coleta", "collection_date"),
    ("Data Entrega", "delivery_date"),
    ("Cliente", "client_name"),
]

REMUN_LABELS = [
    ("I. Valor do Serviço", "service_value"),
    ("II. Diárias", "daily_rate"),
    ("III. Abastecimento", "fuel"),
    ("IV. Adiantamento", "advance"),
    ("VI. Outros", "others"),
    ("Descontos", "discounts"),
]

BANK_LABELS = [
    ("Beneficiário", "bank_beneficiary"),
    ("Nº Agência", "bank_agency"),
    ("Nº Conta", "bank_account"),
    ("Chave PIX", "bank_pix"),
]

RPA_NUM_RE = re.compile(r"RPA Nº #(\d+)")
MONEY_RE = re.compile(r"R\$\s*([\d.]+,\d{2})")
DATE_BR_RE = re.compile(r"^(\d{2})/(\d{2})/(\d{4})$")


def parse_money(s: str) -> float:
    return float(s.replace(".", "").replace(",", "."))


def clean(value):
    if value is None:
        return None
    s = value.strip()
    return None if s == "" or s == "-" else s


def br_date_to_iso(value):
    v = clean(value)
    if not v:
        return None
    m = DATE_BR_RE.match(v)
    if not m:
        return v
    d, mo, y = m.groups()
    return f"{y}-{mo}-{d}"


def extract_between_labels(lines, ordered_labels, stop_label):
    """Para cada rótulo (na ordem), coleta as linhas até o próximo rótulo conhecido,
    juntando quebras de linha do valor com espaço."""
    result = {}
    label_texts = [lbl for lbl, _ in ordered_labels] + [stop_label]
    idx = 0
    n = len(lines)
    li = 0
    while li < n and lines[li] != ordered_labels[0][0]:
        li += 1
    for i, (label, field) in enumerate(ordered_labels):
        if li >= n or lines[li] != label:
            # rótulo não encontrado na posição esperada; procura à frente
            found = False
            for j in range(li, n):
                if lines[j] == label:
                    li = j
                    found = True
                    break
            if not found:
                result[field] = None
                continue
        li += 1  # pula a linha do rótulo
        next_label = ordered_labels[i + 1][0] if i + 1 < len(ordered_labels) else stop_label
        value_lines = []
        while li < n and lines[li] != next_label:
            value_lines.append(lines[li])
            li += 1
        result[field] = clean(" ".join(value_lines)) if value_lines else None
    return result, li


def parse_services(lines, start_idx, stop_label):
    """Lê pares Descrição/Valor entre 'Valor' (início) e o próximo rótulo conhecido."""
    items = []
    li = start_idx
    n = len(lines)
    desc_buffer = []
    while li < n and lines[li] != stop_label:
        line = lines[li]
        m = MONEY_RE.match(line)
        if m:
            items.append({
                "description": " ".join(desc_buffer).strip() or "-",
                "value": parse_money(m.group(1)),
            })
            desc_buffer = []
        else:
            desc_buffer.append(line)
        li += 1
    return items, li


STRAY_LINES = {"Informações do Autônomo", "Informações do Serviço Prestado"}


def parse_rpa_pdf(path: str) -> dict:
    reader = PdfReader(path)
    full_text = "\n".join(page.extract_text() for page in reader.pages)
    raw_lines = [l.strip() for l in full_text.split("\n") if l.strip()]
    lines = [
        l for l in raw_lines
        if l not in STRAY_LINES and not l.startswith("SALDO A RECEBER")
    ]

    num_match = RPA_NUM_RE.search(full_text)
    if not num_match:
        raise ValueError(f"Número do RPA não encontrado em {path}")
    rpa_number = int(num_match.group(1))

    header, li = extract_between_labels(lines, HEADER_LABELS, "Demonstrativo dos Serviços Prestados")

    # Avança até achar "Valor" (após "Descrição") para começar a ler os itens
    while li < len(lines) and lines[li] != "Valor":
        li += 1
    li += 1  # pula "Valor"

    services, li = parse_services(lines, li, "Especificação da Remuneração do Serviço")

    remun, li = extract_between_labels(lines[li:], REMUN_LABELS, "Dados Bancários do Beneficiário")
    # extract_between_labels reindexed a partir de 0; precisamos do offset real depois
    bank, _ = extract_between_labels_from_full(
        lines, "Dados Bancários do Beneficiário", BANK_LABELS, "Assinatura do Motorista/Proprietário"
    )

    data = {
        "rpa_number": rpa_number,
        **header,
        "service_date": br_date_to_iso(header.get("service_date")),
        "collection_date": br_date_to_iso(header.get("collection_date")),
        "delivery_date": br_date_to_iso(header.get("delivery_date")),
        "services": services,
        "service_value": remun.get("service_value") and parse_money_field(remun["service_value"]),
        "daily_rate": parse_money_field(remun.get("daily_rate")),
        "fuel": parse_money_field(remun.get("fuel")),
        "advance": parse_money_field(remun.get("advance")),
        "others": parse_money_field(remun.get("others")),
        "discounts": parse_money_field(remun.get("discounts")),
        **bank,
    }
    return data


def parse_money_field(value):
    if value is None:
        return 0.0
    m = MONEY_RE.search(value)
    return parse_money(m.group(1)) if m else 0.0


def extract_between_labels_from_full(all_lines, section_label, ordered_labels, stop_label):
    try:
        start = all_lines.index(section_label) + 1
    except ValueError:
        return {field: None for _, field in ordered_labels}, len(all_lines)
    return extract_between_labels(all_lines[start:], ordered_labels, stop_label)


async def import_rpas(dry_run: bool = False):
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    imported = 0
    skipped = 0
    errors = 0

    for n in RPA_NUMBERS:
        path = os.path.join(DOWNLOADS_DIR, f"RPA_{n}.pdf")
        try:
            data = parse_rpa_pdf(path)
            rpa_number = data["rpa_number"]

            existing = await db.rpa_terceiro.find_one(
                {"rpa_number": rpa_number, "$or": [{"rpa_type": "terceiro"}, {"rpa_type": {"$exists": False}}]},
                {"_id": 0, "id": 1},
            )
            if existing:
                print(f"RPA_{n}: pulando - rpa_number {rpa_number} já existe")
                skipped += 1
                continue

            doc = {
                "id": str(uuid.uuid4()),
                "rpa_number": rpa_number,
                "rpa_type": "terceiro",
                "driver_name": data.get("driver_name"),
                "driver_cpf": data.get("driver_cpf"),
                "driver_phone": data.get("driver_phone"),
                "truck_plate": data.get("truck_plate"),
                "truck_renavam": data.get("truck_renavam"),
                "truck_owner": data.get("truck_owner"),
                "trailer_plate": data.get("trailer_plate"),
                "trailer_renavam": data.get("trailer_renavam"),
                "trailer_owner": data.get("trailer_owner"),
                "service_local": data.get("service_local"),
                "service_date": data.get("service_date"),
                "service_type": data.get("service_type"),
                "service_modality": data.get("service_modality"),
                "origin": data.get("origin"),
                "destination": data.get("destination"),
                "cte": data.get("cte"),
                "weight": data.get("weight"),
                "container_number": data.get("container_number"),
                "collection_date": data.get("collection_date"),
                "delivery_date": data.get("delivery_date"),
                "client_name": data.get("client_name"),
                "services": data["services"],
                "service_value": data["service_value"],
                "daily_rate": data["daily_rate"],
                "fuel": data["fuel"],
                "advance": data["advance"],
                "others": data["others"],
                "discounts": data["discounts"],
                "bank_agency": data.get("bank_agency"),
                "bank_account": data.get("bank_account"),
                "bank_pix": data.get("bank_pix"),
                "bank_beneficiary": data.get("bank_beneficiary"),
                "observations": f"Importado do sistema anterior (RPA_{n}.pdf)",
                "created_by": IMPORT_USER_ID,
                "created_by_name": IMPORT_USER_NAME,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": None,
            }

            saldo = round(doc["service_value"] + doc["daily_rate"] + doc["fuel"] + doc["others"] - doc["advance"] - doc["discounts"], 2)

            if not dry_run:
                await db.rpa_terceiro.insert_one(doc)

            imported += 1
            print(f"RPA_{n}: importado - rpa_number={rpa_number}, motorista={doc['driver_name']}, "
                  f"itens={len(doc['services'])}, saldo_a_receber=R$ {saldo:.2f}")

        except Exception as e:
            print(f"RPA_{n}: ERRO - {e}")
            errors += 1

    print("\n" + "=" * 50)
    print("Importação concluída!" if not dry_run else "Dry-run concluído (nada foi gravado)")
    print(f"  - Importados: {imported}")
    print(f"  - Pulados (já existiam): {skipped}")
    print(f"  - Erros: {errors}")
    print("=" * 50)

    client.close()
    return imported, skipped, errors


if __name__ == "__main__":
    dry_run = "--dry-run" in sys.argv
    asyncio.run(import_rpas(dry_run=dry_run))
