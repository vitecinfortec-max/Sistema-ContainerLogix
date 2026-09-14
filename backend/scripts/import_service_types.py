"""
Cadastra os 563 nomes de serviço de reparo M&R (já importados localmente em
container_repair_services, ver import_container_repair_services.py) também no
cadastro genérico "Tipos de Serviço" (service_types) de uma base de destino -
tipicamente uma instância de produção diferente da base local.

Lê a lista de nomes da base LOCAL (MONGO_URL/DB_NAME do backend/.env).
Grava na base de DESTINO informada via --target-mongo-url/--target-db-name -
essa credencial nunca é persistida em disco, só usada em memória durante a
execução do script.

Idempotente: só insere na base de destino os nomes que ainda não existem em
service_types lá (comparação por nome).

Uso:
    python import_service_types.py --target-mongo-url "..." --target-db-name "..."            # dry-run
    python import_service_types.py --target-mongo-url "..." --target-db-name "..." --apply     # grava de fato
"""
import sys
import os
import uuid
import asyncio
import argparse
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--target-mongo-url", required=True, help="MONGO_URL da base de destino (produção)")
    parser.add_argument("--target-db-name", required=True, help="Nome do banco na base de destino")
    parser.add_argument("--apply", action="store_true", help="Grava no banco de destino (sem essa flag, só mostra o que seria feito)")
    args = parser.parse_args()

    local_client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    local_db = local_client[os.environ["DB_NAME"]]

    names = []
    async for doc in local_db.container_repair_services.find({}, {"_id": 0, "name": 1}).sort("name", 1):
        names.append(doc["name"])

    print(f"{len(names)} serviços encontrados em container_repair_services (base local).")

    target_client = AsyncIOMotorClient(args.target_mongo_url)
    target_db = target_client[args.target_db_name]

    existing = set()
    async for doc in target_db.service_types.find({}, {"_id": 0, "name": 1}):
        existing.add(doc["name"])
    print(f"{len(existing)} já cadastrados em service_types na base de destino.")

    new_names = [n for n in names if n not in existing]
    print(f"{len(new_names)} novos tipos de serviço a inserir.")

    if not args.apply:
        print("Dry-run - nenhuma gravação feita. Rode de novo com --apply para gravar.")
        return

    if not new_names:
        print("Nada a inserir.")
        return

    now = datetime.now(timezone.utc).isoformat()
    docs = [
        {"id": str(uuid.uuid4()), "name": n, "description": None, "created_at": now, "created_by": "import-script"}
        for n in new_names
    ]
    await target_db.service_types.insert_many(docs)
    print(f"{len(docs)} tipos de serviço inseridos com sucesso na base de destino.")


if __name__ == "__main__":
    asyncio.run(main())
