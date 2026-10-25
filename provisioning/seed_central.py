#!/usr/bin/env python3
"""
Multi-cliente, Etapa 1: cria o banco central (containerlogix_central) com o
cadastro das empresas que já existem, apontando para os bancos ATUAIS delas.

- Só grava no banco central. Nos bancos das empresas apenas LÊ (confere que
  existem e mostra quantos usuários/registros têm, para conferência).
- Por padrão só simula. Grava somente com --aplicar.
- Pode rodar de novo: empresa já cadastrada não é alterada.

Uso (a conexão do Atlas vem do painel do Render, nunca fica em arquivo):
    MONGO_URL="mongodb+srv://..." python provisioning/seed_central.py
    MONGO_URL="mongodb+srv://..." python provisioning/seed_central.py --aplicar
"""
import argparse
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

from tenants import CENTRAL_DB_NAME_DEFAULT, TenantCreate, ensure_central_indexes, list_tenants, register_tenant  # noqa: E402

# As empresas de hoje. Os endereços *.containerlogix.com.br só passam a
# funcionar depois do DNS curinga (Etapa 3); os endereços antigos ficam
# cadastrados para a mesma empresa continuar sendo reconhecida por eles.
TENANTS = [
    TenantCreate(
        slug="teste", name="Ambiente de Teste", db_name="containerlogix",
        hosts=["teste.containerlogix.com.br", "containerlogix.com.br", "www.containerlogix.com.br"],
        notes="Ambiente de teste e homologação de novos módulos",
        legacy_frontend_url="https://containerlogix.com.br",
    ),
    TenantCreate(
        slug="ja", name="J.A Logística", db_name="containerlogix_jalogistica",
        hosts=["ja.containerlogix.com.br", "containerlogix-jalogistica.vercel.app"],
        legacy_backend_url="https://containerlogix-jalogistica-backend.onrender.com",
        legacy_frontend_url="https://containerlogix-jalogistica.vercel.app",
    ),
    TenantCreate(
        slug="tll", name="TLL Containers", db_name="containerlogix_tll-containers",
        hosts=["tll.containerlogix.com.br", "containerlogix-tll-containers.vercel.app"],
        legacy_backend_url="https://containerlogix-tll-containers-backend.onrender.com",
        legacy_frontend_url="https://containerlogix-tll-containers.vercel.app",
    ),
]


async def main(apply: bool):
    mongo_url = os.environ.get("MONGO_URL")
    if not mongo_url:
        sys.exit("Defina MONGO_URL com a conexão do Atlas (painel do Render -> Environment).")
    central_name = os.environ.get("CENTRAL_DB_NAME", CENTRAL_DB_NAME_DEFAULT)
    client = AsyncIOMotorClient(mongo_url)
    existing_dbs = set(await client.list_database_names())

    print(f"Banco central: {central_name} ({'já existe' if central_name in existing_dbs else 'será criado'})")
    print(f"Modo: {'APLICAR' if apply else 'simulação (nada é gravado)'}\n")

    problems = []
    for t in TENANTS:
        if t.db_name not in existing_dbs:
            problems.append(f"banco {t.db_name} ({t.name}) não existe no cluster")
            print(f"[{t.slug}] {t.name}: banco {t.db_name} NÃO ENCONTRADO")
            continue
        db = client[t.db_name]
        users = await db.users.count_documents({})
        movements = await db.movements.count_documents({})
        print(f"[{t.slug}] {t.name}: banco {t.db_name} ok - {users} usuário(s), {movements} movimentação(ões)")
        print(f"        endereços: {', '.join(t.hosts)}")
    if problems:
        sys.exit("\nNada foi gravado: " + "; ".join(problems))

    if not apply:
        print("\nSimulação concluída. Rode com --aplicar para gravar no banco central.")
        return

    central = client[central_name]
    await ensure_central_indexes(central)
    for t in TENANTS:
        result = await register_tenant(central, t)
        print(f"[{t.slug}] {'cadastrada' if result['created'] else 'já estava cadastrada (não alterada)'}")
    print("\nEmpresas no banco central:")
    for t in await list_tenants(central):
        print(f"  {t['slug']:<8} {t['name']:<22} -> {t['db_name']}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--aplicar", action="store_true", help="grava no banco central (sem isso, só simula)")
    asyncio.run(main(parser.parse_args().aplicar))
