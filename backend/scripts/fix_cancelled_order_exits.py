"""
Desfaz a EIR de Saída de Ordens de Carregamento que foram canceladas antes de
o sistema passar a fazer isso sozinho (30/10/2026): o container volta ao
estoque e, se estava segregado, volta a constar como Pendente de retirada.

Uso:
    python scripts/fix_cancelled_order_exits.py                 # simulação (não grava nada)
    python scripts/fix_cancelled_order_exits.py --order 1676    # só a ordem desse número
    python scripts/fix_cancelled_order_exits.py --apply         # aplica de fato
    python scripts/fix_cancelled_order_exits.py --db NOME       # só um banco

Com MULTI_TENANT ligado, percorre o banco de cada empresa do cadastro
central; senão, o DB_NAME do .env.

Mesma regra da tela: EIR faturada ou com movimentação posterior do container
fica como está e só é listada. Cada EIR apagada fica guardada na coleção
`migration_backup_cancelled_order_exits` do próprio banco.
"""
import argparse
import asyncio
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from motor.motor_asyncio import AsyncIOMotorClient

BACKUP = "migration_backup_cancelled_order_exits"


async def fix_db(db, apply: bool, order_number=None) -> int:
    query = {"status": "CANCELADA"}
    if order_number is not None:
        query["order_number"] = order_number
    total = 0
    async for order in db.loading_orders.find(query, {"_id": 0, "id": 1, "order_number": 1}):
        async for movement in db.movements.find({"loading_order_id": order["id"], "operation_type": "SAIDA"}, {"_id": 0}):
            number, transaction_id = movement["container_number"], movement["transaction_id"]
            label = f"Ordem {order['order_number']}: EIR #{transaction_id} (container {number})"
            if movement.get("billed"):
                print(f"   IGNORADA, faturada - {label}")
                continue
            last = await db.movements.find_one({"container_number": number}, {"_id": 0, "transaction_id": 1}, sort=[("created_at", -1)])
            if last and last.get("transaction_id") != transaction_id:
                print(f"   IGNORADA, tem movimentação posterior - {label}")
                continue
            print(f"   desfazer - {label}")
            total += 1
            if not apply:
                continue
            await db[BACKUP].insert_one({**movement, "backed_up_at": datetime.now(timezone.utc).isoformat()})
            await db.movements.delete_one({"id": movement["id"]})
            await db.unit_segregations.update_one(
                {"items": {"$elemMatch": {"retrieved_transaction_id": transaction_id}}},
                {"$set": {"items.$.retrieved": False, "items.$.retrieved_at": None, "items.$.retrieved_transaction_id": None}},
            )
    return total


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--db")
    parser.add_argument("--order", type=int)
    args = parser.parse_args()

    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    if args.db:
        names = [args.db]
    elif os.environ.get("MULTI_TENANT", "").strip().lower() in ("1", "true", "yes", "sim"):
        from tenants import CENTRAL_DB_NAME_DEFAULT
        central = client[os.environ.get("CENTRAL_DB_NAME", CENTRAL_DB_NAME_DEFAULT)]
        names = [t["db_name"] async for t in central.tenants.find({}, {"db_name": 1})]
    else:
        names = [os.environ["DB_NAME"]]

    print("APLICANDO" if args.apply else "SIMULAÇÃO (nada é gravado; use --apply para aplicar)")
    grand = 0
    for name in names:
        print(f"\n== banco {name}")
        grand += await fix_db(client[name], args.apply, args.order)
    print(f"\nTotal: {grand} EIR(s) {'desfeitas' if args.apply else 'a desfazer'}")


if __name__ == "__main__":
    asyncio.run(main())
