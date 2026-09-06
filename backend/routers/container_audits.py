from datetime import datetime, timezone
from typing import Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
import io

from models import (
    ContainerAudit, ContainerAuditCreate, ContainerAuditItemUpdate, ContainerAuditResponse,
    AuditedContainerItem, AuditedContainerPhoto,
)
from shared import (
    db, get_current_active_user, get_company_settings, parse_datetime_value,
    validate_and_read_upload, ALLOWED_EXTENSIONS, UPLOADS_DIR,
)
from reports import now_brt, generate_container_audit_pdf

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
    last_by_container = {}
    for m in sorted(lean, key=lambda x: parse_datetime_value(x['created_at'])):
        last_by_container[m['container_number']] = m
    target = (client_name or '').strip().lower()
    return [
        m for m in last_by_container.values()
        if m['operation_type'] == 'ENTRADA' and (m.get('client_name') or '').strip().lower() == target
    ]


@api_router.get("/container-audits")
async def list_container_audits(
    page: int = 1,
    per_page: int = 20,
    current_user: dict = Depends(get_current_active_user)
):
    """Lista todas as auditorias de estoque"""
    skip = (page - 1) * per_page

    total = await db.container_audits.count_documents({})
    audits = await db.container_audits.find({}, {"_id": 0}).sort("created_at", -1).skip(skip).limit(per_page).to_list(per_page)

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


@api_router.put("/container-audits/{audit_id}/items", response_model=ContainerAuditResponse)
async def update_container_audit_item(
    audit_id: str,
    data: ContainerAuditItemUpdate,
    current_user: dict = Depends(get_current_active_user)
):
    """Atualiza a situação de um container já esperado, ou registra um container
    encontrado no pátio que não estava na lista esperada (NAO_ESPERADO)."""
    audit = await db.container_audits.find_one({"id": audit_id}, {"_id": 0})
    if not audit:
        raise HTTPException(status_code=404, detail="Auditoria não encontrada")
    if audit["status"] == "CONCLUIDA":
        raise HTTPException(status_code=400, detail="Auditoria já concluída, não pode ser alterada")

    items = audit["items"]
    found = False
    for item in items:
        if item["container_number"] == data.container_number:
            item["status"] = data.status
            if data.observations is not None:
                item["observations"] = data.observations
            found = True
            break

    if not found:
        items.append(AuditedContainerItem(
            container_number=data.container_number,
            expected=False,
            status=data.status,
            observations=data.observations,
        ).model_dump(mode="json"))

    await db.container_audits.update_one(
        {"id": audit_id},
        {"$set": {"items": items, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )

    updated = await db.container_audits.find_one({"id": audit_id}, {"_id": 0})
    return ContainerAuditResponse(**updated)


@api_router.post("/container-audits/{audit_id}/items/{container_number}/photo")
async def upload_container_audit_photo(
    audit_id: str,
    container_number: str,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_active_user)
):
    """Faz upload da foto de um container auditado"""
    audit = await db.container_audits.find_one({"id": audit_id}, {"_id": 0})
    if not audit:
        raise HTTPException(status_code=404, detail="Auditoria não encontrada")
    if audit["status"] == "CONCLUIDA":
        raise HTTPException(status_code=400, detail="Auditoria já concluída, não pode ser alterada")

    items = audit["items"]
    item = next((i for i in items if i["container_number"] == container_number), None)
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
    item["photo"] = {"id": photo_id, "url": photo_url}

    await db.container_audits.update_one(
        {"id": audit_id},
        {"$set": {"items": items, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )

    return item["photo"]


@api_router.post("/container-audits/{audit_id}/complete", response_model=ContainerAuditResponse)
async def complete_container_audit(
    audit_id: str,
    current_user: dict = Depends(get_current_active_user)
):
    """Conclui a auditoria: containers esperados que ficaram PENDENTE viram
    FALTANTE (não foram confirmados = não foram encontrados no pátio)."""
    audit = await db.container_audits.find_one({"id": audit_id}, {"_id": 0})
    if not audit:
        raise HTTPException(status_code=404, detail="Auditoria não encontrada")
    if audit["status"] == "CONCLUIDA":
        raise HTTPException(status_code=400, detail="Auditoria já concluída")

    items = audit["items"]
    for item in items:
        if item["status"] == "PENDENTE":
            item["status"] = "FALTANTE"

    now = datetime.now(timezone.utc).isoformat()
    await db.container_audits.update_one(
        {"id": audit_id},
        {"$set": {"items": items, "status": "CONCLUIDA", "completed_at": now, "updated_at": now}}
    )

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
