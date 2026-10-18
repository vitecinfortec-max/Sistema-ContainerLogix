"""
Devolve para Disponivel as Compras de Container que ficaram marcadas como
Vendido sem nenhuma venda. Antes da auditoria da Gestao de Container, excluir
um Registro de Venda (ou uma Ordem de Entrega) nao desfazia o vinculo, e a
compra ficava Vendida para sempre: o container nao podia mais ser vendido
pelo sistema.

Uso:
    python fix_container_purchases_sem_venda.py           # dry-run (nao grava nada)
    python fix_container_purchases_sem_venda.py --apply    # aplica de fato

O que corrige (com --apply):
  1. Compra "VENDIDO" cuja venda nao existe mais (sale_id aponta pra uma
     venda apagada) ou sem sale_id e sem nenhuma venda apontando pra ela
     -> volta a "DISPONIVEL" (sale_id e sold_at apagados).
  2. Venda cujo purchase_id aponta pra uma compra que nao existe mais
     -> purchase_id apagado (Booking/Terminal/Data de Entrada copiados
     ficam como estao).

O que so lista, sem mexer (precisa de olho humano):
  - Compra "VENDIDO" cuja venda existe mas aponta pra outra compra (ou pra
    nenhuma).
  - Container que ficaria com mais de uma Compra Disponivel depois da
    correcao (a proxima venda vincula a mais recente).

Antes de gravar, salva um backup em JSON dos documentos que vai alterar,
na mesma pasta deste script.
"""
import asyncio
import json
import os
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from motor.motor_asyncio import AsyncIOMotorClient


def describe_purchase(p):
    origem = f"Ordem #{p.get('order_number')}" if p.get('loading_order_id') else "Manual"
    return f"{p.get('container_number')}  ({origem}, compra {p['id'][:8]}...)"


async def main():
    apply_changes = "--apply" in sys.argv

    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    sales = await db.container_sales.find({}, {"_id": 0}).to_list(None)
    sales_by_id = {s['id']: s for s in sales}
    sales_by_purchase = {}
    for s in sales:
        if s.get('purchase_id'):
            sales_by_purchase.setdefault(s['purchase_id'], []).append(s)

    purchases = await db.container_purchases.find({}, {"_id": 0}).to_list(None)
    purchase_ids = {p['id'] for p in purchases}

    to_release = []      # compras Vendidas sem venda
    to_review = []       # compras Vendidas com vinculo inconsistente
    for p in purchases:
        if p.get('status') != 'VENDIDO':
            continue
        sale = sales_by_id.get(p.get('sale_id')) if p.get('sale_id') else None
        if sale:
            if sale.get('purchase_id') != p['id']:
                to_review.append((p, f"a venda {sale['id'][:8]}... aponta pra outra compra"))
            continue
        if p.get('sale_id'):
            to_release.append((p, "a venda vinculada foi excluida"))
        elif sales_by_purchase.get(p['id']):
            to_review.append((p, "sem sale_id, mas ha venda apontando pra ela"))
        else:
            to_release.append((p, "sem venda vinculada"))

    to_unlink = [s for s in sales if s.get('purchase_id') and s['purchase_id'] not in purchase_ids]

    # Containers que ficariam com mais de uma compra Disponivel
    available = Counter(p['container_number'] for p in purchases if p.get('status') == 'DISPONIVEL')
    available.update(p['container_number'] for p, _ in to_release)
    duplicated = sorted(c for c, n in available.items() if n > 1)

    print(f"=== {'APLICANDO' if apply_changes else 'DRY-RUN (nada sera gravado)'} ===\n")

    print(f"[1] Compras Vendidas sem venda -> voltam a Disponivel: {len(to_release)}")
    for p, reason in to_release:
        print(f"    {describe_purchase(p)} - {reason}")

    print(f"\n[2] Vendas apontando pra compra que nao existe -> perdem o vinculo: {len(to_unlink)}")
    for s in to_unlink:
        print(f"    {s.get('container_number')}  (venda {s['id'][:8]}...)")

    print(f"\n[!] Para revisar a mao (nao sera alterado): {len(to_review)}")
    for p, reason in to_review:
        print(f"    {describe_purchase(p)} - {reason}")

    if duplicated:
        print(f"\n[!] Containers que ficarao com mais de uma Compra Disponivel ({len(duplicated)}):")
        for c in duplicated:
            print(f"    {c}")
        print("    A proxima venda desses containers vincula a compra mais recente; exclua a que sobrar, se for o caso.")

    if apply_changes and (to_release or to_unlink):
        backup = Path(__file__).resolve().parent / f"backup_compras_sem_venda_{datetime.now():%Y%m%d_%H%M%S}.json"
        backup.write_text(json.dumps({
            "purchases": [p for p, _ in to_release],
            "sales": to_unlink,
        }, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
        print(f"\nBackup salvo em: {backup}")

        for p, _ in to_release:
            # So mexe se ainda estiver como foi lido (ninguem vendeu nesse meio tempo)
            await db.container_purchases.update_one(
                {"id": p['id'], "status": "VENDIDO", "sale_id": p.get('sale_id')},
                {"$set": {"status": "DISPONIVEL", "sold_at": None, "sale_id": None}},
            )
        for s in to_unlink:
            await db.container_sales.update_one(
                {"id": s['id'], "purchase_id": s['purchase_id']}, {"$set": {"purchase_id": None}},
            )
        print("Correcoes aplicadas.")
    elif not apply_changes:
        print("\nNada foi gravado - rode com --apply para aplicar de fato.")
    else:
        print("\nNada a corrigir.")

    client.close()


if __name__ == "__main__":
    asyncio.run(main())
