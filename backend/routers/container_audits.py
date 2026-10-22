from datetime import datetime, timezone
import uuid

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from list_filters import combine, period_query, text_query
from fastapi.responses import StreamingResponse
import io

from models import (
    ContainerAudit, ContainerAuditCreate, ContainerAuditItemUpdate, ContainerAuditResponse,
    AuditedContainerItem
)
from shared import (
    db, get_current_active_user, get_company_settings, parse_datetime_value,
    validate_and_read_upload, ALLOWED_EXTENSIONS, UPLOADS_DIR,
)
from reports import now_brt, generate_container_audit_pdf
from container_ocr import format_container_number, read_container_photo
from routers.movements import in_stock_movements

api_router = APIRouter(prefix="/api")


async def get_next_audit_number():
    """Sequencial mensal (reinicia em 1 a cada mês), formatado AAAAMM-NNNN."""
    now = now_brt()
    period = f"{now.year}{now.month:02d}"
    counter = await db.counters.find_one_and_update(
        {"_id": f"audit_number_{period}"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    return counter["seq"], f"{period}-{counter['seq']:04d}"


async def _get_expected_stock_for_client(client_name: str) -> list:
    """Estoque esperado calculado pela última movimentação de cada container
    (ENTRADA = em estoque), independente da lógica de contagem entradas>saídas
    usada em _get_current_stock_movements (que tem um bug de contagem conhecido).
    ContainerMovement não tem client_id (só client_name como texto livre) - o
    filtro por cliente é feito por nome exato, sem diferenciar maiúsculas/
    minúsculas, igual ao que já é feito em _get_current_stock_movements."""
    lean = await db.movements.find(
        {}, {"_id": 0, "id": 1, "transaction_id": 1, "container_number": 1, "operation_type": 1,
             "created_at": 1, "client_name": 1, "size_type": 1,
             "shipping_line": 1, "booking": 1}
    ).to_list(None)
    target = (client_name or '').strip().lower()
    return [m for m in in_stock_movements(lean) if (m.get('client_name') or '').strip().lower() == target]


@api_router.get("/container-audits")
async def list_container_audits(
    page: int = 1,
    per_page: int = 20,
    search: Optional[str] = None,
    status: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user)
):
    """Lista as auditorias de estoque. Busca (código, cliente, container) e
    período rodam no banco - antes a busca só olhava a página aberta."""
    skip = (page - 1) * per_page
    query = combine(
        text_query(("audit_code", "client_name", "items.container_number"), search),
        {"status": status} if status else {},
        period_query("created_at", date_from, date_to),
    )

    total = await db.container_audits.count_documents(query)
    audits = await db.container_audits.find(query, {"_id": 0}).sort("created_at", -1).skip(skip).limit(per_page).to_list(per_page)

    return {
        "items": audits,
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": (total + per_page - 1) // per_page
    }


@api_router.get("/container-audits/{audit_id}", response_model=ContainerAuditResponse)
async def get_container_audit(audit_id: str, current_user: dict = Depends(get_current_active_user)):
    """Obtém uma auditoria de estoque pelo ID"""
    audit = await db.container_audits.find_one({"id": audit_id}, {"_id": 0})
    if not audit:
        raise HTTPException(status_code=404, detail="Auditoria não encontrada")
    return ContainerAuditResponse(**audit)


@api_router.post("/container-audits", response_model=ContainerAuditResponse)
async def create_container_audit(
    data: ContainerAuditCreate,
    current_user: dict = Depends(get_current_active_user)
):
    """Cria uma nova auditoria de estoque para um cliente, já com o snapshot do
    que consta em estoque para ele (última movimentação = ENTRADA)."""
    client = await db.clients.find_one({"id": data.client_id}, {"_id": 0, "name": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")

    expected_stock = await _get_expected_stock_for_client(client['name'])

    items = [
        AuditedContainerItem(
            container_number=m['container_number'],
            expected=True,
            status="PENDENTE",
            transaction_id=m.get('transaction_id'),
            size_type=m.get('size_type'),
            shipping_line=m.get('shipping_line'),
            booking=m.get('booking'),
            entry_date=parse_datetime_value(m['created_at']),
        )
        for m in expected_stock
    ]

    audit_seq, audit_code = await get_next_audit_number()

    audit = ContainerAudit(
        audit_seq=audit_seq,
        audit_code=audit_code,
        client_id=data.client_id,
        client_name=client['name'],
        items=items,
        created_by=current_user["sub"],
        created_by_name=current_user["name"],
    )

    audit_dict = audit.model_dump(mode="json")
    await db.container_audits.insert_one(audit_dict)

    return ContainerAuditResponse(**audit_dict)


_ITEM_STATUSES = {"PENDENTE", "CONFIRMADO", "FALTANTE", "NAO_ESPERADO"}
_OPEN = {"status": "EM_ANDAMENTO"}


async def _open_audit(audit_id: str) -> dict:
    audit = await db.container_audits.find_one({"id": audit_id}, {"_id": 0})
    if not audit:
        raise HTTPException(status_code=404, detail="Auditoria não encontrada")
    if audit["status"] == "CONCLUIDA":
        raise HTTPException(status_code=400, detail="Auditoria já concluída, não pode ser alterada")
    return audit


def _find_item(audit: dict, container_number: str) -> Optional[dict]:
    """Acha o item pelo número já padronizado - snapshots antigos podem ter
    o número gravado sem o traço do dígito verificador."""
    target = format_container_number(container_number)
    return next(
        (i for i in audit.get("items", []) if format_container_number(i["container_number"]) == target),
        None,
    )


def _remove_photo_file(photo: Optional[dict]):
    url = (photo or {}).get("url") or ""
    prefix = "/api/uploads/"
    if not url.startswith(prefix):
        return
    target = (UPLOADS_DIR / url[len(prefix):]).resolve()
    if UPLOADS_DIR.resolve() in target.parents:
        target.unlink(missing_ok=True)


async def _updated_audit(audit_id: str, result) -> ContainerAuditResponse:
    # As gravações filtram por EM_ANDAMENTO: concluída entre a leitura e a gravação
    if result.matched_count == 0:
        raise HTTPException(status_code=409, detail="A auditoria foi concluída ou alterada por outra pessoa, recarregue a tela")
    updated = await db.container_audits.find_one({"id": audit_id}, {"_id": 0})
    return ContainerAuditResponse(**updated)


@api_router.put("/container-audits/{audit_id}/items", response_model=ContainerAuditResponse)
async def update_container_audit_item(
    audit_id: str,
    data: ContainerAuditItemUpdate,
    current_user: dict = Depends(get_current_active_user)
):
    """Atualiza a situação de um container já esperado, ou registra um container
    encontrado no pátio que não estava na lista esperada (NAO_ESPERADO)."""
    if data.status not in _ITEM_STATUSES:
        raise HTTPException(status_code=400, detail="Situação inválida")
    number = format_container_number(data.container_number)
    if not number:
        raise HTTPException(status_code=400, detail="Informe o número do container")
    audit = await _open_audit(audit_id)
    item = _find_item(audit, number)

    # Altera só o item (operador posicional) ou acrescenta com $push - regravar
    # a lista inteira fazia uma observação e uma foto salvas ao mesmo tempo
    # (ou duas pessoas auditando juntas) apagarem uma à outra.
    now = datetime.now(timezone.utc).isoformat()
    if item:
        status = data.status
        if item["expected"]:
            # Digitado como "encontrado no pátio", mas estava na lista: foi
            # encontrado, então é Confirmado (antes virava Não Esperado)
            if status == "NAO_ESPERADO":
                status = "CONFIRMADO"
        else:
            status = "NAO_ESPERADO"
        item_set = {"items.$.status": status, "updated_at": now}
        if data.observations is not None:
            item_set["items.$.observations"] = data.observations
        if data.size_type and not item.get("size_type"):
            item_set["items.$.size_type"] = data.size_type
        result = await db.container_audits.update_one(
            {"id": audit_id, **_OPEN, "items.container_number": item["container_number"]},
            {"$set": item_set}
        )
        return await _updated_audit(audit_id, result)

    # Fora da lista só pode ser Não Esperado, seja qual for a situação enviada
    new_item = AuditedContainerItem(
        container_number=number,
        expected=False,
        status="NAO_ESPERADO",
        size_type=data.size_type,
        observations=data.observations,
    ).model_dump(mode="json")
    result = await db.container_audits.update_one(
        {"id": audit_id, **_OPEN, "items.container_number": {"$ne": number}},
        {"$push": {"items": new_item}, "$set": {"updated_at": now}}
    )
    return await _updated_audit(audit_id, result)


@api_router.delete("/container-audits/{audit_id}/items/{container_number}", response_model=ContainerAuditResponse)
async def delete_container_audit_item(
    audit_id: str,
    container_number: str,
    current_user: dict = Depends(get_current_active_user)
):
    """Remove um container Não Esperado lançado por engano (os esperados
    vêm do estoque e não saem da lista - marque como Faltante)."""
    audit = await _open_audit(audit_id)
    item = _find_item(audit, container_number)
    if not item:
        raise HTTPException(status_code=404, detail="Container não encontrado nesta auditoria")
    if item["expected"]:
        raise HTTPException(status_code=400, detail="Container esperado não pode ser removido, marque como Faltante")
    result = await db.container_audits.update_one(
        {"id": audit_id, **_OPEN},
        {"$pull": {"items": {"container_number": item["container_number"], "expected": False}},
         "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    response = await _updated_audit(audit_id, result)
    _remove_photo_file(item.get("photo"))
    return response


@api_router.post("/container-audits/{audit_id}/items/{container_number}/photo")
async def upload_container_audit_photo(
    audit_id: str,
    container_number: str,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_active_user)
):
    """Faz upload da foto de um container auditado (a nova substitui a anterior)"""
    audit = await _open_audit(audit_id)
    item = _find_item(audit, container_number)
    if not item:
        raise HTTPException(status_code=404, detail="Container não encontrado nesta auditoria")

    file_ext, content = await validate_and_read_upload(file, ALLOWED_EXTENSIONS)

    photo_dir = UPLOADS_DIR / "container_audits" / audit_id
    photo_dir.mkdir(parents=True, exist_ok=True)

    photo_id = str(uuid.uuid4())
    file_path = photo_dir / f"{photo_id}{file_ext}"
    with open(file_path, "wb") as buffer:
        buffer.write(content)

    photo_url = f"/api/uploads/container_audits/{audit_id}/{photo_id}{file_ext}"
    photo = {"id": photo_id, "url": photo_url}

    result = await db.container_audits.update_one(
        {"id": audit_id, **_OPEN, "items.container_number": item["container_number"]},
        {"$set": {"items.$.photo": photo, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    if result.matched_count == 0:
        file_path.unlink(missing_ok=True)
        raise HTTPException(status_code=409, detail="A auditoria foi concluída ou alterada por outra pessoa, recarregue a tela")
    # A foto anterior ficava no disco para sempre ao ser substituída
    _remove_photo_file(item.get("photo"))

    return photo


@api_router.delete("/container-audits/{audit_id}/items/{container_number}/photo", response_model=ContainerAuditResponse)
async def delete_container_audit_photo(
    audit_id: str,
    container_number: str,
    current_user: dict = Depends(get_current_active_user)
):
    audit = await _open_audit(audit_id)
    item = _find_item(audit, container_number)
    if not item or not item.get("photo"):
        raise HTTPException(status_code=404, detail="Foto não encontrada")
    result = await db.container_audits.update_one(
        {"id": audit_id, **_OPEN, "items.container_number": item["container_number"]},
        {"$set": {"items.$.photo": None, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    response = await _updated_audit(audit_id, result)
    _remove_photo_file(item["photo"])
    return response


@api_router.post("/container-audits/{audit_id}/scan")
async def scan_container_audit_photo(
    audit_id: str,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_active_user)
):
    """Lê o número e o tamanho/tipo do container na foto. Não grava nada: a
    tela mostra a leitura pro auditor conferir e então lança a situação e a
    foto pelos endpoints de item."""
    audit = await _open_audit(audit_id)
    file_ext, content = await validate_and_read_upload(file, ALLOWED_EXTENSIONS)
    reading = await read_container_photo(content, file_ext)
    item = _find_item(audit, reading["container_number"]) if reading["found"] else None
    reading["match"] = (
        {"container_number": item["container_number"], "expected": item["expected"], "status": item["status"]}
        if item else None
    )
    return reading


@api_router.post("/container-audits/{audit_id}/complete", response_model=ContainerAuditResponse)
async def complete_container_audit(
    audit_id: str,
    current_user: dict = Depends(get_current_active_user)
):
    """Conclui a auditoria: containers esperados que ficaram PENDENTE viram
    FALTANTE (não foram confirmados = não foram encontrados no pátio)."""
    audit = await db.container_audits.find_one({"id": audit_id}, {"_id": 0, "status": 1})
    if not audit:
        raise HTTPException(status_code=404, detail="Auditoria não encontrada")
    # Altera só os itens pendentes, no próprio banco: regravar a lista lida
    # antes apagava foto/observação salva no mesmo instante por outra pessoa,
    # e o filtro por EM_ANDAMENTO impede concluir duas vezes
    now = datetime.now(timezone.utc).isoformat()
    result = await db.container_audits.update_one(
        {"id": audit_id, **_OPEN},
        {"$set": {"items.$[pending].status": "FALTANTE", "status": "CONCLUIDA", "completed_at": now, "updated_at": now}},
        array_filters=[{"pending.status": "PENDENTE"}],
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=400, detail="Auditoria já concluída")
    updated = await db.container_audits.find_one({"id": audit_id}, {"_id": 0})
    return ContainerAuditResponse(**updated)


@api_router.get("/container-audits/{audit_id}/pdf")
async def download_container_audit_pdf(
    audit_id: str,
    current_user: dict = Depends(get_current_active_user)
):
    """Gera o PDF da auditoria (com código de barras do audit_code)"""
    audit = await db.container_audits.find_one({"id": audit_id}, {"_id": 0})
    if not audit:
        raise HTTPException(status_code=404, detail="Auditoria não encontrada")

    company = await get_company_settings()
    pdf_bytes = generate_container_audit_pdf(audit, company=company)

    filename = f"Auditoria_{audit['audit_code']}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


@api_router.delete("/container-audits/{audit_id}")
async def delete_container_audit(
    audit_id: str,
    current_user: dict = Depends(get_current_active_user)
):
    """Exclui uma auditoria - só permitido enquanto ainda está em andamento"""
    audit = await db.container_audits.find_one({"id": audit_id}, {"_id": 0})
    if not audit:
        raise HTTPException(status_code=404, detail="Auditoria não encontrada")
    if audit["status"] == "CONCLUIDA":
        raise HTTPException(status_code=400, detail="Auditoria concluída não pode ser excluída")

    import shutil
    photo_dir = UPLOADS_DIR / "container_audits" / audit_id
    if photo_dir.exists():
        shutil.rmtree(photo_dir, ignore_errors=True)

    await db.container_audits.delete_one({"id": audit_id})

    return {"message": "Auditoria excluída com sucesso"}
