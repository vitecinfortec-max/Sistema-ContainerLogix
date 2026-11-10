"""Transporte - Ocorrências: o que aconteceu durante o transporte (atraso,
avaria na carga, sinistro, multa, problema mecânico...), com tipo editável,
ligação opcional com a Ordem de Carregamento, o veículo e o motorista, fotos,
custo e situação (Aberta/Resolvida), e o relatório do período em PDF/Excel."""
from datetime import date, datetime, timezone
from typing import Optional
import re
import shutil
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from list_filters import combine, text_query
from models import TRANSPORT_OCCURRENCE_STATUS, TransportOccurrenceCreate, TransportOccurrenceTypeCreate
from period_reports import Column, Section, DAY, INT, MONEY, excel_response, pdf_response, period_text
from routers.container_audits import _remove_photo_file
from shared import ALLOWED_EXTENSIONS, UPLOADS_DIR, db, get_current_active_user, validate_and_read_upload

api_router = APIRouter(prefix="/api")

MAX_PHOTOS = 6  # mesmo limite da tela (TransportOccurrenceFormPage.js)
STATUS_LABELS = {"ABERTA": "Aberta", "RESOLVIDA": "Resolvida"}

# Tipos criados na primeira vez que a lista de tipos é aberta; dá pra
# renomear, desativar ou criar outros depois
DEFAULT_TYPES = [
    "Atraso na coleta/entrega", "Avaria na carga", "Acidente/Sinistro", "Problema mecânico",
    "Multa de trânsito", "Roubo/Furto", "Documentação", "Outros",
]


# ------------------------------------------------------------------ tipos

async def _ensure_default_types():
    if await db.transport_occurrence_types.count_documents({}) == 0:
        now = datetime.now(timezone.utc).isoformat()
        await db.transport_occurrence_types.insert_many([
            {"id": str(uuid.uuid4()), "name": name, "active": True, "created_at": now} for name in DEFAULT_TYPES
        ])


def _clean_name(name: str) -> str:
    name = " ".join((name or "").split())
    if not name:
        raise HTTPException(status_code=400, detail="Informe o nome do tipo de ocorrência")
    return name


async def _ensure_unique_type(name: str, exclude_id: Optional[str] = None):
    query = {"name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}}
    if exclude_id:
        query["id"] = {"$ne": exclude_id}
    if await db.transport_occurrence_types.find_one(query):
        raise HTTPException(status_code=400, detail="Já existe um tipo de ocorrência com esse nome")


@api_router.get("/transport-occurrence-types")
async def list_occurrence_types(current_user: dict = Depends(get_current_active_user)):
    await _ensure_default_types()
    return await db.transport_occurrence_types.find({}, {"_id": 0}).sort("name", 1).to_list(None)


@api_router.post("/transport-occurrence-types")
async def create_occurrence_type(data: TransportOccurrenceTypeCreate, current_user: dict = Depends(get_current_active_user)):
    name = _clean_name(data.name)
    await _ensure_unique_type(name)
    doc = {"id": str(uuid.uuid4()), "name": name, "active": data.active, "created_at": datetime.now(timezone.utc).isoformat()}
    await db.transport_occurrence_types.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/transport-occurrence-types/{type_id}")
async def update_occurrence_type(type_id: str, data: TransportOccurrenceTypeCreate, current_user: dict = Depends(get_current_active_user)):
    if not await db.transport_occurrence_types.find_one({"id": type_id}):
        raise HTTPException(status_code=404, detail="Tipo de ocorrência não encontrado")
    name = _clean_name(data.name)
    await _ensure_unique_type(name, exclude_id=type_id)
    await db.transport_occurrence_types.update_one({"id": type_id}, {"$set": {"name": name, "active": data.active}})
    # As ocorrências guardam o nome do tipo: renomear vale para as antigas também
    await db.transport_occurrences.update_many({"type_id": type_id}, {"$set": {"type_name": name}})
    return await db.transport_occurrence_types.find_one({"id": type_id}, {"_id": 0})


@api_router.delete("/transport-occurrence-types/{type_id}")
async def delete_occurrence_type(type_id: str, current_user: dict = Depends(get_current_active_user)):
    used = await db.transport_occurrences.count_documents({"type_id": type_id})
    if used:
        raise HTTPException(status_code=400, detail=f"Tipo usado em {used} ocorrência(s): desative em vez de excluir")
    result = await db.transport_occurrence_types.delete_one({"id": type_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Tipo de ocorrência não encontrado")
    return {"message": "Tipo de ocorrência excluído"}


# ------------------------------------------------------------------ ocorrências

def _parse_day(value: str) -> str:
    try:
        return date.fromisoformat((value or "")[:10]).isoformat()
    except ValueError:
        raise HTTPException(status_code=400, detail="Data da ocorrência inválida")


async def _resolve_links(data: TransportOccurrenceCreate, current: Optional[dict] = None) -> dict:
    """Valida os campos e preenche os nomes ligados (tipo, ordem, placa, motorista)."""
    if data.status not in TRANSPORT_OCCURRENCE_STATUS:
        raise HTTPException(status_code=400, detail="Situação inválida")
    description = (data.description or "").strip()
    if not description:
        raise HTTPException(status_code=400, detail="Descreva a ocorrência")
    occurred_time = (data.occurred_time or "").strip() or None
    if occurred_time and not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", occurred_time):
        raise HTTPException(status_code=400, detail="Hora da ocorrência inválida: use HH:MM")
    occ_type = await db.transport_occurrence_types.find_one({"id": data.type_id}, {"_id": 0})
    if not occ_type:
        raise HTTPException(status_code=400, detail="Tipo de ocorrência não encontrado")

    fields = {
        "type_id": occ_type["id"], "type_name": occ_type["name"],
        "occurred_date": _parse_day(data.occurred_date), "occurred_time": occurred_time,
        "location": (data.location or "").strip() or None, "description": description,
        "cost": round(data.cost, 2) if data.cost else None,
        "status": data.status, "resolution": (data.resolution or "").strip() or None,
        "loading_order_id": None, "loading_order_number": None,
        "vehicle_id": None, "vehicle_plate": None, "driver_id": None, "driver_name": None,
    }

    order = None
    if data.loading_order_id:
        order = await db.loading_orders.find_one({"id": data.loading_order_id}, {"_id": 0})
        if not order:
            raise HTTPException(status_code=400, detail="Ordem de Carregamento não encontrada")
        fields["loading_order_id"], fields["loading_order_number"] = order["id"], order.get("order_number")
    if data.vehicle_id:
        vehicle = await db.vehicles.find_one({"id": data.vehicle_id}, {"_id": 0, "id": 1, "plate": 1})
        if not vehicle:
            raise HTTPException(status_code=400, detail="Veículo não encontrado")
        fields["vehicle_id"], fields["vehicle_plate"] = vehicle["id"], vehicle["plate"]
    elif order and order.get("truck_plate"):
        fields["vehicle_plate"] = order["truck_plate"]  # placa da ordem, sem veículo cadastrado escolhido
    if data.driver_id:
        driver = await db.drivers.find_one({"id": data.driver_id}, {"_id": 0, "id": 1, "name": 1})
        if not driver:
            raise HTTPException(status_code=400, detail="Motorista não encontrado")
        fields["driver_id"], fields["driver_name"] = driver["id"], driver["name"]
    elif order and order.get("driver_name"):
        fields["driver_id"], fields["driver_name"] = order.get("driver_id"), order["driver_name"]

    # Resolvida guarda quando foi resolvida; voltar para Aberta apaga
    if data.status == "RESOLVIDA":
        already = current and current.get("status") == "RESOLVIDA" and current.get("resolved_at")
        fields["resolved_at"] = current["resolved_at"] if already else datetime.now(timezone.utc).isoformat()
    else:
        fields["resolved_at"] = None
    return fields


def _list_query(search=None, status=None, type_id=None, date_from=None, date_to=None) -> dict:
    query = {}
    if status:
        query["status"] = status
    if type_id:
        query["type_id"] = type_id
    if date_from or date_to:
        query["occurred_date"] = {k: v for k, v in (("$gte", date_from), ("$lte", date_to)) if v}
    text = text_query(("description", "location", "vehicle_plate", "driver_name", "type_name"), search)
    digits = (search or "").strip().lstrip("#")
    if digits.isdigit():
        number = int(digits)
        text = {"$or": [text, {"occurrence_number": number}, {"loading_order_number": number}]}
    return combine(query, text)


@api_router.get("/transport-occurrences")
async def list_occurrences(
    search: Optional[str] = None, status: Optional[str] = None, type_id: Optional[str] = None,
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    page: int = 1, per_page: int = 15,
    current_user: dict = Depends(get_current_active_user),
):
    query = _list_query(search, status, type_id, date_from, date_to)
    page, per_page = max(page, 1), min(max(per_page, 1), 100)
    total = await db.transport_occurrences.count_documents(query)
    items = await db.transport_occurrences.find(query, {"_id": 0}).sort(
        [("occurred_date", -1), ("occurrence_number", -1)]
    ).skip((page - 1) * per_page).limit(per_page).to_list(per_page)
    return {"items": items, "total": total, "page": page, "pages": (total + per_page - 1) // per_page}


@api_router.get("/transport-occurrences/{occurrence_id}")
async def get_occurrence(occurrence_id: str, current_user: dict = Depends(get_current_active_user)):
    doc = await db.transport_occurrences.find_one({"id": occurrence_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Ocorrência não encontrada")
    return doc


@api_router.post("/transport-occurrences")
async def create_occurrence(data: TransportOccurrenceCreate, current_user: dict = Depends(get_current_active_user)):
    fields = await _resolve_links(data)
    counter = await db.counters.find_one_and_update(
        {"_id": "transport_occurrence_number"}, {"$inc": {"seq": 1}}, upsert=True, return_document=True
    )
    doc = {
        "id": str(uuid.uuid4()), "occurrence_number": counter["seq"], **fields, "photos": [],
        "created_by": current_user["sub"], "created_by_name": current_user.get("name", "Sistema"),
        "created_at": datetime.now(timezone.utc).isoformat(), "updated_at": None,
    }
    await db.transport_occurrences.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/transport-occurrences/{occurrence_id}")
async def update_occurrence(occurrence_id: str, data: TransportOccurrenceCreate, current_user: dict = Depends(get_current_active_user)):
    current = await db.transport_occurrences.find_one({"id": occurrence_id}, {"_id": 0})
    if not current:
        raise HTTPException(status_code=404, detail="Ocorrência não encontrada")
    fields = await _resolve_links(data, current)
    fields["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.transport_occurrences.update_one({"id": occurrence_id}, {"$set": fields})
    return await db.transport_occurrences.find_one({"id": occurrence_id}, {"_id": 0})


@api_router.delete("/transport-occurrences/{occurrence_id}")
async def delete_occurrence(occurrence_id: str, current_user: dict = Depends(get_current_active_user)):
    result = await db.transport_occurrences.delete_one({"id": occurrence_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Ocorrência não encontrada")
    shutil.rmtree(UPLOADS_DIR / "transport_occurrences" / occurrence_id, ignore_errors=True)
    return {"message": "Ocorrência excluída"}


@api_router.post("/transport-occurrences/{occurrence_id}/photos")
async def upload_occurrence_photo(occurrence_id: str, file: UploadFile = File(...), current_user: dict = Depends(get_current_active_user)):
    doc = await db.transport_occurrences.find_one({"id": occurrence_id}, {"_id": 0, "photos": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Ocorrência não encontrada")
    if len(doc.get("photos") or []) >= MAX_PHOTOS:
        raise HTTPException(status_code=400, detail=f"Máximo de {MAX_PHOTOS} fotos por ocorrência")

    file_ext, content = await validate_and_read_upload(file, ALLOWED_EXTENSIONS)
    photo_dir = UPLOADS_DIR / "transport_occurrences" / occurrence_id
    photo_dir.mkdir(parents=True, exist_ok=True)
    photo_id = str(uuid.uuid4())
    file_path = photo_dir / f"{photo_id}{file_ext}"
    with open(file_path, "wb") as buffer:
        buffer.write(content)
    photo = {
        "id": photo_id, "url": f"/api/uploads/transport_occurrences/{occurrence_id}/{photo_id}{file_ext}",
        "uploaded_at": datetime.now(timezone.utc).isoformat(), "uploaded_by_name": current_user.get("name", "Sistema"),
    }
    # $push (e não regravar a lista): duas fotos enviadas juntas não se apagam
    await db.transport_occurrences.update_one({"id": occurrence_id}, {"$push": {"photos": photo}})
    return await db.transport_occurrences.find_one({"id": occurrence_id}, {"_id": 0})


@api_router.delete("/transport-occurrences/{occurrence_id}/photos/{photo_id}")
async def delete_occurrence_photo(occurrence_id: str, photo_id: str, current_user: dict = Depends(get_current_active_user)):
    doc = await db.transport_occurrences.find_one({"id": occurrence_id}, {"_id": 0, "photos": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Ocorrência não encontrada")
    photo = next((p for p in doc.get("photos") or [] if p.get("id") == photo_id), None)
    if not photo:
        raise HTTPException(status_code=404, detail="Foto não encontrada")
    await db.transport_occurrences.update_one({"id": occurrence_id}, {"$pull": {"photos": {"id": photo_id}}})
    _remove_photo_file(photo)
    return await db.transport_occurrences.find_one({"id": occurrence_id}, {"_id": 0})


# ------------------------------------------------------------------ relatório

async def build_occurrence_report(date_from=None, date_to=None, status=None, type_id=None, search=None) -> dict:
    query = _list_query(search, status, type_id, date_from, date_to)
    rows = await db.transport_occurrences.find(query, {"_id": 0, "photos": 0}).sort(
        [("occurred_date", 1), ("occurrence_number", 1)]
    ).to_list(None)
    by_type = {}
    for r in rows:
        t = by_type.setdefault(r.get("type_name") or "-", {"type_name": r.get("type_name") or "-", "count": 0, "open": 0, "cost": 0.0})
        t["count"] += 1
        t["open"] += r.get("status") == "ABERTA"
        t["cost"] += r.get("cost") or 0
    return {
        "rows": rows,
        "by_type": sorted(by_type.values(), key=lambda t: (-t["count"], t["type_name"])),
        "summary": {
            "total": len(rows),
            "open": sum(1 for r in rows if r.get("status") == "ABERTA"),
            "resolved": sum(1 for r in rows if r.get("status") == "RESOLVIDA"),
            "cost": round(sum(r.get("cost") or 0 for r in rows), 2),
        },
    }


def _sections(data):
    s = data["summary"]
    by_type = Section(
        "Por tipo de ocorrência",
        [Column("Tipo", width=40), Column("Ocorrências", INT, 12), Column("Abertas", INT, 12), Column("Custo", MONEY, 14)],
        [[t["type_name"], t["count"], t["open"], round(t["cost"], 2)] for t in data["by_type"]],
        total=["TOTAL", s["total"], s["open"], s["cost"]],
        empty_text="Nenhuma ocorrência no período.", sheet_name="Por tipo",
    )
    detail = Section(
        "Ocorrências do período",
        [Column("Nº", INT, 6), Column("Data", DAY, 9), Column("Tipo", width=15), Column("Ordem", INT, 7),
         Column("Placa", width=9, align="center"), Column("Motorista", width=15), Column("Local", width=14),
         Column("Descrição", width=26), Column("Custo", MONEY, 10), Column("Situação", width=9, align="center")],
        [[r.get("occurrence_number"), r.get("occurred_date"), r.get("type_name"), r.get("loading_order_number"),
          r.get("vehicle_plate"), r.get("driver_name"), r.get("location"),
          r.get("description") + (f" | Solução: {r['resolution']}" if r.get("resolution") else ""),
          r.get("cost"), STATUS_LABELS.get(r.get("status"), r.get("status"))] for r in data["rows"]],
        empty_text="Nenhuma ocorrência no período.", sheet_name="Ocorrências",
    )
    return [by_type, detail]


def _subtitle(date_from, date_to, status, search):
    parts = [period_text("Ocorrências", date_from, date_to),
             f"Situação: {STATUS_LABELS.get(status, status)}" if status else None,
             f"Busca: {search}" if search else None]
    return " · ".join(p for p in parts if p) or None


@api_router.get("/reports/transport-occurrences")
async def get_occurrence_report(
    date_from: Optional[str] = None, date_to: Optional[str] = None, status: Optional[str] = None,
    type_id: Optional[str] = None, search: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user),
):
    return await build_occurrence_report(date_from, date_to, status, type_id, search)


@api_router.get("/reports/transport-occurrences/pdf")
async def get_occurrence_report_pdf(
    date_from: Optional[str] = None, date_to: Optional[str] = None, status: Optional[str] = None,
    type_id: Optional[str] = None, search: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user),
):
    data = await build_occurrence_report(date_from, date_to, status, type_id, search)
    s = data["summary"]
    info = [("Ocorrências", str(s["total"])), ("Abertas", str(s["open"])), ("Resolvidas", str(s["resolved"])),
            ("Custo total", f"R$ {s['cost']:,.2f}".replace(",", "X").replace(".", ",").replace("X", "."))]
    return await pdf_response("Relatório de Ocorrências de Transporte", _subtitle(date_from, date_to, status, search), info,
                              _sections(data), "relatorio_ocorrencias", current_user.get("name", "Sistema"))


@api_router.get("/reports/transport-occurrences/excel")
async def get_occurrence_report_excel(
    date_from: Optional[str] = None, date_to: Optional[str] = None, status: Optional[str] = None,
    type_id: Optional[str] = None, search: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user),
):
    data = await build_occurrence_report(date_from, date_to, status, type_id, search)
    return await excel_response("Relatório de Ocorrências de Transporte",
                                _subtitle(date_from, date_to, status, search) or "Todas as ocorrências",
                                _sections(data), "relatorio_ocorrencias")
