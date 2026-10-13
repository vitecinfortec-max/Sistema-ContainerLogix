from datetime import datetime, timezone
from typing import Optional, List
import io
import re

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from models import (
    Invoice, InvoiceCreate, InvoiceUpdate, InvoiceResponse, InvoiceMovementDetail, InvoiceHistory,
    InvoiceHistoryResponse
)

from shared import db, get_current_admin_user, get_company_settings, parse_datetime_value, round_money

api_router = APIRouter(prefix="/api")

# ==================== INVOICES (FATURAS) ====================

def _invoice_response(inv: dict) -> InvoiceResponse:
    """Único ponto que monta a resposta de uma fatura a partir do documento
    do banco (antes eram 4 construtores escritos à mão, campo por campo)."""
    return InvoiceResponse(
        id=inv['id'],
        invoice_number=inv['invoice_number'],
        client_name=inv['client_name'],
        client_cnpj=inv.get('client_cnpj'),
        movement_ids=inv['movement_ids'],
        total_value=inv['total_value'],
        status=inv.get('status') or 'PENDENTE',
        notes=inv.get('notes'),
        created_at=parse_datetime_value(inv['created_at']),
        user_name=inv['user_name'],
    )


# Função para obter próximo invoice_number (sequencial)
async def get_next_invoice_number():
    """Obtém o próximo invoice_number usando um contador atômico"""
    result = await db.counters.find_one_and_update(
        {"_id": "invoice_number"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    return result["seq"]

async def _release_movements(invoice_id: str):
    """Devolve (desfatura) as movimentações que uma criação de fatura chegou
    a reservar mas não concluiu."""
    await db.movements.update_many(
        {"invoice_id": invoice_id},
        {"$set": {"billed": False, "billed_at": None, "invoice_id": None}}
    )


async def sync_invoice_with_movement(movement: dict, deleted: bool, current_user: dict):
    """Mantém a fatura coerente quando uma movimentação já faturada é editada
    ou excluída por um administrador (routers/movements.py): recalcula o
    total e, na exclusão, tira a movimentação da lista da fatura - antes a
    fatura continuava com o total antigo e com o ID de uma movimentação que
    não existia mais. A fatura é localizada pela própria lista de
    movimentações, porque registros antigos perderam o invoice_id."""
    invoice = await db.invoices.find_one({"movement_ids": movement['id']}, {"_id": 0})
    if not invoice:
        return

    movement_ids = [mov_id for mov_id in invoice['movement_ids'] if not (deleted and mov_id == movement['id'])]
    remaining = await db.movements.find({"id": {"$in": movement_ids}}, {"_id": 0, "service_value": 1}).to_list(None)
    new_total = round_money(sum(m.get('service_value', 0) or 0 for m in remaining))

    changes = {}
    if deleted:
        changes['movements_removed'] = [movement['id']]
        changes['reason'] = f"Movimentação #{movement.get('transaction_id', '')} excluída"
    if new_total != invoice.get('total_value'):
        changes['total_value'] = {'from': invoice.get('total_value'), 'to': new_total}
        changes.setdefault('reason', f"Movimentação #{movement.get('transaction_id', '')} editada")
    if not changes:
        return

    await db.invoices.update_one(
        {"id": invoice['id']}, {"$set": {"movement_ids": movement_ids, "total_value": new_total}}
    )
    await log_invoice_history(
        invoice_id=invoice['id'],
        invoice_number=invoice['invoice_number'],
        action="UPDATED",
        changes=changes,
        user_id=current_user['sub'],
        user_name=current_user['name']
    )


async def find_invoice_of_movement(movement_id: str):
    return await db.invoices.find_one(
        {"movement_ids": movement_id}, {"_id": 0, "id": 1, "invoice_number": 1, "movement_ids": 1}
    )


# Função para registrar histórico de alterações
async def log_invoice_history(invoice_id: str, invoice_number: int, action: str, changes: dict, user_id: str, user_name: str):
    """Registra uma alteração no histórico da fatura"""
    history = InvoiceHistory(
        invoice_id=invoice_id,
        invoice_number=invoice_number,
        action=action,
        changes=changes,
        user_id=user_id,
        user_name=user_name
    )
    doc = history.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.invoice_history.insert_one(doc)

@api_router.post("/invoices", response_model=InvoiceResponse)
async def create_invoice(
    invoice_input: InvoiceCreate,
    current_user: dict = Depends(get_current_admin_user)
):
    """Cria uma nova fatura a partir das movimentações selecionadas"""
    
    # IDs repetidos na seleção contam uma vez só
    movement_ids = list(dict.fromkeys(invoice_input.movement_ids))
    if not movement_ids:
        raise HTTPException(status_code=400, detail="Selecione pelo menos uma movimentação")

    # Buscar movimentações pelos IDs
    movements = await db.movements.find(
        {"id": {"$in": movement_ids}},
        {"_id": 0}
    ).to_list(None)

    # Toda movimentação selecionada precisa existir - antes bastava uma
    # existir, e os IDs inexistentes ficavam gravados na fatura.
    found_ids = {m['id'] for m in movements}
    missing = [mov_id for mov_id in movement_ids if mov_id not in found_ids]
    if missing:
        raise HTTPException(
            status_code=404,
            detail=f"{len(missing)} movimentação(ões) selecionada(s) não existe(m) mais. Atualize a lista e tente novamente."
        )

    # Verificar se alguma movimentação já foi faturada
    already_billed = [m for m in movements if m.get('billed', False)]
    if already_billed:
        billed_ids = [str(m.get('transaction_id', m['id'])) for m in already_billed]
        raise HTTPException(
            status_code=400,
            detail=f"As seguintes movimentações já foram faturadas: {', '.join(billed_ids)}"
        )

    # Calcular valor total (arredondado para 2 casas decimais)
    total_value = round_money(sum(m.get('service_value', 0) or 0 for m in movements))

    # Criar a fatura
    invoice = Invoice(
        invoice_number=0,  # definido abaixo, depois de reservar as movimentações
        client_name=invoice_input.client_name,
        client_cnpj=invoice_input.client_cnpj,
        movement_ids=movement_ids,
        total_value=total_value,
        notes=invoice_input.notes,
        created_by=current_user['sub'],
        user_name=current_user['name']
    )

    # Reserva as movimentações ANTES de gravar a fatura, e só as que ainda
    # não estão faturadas (o filtro faz a checagem e a marcação num passo só
    # por documento). Se duas faturas forem geradas ao mesmo tempo com a mesma
    # movimentação, só uma consegue reservar todas - a outra desfaz o que
    # marcou e para aqui, em vez de as duas gravarem e uma sobrescrever o
    # vínculo da outra.
    billed_at = datetime.now(timezone.utc).isoformat()
    reserved = await db.movements.update_many(
        {"id": {"$in": movement_ids}, "billed": {"$ne": True}},
        {"$set": {"billed": True, "billed_at": billed_at, "invoice_id": invoice.id}}
    )
    if reserved.modified_count != len(movement_ids):
        await _release_movements(invoice.id)
        raise HTTPException(
            status_code=409,
            detail="Uma ou mais movimentações acabaram de ser faturadas em outra fatura. Atualize a lista e tente novamente."
        )

    try:
        invoice.invoice_number = await get_next_invoice_number()
        doc = invoice.model_dump()
        doc['created_at'] = doc['created_at'].isoformat()
        await db.invoices.insert_one(doc)
    except Exception:
        # A fatura não chegou a existir: devolve as movimentações.
        await _release_movements(invoice.id)
        raise

    # Registrar no histórico
    await log_invoice_history(
        invoice_id=invoice.id,
        invoice_number=invoice.invoice_number,
        action="CREATED",
        changes={
            "client_name": invoice.client_name,
            "client_cnpj": invoice.client_cnpj,
            "total_value": total_value,
            "movements_count": len(movement_ids),
            "movement_ids": movement_ids
        },
        user_id=current_user['sub'],
        user_name=current_user['name']
    )
    
    return _invoice_response(doc)

@api_router.get("/invoices", response_model=List[InvoiceResponse])
async def get_invoices(
    page: int = Query(1, ge=1),
    per_page: int = Query(15, ge=1, le=1000),
    client_name: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user)
):
    """Lista todas as faturas com paginação"""
    query = {}
    if client_name:
        query['client_name'] = {"$regex": re.escape(client_name), "$options": "i"}
    
    skip = (page - 1) * per_page
    
    invoices = await db.invoices.find(query, {"_id": 0}).sort([("created_at", -1), ("id", -1)]).skip(skip).limit(per_page).to_list(per_page)
    
    return [
        _invoice_response(inv)
        for inv in invoices
    ]

@api_router.get("/invoices/count")
async def get_invoices_count(
    client_name: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user)
):
    """Retorna a contagem total de faturas"""
    query = {}
    if client_name:
        query['client_name'] = {"$regex": re.escape(client_name), "$options": "i"}
    
    count = await db.invoices.count_documents(query)
    return {"count": count}

@api_router.get("/invoices/{invoice_id}", response_model=InvoiceResponse)
async def get_invoice(invoice_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Busca uma fatura específica por ID"""
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Fatura não encontrada")
    
    return _invoice_response(invoice)

@api_router.put("/invoices/{invoice_id}/status")
async def update_invoice_status(
    invoice_id: str,
    status: str,
    current_user: dict = Depends(get_current_admin_user)
):
    """Atualiza o status de pagamento de uma fatura (Pendente/Pago/Cancelado)"""
    if status not in ["PENDENTE", "PAGO", "CANCELADO"]:
        raise HTTPException(status_code=400, detail="Status inválido")

    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Fatura não encontrada")

    old_status = invoice.get('status', 'PENDENTE')
    await db.invoices.update_one({"id": invoice_id}, {"$set": {"status": status}})

    if old_status != status:
        await log_invoice_history(
            invoice_id=invoice_id,
            invoice_number=invoice['invoice_number'],
            action="UPDATED",
            changes={"status": {"from": old_status, "to": status}},
            user_id=current_user['sub'],
            user_name=current_user['name']
        )

    return {"message": "Status atualizado com sucesso"}

@api_router.put("/invoices/{invoice_id}", response_model=InvoiceResponse)
async def update_invoice(invoice_id: str, invoice_update: InvoiceUpdate, current_user: dict = Depends(get_current_admin_user)):
    """Atualiza uma fatura existente (dados e movimentações)"""
    # Buscar fatura existente
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Fatura não encontrada")
    
    # Preparar dados para atualização e rastrear mudanças
    update_data = {}
    changes = {}
    
    # Atualizar campos básicos se fornecidos
    if invoice_update.client_name is not None and invoice_update.client_name != invoice.get('client_name'):
        changes['client_name'] = {'from': invoice.get('client_name'), 'to': invoice_update.client_name}
        update_data['client_name'] = invoice_update.client_name
    if invoice_update.client_cnpj is not None and invoice_update.client_cnpj != invoice.get('client_cnpj'):
        changes['client_cnpj'] = {'from': invoice.get('client_cnpj'), 'to': invoice_update.client_cnpj}
        update_data['client_cnpj'] = invoice_update.client_cnpj
    if invoice_update.notes is not None and invoice_update.notes != invoice.get('notes'):
        changes['notes'] = {'from': invoice.get('notes'), 'to': invoice_update.notes}
        update_data['notes'] = invoice_update.notes
    
    # Processar movimentações. Primeiro valida o resultado final inteiro, sem
    # gravar nada; só depois aplica. Antes cada passo já gravava, e um erro no
    # meio (ex: "já faturada", "fatura ficaria vazia") deixava movimentações
    # desfaturadas sem a fatura ter sido alterada.
    invoice_movement_ids = list(invoice['movement_ids'])
    ids_to_remove = list(dict.fromkeys(invoice_update.movement_ids_to_remove or []))
    ids_to_add = [
        mov_id for mov_id in dict.fromkeys(invoice_update.movement_ids_to_add or [])
        if mov_id not in invoice_movement_ids or mov_id in ids_to_remove
    ]

    # Só dá pra tirar desta fatura o que está nela - sem isso, um ID de outra
    # fatura enviado aqui era desfaturado lá.
    foreign = [mov_id for mov_id in ids_to_remove if mov_id not in invoice_movement_ids]
    if foreign:
        raise HTTPException(status_code=400, detail="Uma ou mais movimentações a remover não pertencem a esta fatura")

    # Removida e adicionada de volta no mesmo pedido: fica como está.
    kept_both = set(ids_to_remove) & set(ids_to_add)
    ids_to_remove = [mov_id for mov_id in ids_to_remove if mov_id not in kept_both]
    ids_to_add = [mov_id for mov_id in ids_to_add if mov_id not in kept_both]

    if ids_to_add:
        movements_to_add = await db.movements.find(
            {"id": {"$in": ids_to_add}},
            {"_id": 0, "id": 1, "billed": 1, "transaction_id": 1}
        ).to_list(None)
        if len(movements_to_add) != len(ids_to_add):
            raise HTTPException(status_code=404, detail="Uma ou mais movimentações a adicionar não existem mais")
        for mov in movements_to_add:
            if mov.get('billed', False):
                raise HTTPException(
                    status_code=400,
                    detail=f"Movimentação #{mov.get('transaction_id', mov['id'])} já está faturada em outra fatura"
                )

    final_movement_ids = [mov_id for mov_id in invoice_movement_ids if mov_id not in ids_to_remove] + ids_to_add
    if not final_movement_ids:
        raise HTTPException(status_code=400, detail="A fatura deve ter pelo menos uma movimentação")

    # Validado - a partir daqui grava. As adições vêm primeiro e são
    # condicionais (mesma reserva da criação): se outra fatura pegou alguma
    # no meio do caminho, desfaz só o que esta edição marcou e nada mais mudou.
    if ids_to_add:
        billed_at = datetime.now(timezone.utc).isoformat()
        reserved = await db.movements.update_many(
            {"id": {"$in": ids_to_add}, "billed": {"$ne": True}},
            {"$set": {"billed": True, "billed_at": billed_at, "invoice_id": invoice_id}}
        )
        if reserved.modified_count != len(ids_to_add):
            await db.movements.update_many(
                {"id": {"$in": ids_to_add}, "invoice_id": invoice_id, "billed_at": billed_at},
                {"$set": {"billed": False, "billed_at": None, "invoice_id": None}}
            )
            raise HTTPException(
                status_code=409,
                detail="Uma ou mais movimentações acabaram de ser faturadas em outra fatura. Atualize a lista e tente novamente."
            )
        changes['movements_added'] = ids_to_add

    if ids_to_remove:
        await db.movements.update_many(
            {"id": {"$in": ids_to_remove}},
            {"$set": {"billed": False, "billed_at": None, "invoice_id": None}}
        )
        changes['movements_removed'] = ids_to_remove

    # Atualizar lista de movimentações
    update_data['movement_ids'] = final_movement_ids

    # Recalcular valor total (arredondado para 2 casas decimais)
    movements = await db.movements.find(
        {"id": {"$in": final_movement_ids}},
        {"_id": 0, "service_value": 1}
    ).to_list(None)
    new_total = round_money(sum(m.get('service_value', 0) or 0 for m in movements))

    if new_total != invoice.get('total_value'):
        changes['total_value'] = {'from': invoice.get('total_value'), 'to': new_total}
    update_data['total_value'] = new_total

    # Aplicar atualização
    await db.invoices.update_one({"id": invoice_id}, {"$set": update_data})
    
    # Registrar no histórico se houve mudanças
    if changes:
        await log_invoice_history(
            invoice_id=invoice_id,
            invoice_number=invoice['invoice_number'],
            action="UPDATED",
            changes=changes,
            user_id=current_user['sub'],
            user_name=current_user['name']
        )
    
    # Buscar fatura atualizada
    updated_invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    
    return _invoice_response(updated_invoice)

@api_router.get("/invoices/{invoice_id}/movements", response_model=List[InvoiceMovementDetail])
async def get_invoice_movements(invoice_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Retorna detalhes das movimentações de uma fatura"""
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Fatura não encontrada")
    
    movements = await db.movements.find(
        {"id": {"$in": invoice['movement_ids']}},
        {"_id": 0}
    ).to_list(None)
    
    return [
        InvoiceMovementDetail(
            id=m['id'],
            transaction_id=m.get('transaction_id', 0),
            container_number=m['container_number'],
            operation_type=m['operation_type'],
            service_type=m.get('service_type'),
            service_value=m.get('service_value'),
            created_at=parse_datetime_value(m['created_at'])
        )
        for m in movements
    ]

@api_router.get("/invoices/{invoice_id}/pdf")
async def download_invoice_pdf(invoice_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Gera PDF da fatura para download"""
    from reports import generate_invoice_pdf
    
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Fatura não encontrada")
    
    movements = await db.movements.find(
        {"id": {"$in": invoice['movement_ids']}},
        {"_id": 0}
    ).to_list(None)
    
    company = await get_company_settings()
    pdf_buffer = generate_invoice_pdf(invoice, movements, company=company)

    filename = f"fatura_{invoice['invoice_number']}.pdf"
    
    return StreamingResponse(
        io.BytesIO(pdf_buffer),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@api_router.get("/invoices/{invoice_id}/excel")
async def download_invoice_excel(invoice_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Gera Excel da fatura para download"""
    from reports import generate_invoice_excel
    
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Fatura não encontrada")
    
    movements = await db.movements.find(
        {"id": {"$in": invoice['movement_ids']}},
        {"_id": 0}
    ).to_list(None)
    
    company = await get_company_settings()
    excel_buffer = generate_invoice_excel(invoice, movements, company=company)

    filename = f"fatura_{invoice['invoice_number']}.xlsx"
    
    return StreamingResponse(
        io.BytesIO(excel_buffer),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@api_router.delete("/invoices/{invoice_id}")
async def delete_invoice(invoice_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Exclui uma fatura e desmarca as movimentações como faturadas"""
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Fatura não encontrada")
    
    # Registrar no histórico antes de deletar
    await log_invoice_history(
        invoice_id=invoice_id,
        invoice_number=invoice['invoice_number'],
        action="DELETED",
        changes={
            "client_name": invoice.get('client_name'),
            "total_value": invoice.get('total_value'),
            "movements_count": len(invoice.get('movement_ids', []))
        },
        user_id=current_user['sub'],
        user_name=current_user['name']
    )
    
    # Desmarcar movimentações como faturadas
    await db.movements.update_many(
        {"id": {"$in": invoice['movement_ids']}},
        {"$set": {"billed": False, "billed_at": None}, "$unset": {"invoice_id": ""}}
    )
    
    # Excluir a fatura
    await db.invoices.delete_one({"id": invoice_id})
    
    return {"message": "Fatura excluída com sucesso"}

@api_router.get("/invoices/{invoice_id}/history", response_model=List[InvoiceHistoryResponse])
async def get_invoice_history(invoice_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Retorna o histórico de alterações de uma fatura"""
    history = await db.invoice_history.find(
        {"invoice_id": invoice_id},
        {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    
    return [
        InvoiceHistoryResponse(
            id=h['id'],
            invoice_id=h['invoice_id'],
            invoice_number=h['invoice_number'],
            action=h['action'],
            changes=h['changes'],
            user_name=h['user_name'],
            created_at=datetime.fromisoformat(h['created_at'])
        )
        for h in history
    ]

