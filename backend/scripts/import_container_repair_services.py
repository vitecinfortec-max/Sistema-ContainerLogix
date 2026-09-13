"""
Importa os nomes de serviço da planilha "Tabela de Serviços e Preços" (coluna
"Serviço") para o catálogo container_repair_services, usado no campo "Tipo de
Serviços" da Vistoria de Container (dentro de Novo/Editar Movimentação). Só o
nome do serviço é importado - Categoria/Material/Adicional/Valor Atualizado
ficam de fora, não fazem parte do fluxo de vistoria.

Idempotente: só insere os nomes que ainda não existem em container_repair_services.

Uso:
    python import_container_repair_services.py <caminho_da_planilha.xlsx>            # dry-run
    python import_container_repair_services.py <caminho_da_planilha.xlsx> --apply     # grava de fato
"""
import sys
import os
import uuid
import asyncio
import argparse
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import openpyxl
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("xlsx_path")
    parser.add_argument("--apply", action="store_true", help="Grava no banco (sem essa flag, só mostra o que seria feito)")
    args = parser.parse_args()

    wb = openpyxl.load_workbook(args.xlsx_path, data_only=True)
    ws = wb.active

    names = []
    seen = set()
    for row in ws.iter_rows(min_row=2, values_only=True):
        servico = row[2] if len(row) > 2 else None
        if servico is None:
            continue
        name = str(servico).strip()
        if name and name not in seen:
            seen.add(name)
            names.append(name)

    print(f"{len(names)} serviços distintos encontrados na coluna 'Serviço' da planilha.")

    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ["DB_NAME"]
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    existing = set()
    async for doc in db.container_repair_services.find({}, {"_id": 0, "name": 1}):
        existing.add(doc["name"])
    print(f"{len(existing)} já cadastrados no banco.")

    new_names = [n for n in names if n not in existing]
    print(f"{len(new_names)} novos serviços a inserir.")

    if not args.apply:
        print("Dry-run - nenhuma gravação feita. Rode de novo com --apply para gravar.")
        return

    if not new_names:
        print("Nada a inserir.")
        return

    now = datetime.now(timezone.utc).isoformat()
    docs = [
        {"id": str(uuid.uuid4()), "name": n, "created_at": now, "created_by": "import-script"}
        for n in new_names
    ]
    await db.container_repair_services.insert_many(docs)
    print(f"{len(docs)} serviços inseridos com sucesso.")


if __name__ == "__main__":
    asyncio.run(main())
