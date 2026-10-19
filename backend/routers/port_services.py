from datetime import datetime, timezone, timedelta
from typing import Optional, List
import io
import re

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from models import (
    PortService, PortServiceCreate, PortServiceResponse, DailyPortServicePoint,
    PortServiceBillingBatch, PortServiceBillingBatchCreate, PortServiceBillingBatchUpdate,
    PortServiceBillingBatchResponse,
)
from reports import (
    today_brt,
    _build_pdf_header, _make_pdf_footer, merge_company, format_currency,
    generate_port_services_report_pdf, generate_port_services_report_excel,
    generate_port_service_invoice_pdf, generate_port_service_invoice_excel,
    generate_port_service_shifts_pdf, generate_port_service_shifts_excel,
)
from shared import db, get_current_active_user, get_current_admin_user, get_company_settings, load_logo_buffer, refuse_negative

api_router = APIRouter(prefix="/api")

# ==================== OPERACIONAL - SERVIÇO PORTUÁRIO ====================

_TURNO_LABELS = {"DIA": "Dia", "NOITE": "Noite"}


def _port_service_serialize(doc: dict) -> dict:
    """Acrescenta a 'situação' (No Pátio / Concluído) computada ao vivo a
    partir de exit_time - nunca gravada no banco, mesmo padrão do
    retrieval_status da Segregação de Unidade (nunca fica desatualizada em
    relação ao que os campos realmente dizem)."""
    doc = dict(doc)
    doc['situacao'] = 'CONCLUIDO' if (doc.get('exit_time') or '').strip() else 'EM_ANDAMENTO'
    return doc


@api_router.get("/port-services")
async def get_port_services(
    page: int = 1,
    per_page: int = 20,
    search: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    turno: Optional[str] = None,
    situacao: Optional[str] = None,
    billed: Optional[bool] = None,
    current_user: dict = Depends(get_current_active_user)
):
    """Lista Serviços Portuários com paginação, busca por Cliente/Motorista/
    Placa e filtros de período (service_date), turno, situação e faturado.
    `stats` resume o filtro inteiro (não só a página)."""
    conditions = []
    if search:
        search_escaped = re.escape(search)
        conditions.append({"$or": [
            {"client_name": {"$regex": search_escaped, "$options": "i"}},
            {"driver_name": {"$regex": search_escaped, "$options": "i"}},
            {"cavalo_plate": {"$regex": search_escaped, "$options": "i"}},
        ]})
    if date_from or date_to:
        date_query = {}
        if date_from:
            date_query['$gte'] = date_from
        if date_to:
            date_query['$lte'] = date_to
        conditions.append({"service_date": date_query})
    if turno:
        conditions.append({"turno": turno})
    no_exit = [{"exit_time": {"$exists": False}}, {"exit_time": None}, {"exit_time": ""}]
    if situacao == 'EM_ANDAMENTO':
        conditions.append({"$or": no_exit})
    elif situacao == 'CONCLUIDO':
        conditions.append({"$nor": no_exit})
    if billed is not None:
        # "$ne": True casa também os registros antigos sem o campo
        conditions.append({"billed": True} if billed else {"billed": {"$ne": True}})
    query = {"$and": conditions} if conditions else {}

    all_rows = await db.port_services.find(query, {"_id": 0, "operation_value": 1, "exit_time": 1, "billed": 1}).to_list(None)
    total = len(all_rows)
    skip = (page - 1) * per_page

    services = await db.port_services.find(query, {"_id": 0}).sort("service_number", -1).skip(skip).limit(per_page).to_list(per_page)

    # Nº da fatura de cada serviço faturado (coluna "Fatura")
    batch_ids = list({s['billing_batch_id'] for s in services if s.get('billing_batch_id')})
    batch_numbers = {}
    if batch_ids:
        async for b in db.port_service_billing_batches.find({"id": {"$in": batch_ids}}, {"_id": 0, "id": 1, "batch_number": 1}):
            batch_numbers[b['id']] = b['batch_number']
    items = []
    for s in services:
        row = _port_service_serialize(s)
        row['billing_batch_number'] = batch_numbers.get(s.get('billing_batch_id'))
        items.append(row)

    return {
        "items": items,
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page,
        "stats": {
            "count": total,
            "total_value": round(sum(r.get('operation_value') or 0 for r in all_rows), 2),
            "in_progress": sum(1 for r in all_rows if not (r.get('exit_time') or '').strip()),
            "unbilled": sum(1 for r in all_rows if not r.get('billed')),
        },
    }


# As duas rotas abaixo (billing-candidates, billing-batches) precisam vir
# ANTES de GET /port-services/{service_id}: como o FastAPI casa rotas na
# ordem de registro e "billing-candidates"/"billing-batches" têm só 1
# segmento (igual {service_id}), registradas depois elas seriam engolidas
# pela rota de path-parameter (tratadas como um service_id literal).

@api_router.get("/port-services/billing-candidates")
async def get_port_service_billing_candidates(
    client_id: str,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user)
):
    """Lista os Serviços Portuários ATIVOS e ainda não faturados de um
    cliente num período - candidatos pra entrar numa nova Fatura de Serviço
    Portuário."""
    return await _filter_port_services_report(date_from, date_to, client_id, turno=None, billed=False)


@api_router.get("/port-services/billing-batches")
async def get_port_service_billing_batches(
    page: int = 1,
    per_page: int = 20,
    client_id: Optional[str] = None,
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user)
):
    """Lista as Faturas de Serviço Portuário com paginação e filtros"""
    query = {}
    if client_id:
        query['client_id'] = client_id
    if status:
        query['status'] = status

    total = await db.port_service_billing_batches.count_documents(query)
    skip = (page - 1) * per_page
    batches = await db.port_service_billing_batches.find(query, {"_id": 0}).sort("batch_number", -1).skip(skip).limit(per_page).to_list(per_page)

    return {
        "items": batches,
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page
    }


@api_router.get("/port-services/{service_id}")
async def get_port_service(service_id: str, current_user: dict = Depends(get_current_active_user)):
    """Busca um Serviço Portuário pelo ID"""
    service = await db.port_services.find_one({"id": service_id}, {"_id": 0})
    if not service:
        raise HTTPException(status_code=404, detail="Serviço Portuário não encontrado")
    return _port_service_serialize(service)


@api_router.post("/port-services", response_model=PortServiceResponse)
async def create_port_service(data: PortServiceCreate, current_user: dict = Depends(get_current_active_user)):
    """Cria um novo Serviço Portuário"""
    # Valor negativo entrava no faturamento e abatia o total cobrado do cliente
    refuse_negative(data.model_dump(), {"operation_value": "Valor da Operação"})
    counter = await db.counters.find_one_and_update(
        {"_id": "port_service_number"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    next_number = counter["seq"]

    service = PortService(
        service_number=next_number,
        **data.model_dump(),
        created_by=current_user["sub"],
        created_by_name=current_user["name"]
    )

    await db.port_services.insert_one(service.model_dump())

    result = await db.port_services.find_one({"id": service.id}, {"_id": 0})
    return result


async def _billed_message(service: dict, action: str) -> str:
    batch = await db.port_service_billing_batches.find_one({"id": service.get('billing_batch_id')}, {"_id": 0, "batch_number": 1})
    ref = f"Nº {batch['batch_number']}" if batch else ""
    return f"Este Serviço Portuário já está na Fatura de Serviço Portuário {ref}. Para {action}, cancele a fatura primeiro.".replace("  ", " ")


@api_router.put("/port-services/{service_id}", response_model=PortServiceResponse)
async def update_port_service(service_id: str, data: PortServiceCreate, current_user: dict = Depends(get_current_active_user)):
    """Atualiza um Serviço Portuário existente"""
    existing = await db.port_services.find_one({"id": service_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Serviço Portuário não encontrado")
    refuse_negative(data.model_dump(), {"operation_value": "Valor da Operação"})

    # Faturado: valor e cliente ficam como na fatura (o total dela não é
    # refeito); o resto continua editável.
    if existing.get('billed'):
        changed_value = round(data.operation_value or 0, 2) != round(existing.get('operation_value') or 0, 2)
        changed_client = data.client_id != existing.get('client_id')
        if changed_value or changed_client:
            raise HTTPException(status_code=400, detail=await _billed_message(existing, "alterar o valor ou o cliente"))

    update_data = data.model_dump()
    update_data["updated_at"] = datetime.now(timezone.utc)

    await db.port_services.update_one({"id": service_id}, {"$set": update_data})

    result = await db.port_services.find_one({"id": service_id}, {"_id": 0})
    return result


@api_router.delete("/port-services/{service_id}")
async def delete_port_service(service_id: str, current_user: dict = Depends(get_current_active_user)):
    """Deleta um Serviço Portuário"""
    existing = await db.port_services.find_one({"id": service_id}, {"_id": 0})
    if existing and existing.get('billed'):
        raise HTTPException(status_code=400, detail=await _billed_message(existing, "excluir"))
    result = await db.port_services.delete_one({"id": service_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Serviço Portuário não encontrado")
    return {"message": "Serviço Portuário deletado com sucesso"}


@api_router.get("/port-services/{service_id}/pdf")
async def generate_port_service_pdf(service_id: str, current_user: dict = Depends(get_current_active_user)):
    """Gera o voucher em PDF de um único Serviço Portuário - mesmo padrão
    visual dos demais documentos (cabeçalho, quadro de dados e rodapé)."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Spacer, Paragraph
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reports import _pdf_info_grid, _pdf_note_box, _pdf_totals_box, _pdf_tone_markup

    service = await db.port_services.find_one({"id": service_id}, {"_id": 0})
    if not service:
        raise HTTPException(status_code=404, detail="Serviço Portuário não encontrado")
    service = _port_service_serialize(service)

    company = merge_company(await get_company_settings())
    buffer = io.BytesIO()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=15*mm,
        leftMargin=15*mm,
        topMargin=12*mm,
        bottomMargin=15*mm
    )
    CONTENT_WIDTH = doc.width

    elements = []
    styles = getSampleStyleSheet()

    logo_buffer = load_logo_buffer(company)
    elements.extend(_build_pdf_header(
        styles, logo_buffer, f"Serviço Portuário Nº {service['service_number']}",
        company=company, content_width=CONTENT_WIDTH,
    ))

    date_display = service.get('service_date') or '-'
    try:
        date_display = datetime.strptime(service['service_date'], '%Y-%m-%d').strftime('%d/%m/%Y')
    except Exception:
        pass

    done = service['situacao'] == 'CONCLUIDO'
    situacao_value = Paragraph(
        _pdf_tone_markup('Concluído' if done else 'Em Andamento (No Pátio)', 'emerald' if done else 'amber'),
        ParagraphStyle('PortServiceStatus', fontName='Helvetica-Bold', fontSize=8.5, leading=10.5),
    )
    elements.append(_pdf_info_grid([
        ("Cliente", service['client_name'], 2),
        ("Situação", situacao_value),
        ("Motorista", service['driver_name'], 2),
        ("Placa do Cavalo", service['cavalo_plate']),
        ("Data do Serviço", date_display),
        ("Turno", _TURNO_LABELS.get(service['turno'], service['turno'])),
        ("Entrada / Saída", f"{service.get('entry_time') or '-'}  /  {service.get('exit_time') or '-'}"),
    ], CONTENT_WIDTH, cols=3))
    elements.append(Spacer(1, 10))
    elements.append(_pdf_totals_box([("Valor da operação", format_currency(service['operation_value']))], CONTENT_WIDTH, width=240))

    if service.get('observations'):
        elements.append(Spacer(1, 10))
        elements.append(_pdf_note_box("Observações", service['observations'], CONTENT_WIDTH))

    footer = _make_pdf_footer(company['name'])
    doc.build(elements, onFirstPage=footer, onLaterPages=footer)
    buffer.seek(0)

    filename = f"servico_portuario_{service['service_number']}.pdf"
    return StreamingResponse(buffer, media_type="application/pdf", headers={"Content-Disposition": f"attachment; filename={filename}"})


# ==================== RELATÓRIO DE SERVIÇO PORTUÁRIO ====================

async def _filter_port_services_report(
    date_from: Optional[str], date_to: Optional[str],
    client_id: Optional[str], turno: Optional[str],
    billed: Optional[bool] = None,
) -> list:
    """Consulta db.port_services com os mesmos filtros usados pelo Relatório
    de Serviço Portuário (resumo, gráfico diário, PDF e Excel) e pela busca
    de candidatos do Faturamento de Serviço Portuário (billed=False),
    sempre a partir de service_date (string YYYY-MM-DD, comparável
    lexicograficamente)."""
    query = {}
    if client_id and client_id != 'all':
        query['client_id'] = client_id
    if turno and turno != 'all':
        query['turno'] = turno
    if billed is not None:
        # billed=False não pode ser {"billed": False} direto - registros
        # criados antes desse campo existir (Serviço Portuário já rodava
        # em produção antes do Faturamento) não têm "billed" gravado no
        # Mongo, e {"billed": False} exige o campo presente e igual a
        # False, não casando com o campo ausente - ficavam invisíveis pra
        # busca de candidatos. "$ne": True casa tanto False quanto ausente.
        query['billed'] = True if billed else {'$ne': True}
    if date_from or date_to:
        date_query = {}
        if date_from:
            date_query['$gte'] = date_from
        if date_to:
            date_query['$lte'] = date_to
        query['service_date'] = date_query
    rows = await db.port_services.find(query, {"_id": 0}).sort("service_date", -1).to_list(None)
    return [_port_service_serialize(r) for r in rows]


@api_router.get("/reports/port-services/summary")
async def get_port_services_report_summary(
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    client_id: Optional[str] = None, turno: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user)
):
    rows = await _filter_port_services_report(date_from, date_to, client_id, turno)
    total_value = round(sum(r.get('operation_value') or 0 for r in rows), 2)
    count = len(rows)
    in_progress_count = sum(1 for r in rows if r.get('situacao') == 'EM_ANDAMENTO')
    return {
        "count": count,
        "total_value": total_value,
        "avg_value": round(total_value / count, 2) if count else 0,
        "in_progress_count": in_progress_count,
    }


async def _compute_daily_port_services_chart(today: datetime) -> List[DailyPortServicePoint]:
    """Valor/contagem de Serviços Portuários por dia dos últimos 14 dias (por
    service_date) - mesma estratégia de janela fixa usada no gráfico diário
    do Relatório de Serviços."""
    day0 = (today - timedelta(days=13)).strftime('%Y-%m-%d')
    rows = await db.port_services.find({"service_date": {"$gte": day0}}, {"_id": 0}).to_list(None)
    by_day: dict = {}
    for r in rows:
        day = r.get('service_date') or ''
        entry = by_day.setdefault(day, {"value": 0.0, "count": 0})
        entry["value"] += r.get('operation_value') or 0
        entry["count"] += 1

    daily_chart = []
    for i in range(13, -1, -1):
        day = (today - timedelta(days=i)).strftime('%Y-%m-%d')
        totals = by_day.get(day, {})
        daily_chart.append(DailyPortServicePoint(
            date=day,
            total_value=round(totals.get('value', 0), 2),
            count=totals.get('count', 0),
        ))
    return daily_chart


@api_router.get("/reports/port-services/daily-chart", response_model=List[DailyPortServicePoint])
async def get_port_services_daily_chart(current_user: dict = Depends(get_current_admin_user)):
    today = today_brt()
    return await _compute_daily_port_services_chart(today)


@api_router.get("/reports/port-services/pdf")
async def download_port_services_report_pdf(
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    client_id: Optional[str] = None, turno: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user)
):
    rows = await _filter_port_services_report(date_from, date_to, client_id, turno)
    company = await get_company_settings()
    pdf_buffer = generate_port_services_report_pdf(rows, company=company)
    return StreamingResponse(
        io.BytesIO(pdf_buffer),
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=relatorio_servico_portuario.pdf"}
    )


@api_router.get("/reports/port-services/excel")
async def download_port_services_report_excel(
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    client_id: Optional[str] = None, turno: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user)
):
    rows = await _filter_port_services_report(date_from, date_to, client_id, turno)
    company = await get_company_settings()
    excel_buffer = generate_port_services_report_excel(rows, company=company)
    return StreamingResponse(
        io.BytesIO(excel_buffer),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=relatorio_servico_portuario.xlsx"}
    )


# ==================== CONFERÊNCIA DE TURNOS ====================
# Horário previsto de cada turno (Noite termina no dia seguinte). Os dois
# têm 11h30 de jornada.
SHIFT_SCHEDULE = {"DIA": ("08:30", "20:00"), "NOITE": ("20:30", "08:00")}
_DAY = 24 * 60


def _clock_minutes(value: Optional[str]) -> Optional[int]:
    """'HH:MM' (ou 'HH:MM:SS') -> minutos desde a meia-noite; None se vazio
    ou inválido."""
    m = re.fullmatch(r"\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*", value or "")
    if not m:
        return None
    hours, minutes = int(m.group(1)), int(m.group(2))
    if hours > 23 or minutes > 59:
        return None
    return hours * 60 + minutes


def shift_check(turno: Optional[str], entry_time: Optional[str], exit_time: Optional[str]) -> dict:
    """Confere entrada/saída com o horário previsto do turno.

    entry_diff: minutos que chegou ANTES do previsto (negativo = atraso).
    exit_diff: minutos que saiu DEPOIS do previsto (negativo = saiu antes).
    balance: entry_diff + exit_diff = tempo trabalhado - jornada prevista.
    No turno Noite, horários antes do meio-dia são do dia seguinte; no Dia,
    uma saída antes da entrada passou da meia-noite."""
    start_txt, end_txt = SHIFT_SCHEDULE.get(turno, (None, None))
    result = {
        "expected_entry": start_txt, "expected_exit": end_txt,
        "entry_diff": None, "exit_diff": None, "worked": None, "balance": None,
        "shift_status": "SEM_HORARIO",
    }
    if not start_txt:
        return result
    start, end = _clock_minutes(start_txt), _clock_minutes(end_txt)
    entry, exit_ = _clock_minutes(entry_time), _clock_minutes(exit_time)
    if turno == "NOITE":
        end += _DAY
        if entry is not None and entry < 12 * 60:
            entry += _DAY
        if exit_ is not None and exit_ < 12 * 60:
            exit_ += _DAY
    if entry is not None:
        result["entry_diff"] = start - entry
    if exit_ is not None:
        if entry is not None and exit_ < entry:
            exit_ += _DAY
        result["exit_diff"] = exit_ - end
    if entry is None or exit_ is None:
        return result
    result["worked"] = exit_ - entry
    result["balance"] = result["entry_diff"] + result["exit_diff"]
    if result["balance"] == 0:
        result["shift_status"] = "NO_HORARIO"
    else:
        result["shift_status"] = "A_MAIS" if result["balance"] > 0 else "A_MENOS"
    return result


def _valid_period(date_from: Optional[str], date_to: Optional[str]):
    if not date_from or not date_to:
        raise HTTPException(status_code=400, detail="Informe o período (data inicial e final)")
    try:
        start = datetime.strptime(date_from, "%Y-%m-%d")
        end = datetime.strptime(date_to, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Data do período inválida")
    if start > end:
        raise HTTPException(status_code=400, detail="A data inicial é posterior à data final")


async def _port_service_shifts(date_from, date_to, turno, client_id) -> tuple:
    """Serviços do período com a conferência de horário de cada um, em ordem
    de data, turno (Dia antes da Noite) e entrada, mais os totais."""
    _valid_period(date_from, date_to)
    rows = await _filter_port_services_report(date_from, date_to, client_id, turno)
    items = []
    for r in rows:
        check = shift_check(r.get("turno"), r.get("entry_time"), r.get("exit_time"))
        items.append({
            "id": r.get("id"), "service_number": r.get("service_number"), "service_date": r.get("service_date"),
            "turno": r.get("turno"), "client_name": r.get("client_name"), "driver_name": r.get("driver_name"),
            "cavalo_plate": r.get("cavalo_plate"), "entry_time": r.get("entry_time"), "exit_time": r.get("exit_time"),
            "observations": (r.get("observations") or "").strip() or None,
            **check,
        })
    items.sort(key=lambda i: (
        i["service_date"] or "", 0 if i["turno"] == "DIA" else 1, i["entry_time"] or "99:99", i["service_number"] or 0,
    ))
    extra = [i["balance"] for i in items if (i["balance"] or 0) > 0]
    less = [i["balance"] for i in items if (i["balance"] or 0) < 0]
    summary = {
        "count": len(items),
        "day_count": sum(1 for i in items if i["turno"] == "DIA"),
        "night_count": sum(1 for i in items if i["turno"] == "NOITE"),
        "on_time_count": sum(1 for i in items if i["shift_status"] == "NO_HORARIO"),
        "extra_count": len(extra), "extra_minutes": sum(extra),
        "less_count": len(less), "less_minutes": sum(less),
        "missing_count": sum(1 for i in items if i["shift_status"] == "SEM_HORARIO"),
        "with_observations_count": sum(1 for i in items if i["observations"]),
        "balance_minutes": sum(extra) + sum(less),
        "schedule": {k: {"entry": v[0], "exit": v[1]} for k, v in SHIFT_SCHEDULE.items()},
    }
    return items, summary


@api_router.get("/reports/port-service-shifts")
async def get_port_service_shifts(
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    turno: Optional[str] = None, client_id: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user)
):
    """Conferência de Turnos: horário de entrada/saída de cada Serviço
    Portuário do período comparado com o horário previsto do turno, com as
    observações lançadas. Sem valores financeiros (aberto a operadores)."""
    items, summary = await _port_service_shifts(date_from, date_to, turno, client_id)
    return {"items": items, "summary": summary}


@api_router.get("/reports/port-service-shifts/pdf")
async def download_port_service_shifts_pdf(
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    turno: Optional[str] = None, client_id: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user)
):
    items, summary = await _port_service_shifts(date_from, date_to, turno, client_id)
    company = await get_company_settings()
    pdf_buffer = generate_port_service_shifts_pdf(items, summary, date_from, date_to, company=company)
    return StreamingResponse(
        io.BytesIO(pdf_buffer), media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=conferencia_turnos.pdf"}
    )


@api_router.get("/reports/port-service-shifts/excel")
async def download_port_service_shifts_excel(
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    turno: Optional[str] = None, client_id: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user)
):
    items, summary = await _port_service_shifts(date_from, date_to, turno, client_id)
    company = await get_company_settings()
    excel_buffer = generate_port_service_shifts_excel(items, summary, date_from, date_to, company=company)
    return StreamingResponse(
        io.BytesIO(excel_buffer),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=conferencia_turnos.xlsx"}
    )


# ==================== FATURAMENTO DE SERVIÇO PORTUÁRIO ====================

async def get_next_port_service_billing_batch_number():
    """Obtém o próximo batch_number (Fatura de Serviço Portuário) usando um
    contador atômico, mesmo padrão de status_number/os_number/port_service_number."""
    result = await db.counters.find_one_and_update(
        {"_id": "port_service_billing_batch_number"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    return result["seq"]


@api_router.post("/port-services/billing-batches", response_model=PortServiceBillingBatchResponse)
async def create_port_service_billing_batch(
    data: PortServiceBillingBatchCreate,
    current_user: dict = Depends(get_current_admin_user)
):
    """Realiza o faturamento: cria uma Fatura de Serviço Portuário a partir
    dos serviços selecionados e marca todos como faturados - mesmo par
    create+update_many já usado por POST /invoices."""
    if not data.service_ids:
        raise HTTPException(status_code=400, detail="Selecione pelo menos um Serviço Portuário")

    services = await db.port_services.find(
        {"id": {"$in": data.service_ids}}, {"_id": 0}
    ).to_list(None)
    if len(services) != len(set(data.service_ids)):
        raise HTTPException(status_code=404, detail="Um ou mais Serviços Portuários não foram encontrados")

    already_billed = [s for s in services if s.get('billed')]
    if already_billed:
        numbers = [str(s.get('service_number')) for s in already_billed]
        raise HTTPException(status_code=400,
            detail=f"Os seguintes Serviços Portuários já foram faturados: {', '.join(numbers)}")

    other_client = [s for s in services if s.get('client_id') != data.client_id]
    if other_client:
        raise HTTPException(status_code=400,
            detail="Todos os Serviços Portuários selecionados devem ser do mesmo cliente")

    total_value = round(sum((s.get('operation_value') or 0) for s in services), 2)
    discount_value = round(data.discount_value or 0, 2)
    if discount_value < 0:
        raise HTTPException(status_code=400, detail="Desconto não pode ser negativo")
    if discount_value > total_value:
        raise HTTPException(status_code=400, detail="Desconto não pode ser maior que o valor dos serviços")
    net_total = round(total_value - discount_value, 2)
    batch_number = await get_next_port_service_billing_batch_number()

    batch = PortServiceBillingBatch(
        batch_number=batch_number,
        client_id=data.client_id,
        client_name=data.client_name,
        service_ids=data.service_ids,
        item_count=len(services),
        total_value=total_value,
        discount_value=discount_value,
        net_total=net_total,
        period_from=data.period_from,
        period_to=data.period_to,
        observations=data.observations,
        created_by=current_user['sub'],
        created_by_name=current_user['name'],
    )
    await db.port_service_billing_batches.insert_one(batch.model_dump())

    now_iso = datetime.now(timezone.utc)
    await db.port_services.update_many(
        {"id": {"$in": data.service_ids}},
        {"$set": {"billed": True, "billed_at": now_iso, "billing_batch_id": batch.id}}
    )

    result = await db.port_service_billing_batches.find_one({"id": batch.id}, {"_id": 0})
    return result


@api_router.get("/port-services/billing-batches/{batch_id}", response_model=PortServiceBillingBatchResponse)
async def get_port_service_billing_batch(batch_id: str, current_user: dict = Depends(get_current_admin_user)):
    batch = await db.port_service_billing_batches.find_one({"id": batch_id}, {"_id": 0})
    if not batch:
        raise HTTPException(status_code=404, detail="Fatura de Serviço Portuário não encontrada")
    return batch


@api_router.put("/port-services/billing-batches/{batch_id}", response_model=PortServiceBillingBatchResponse)
async def update_port_service_billing_batch(
    batch_id: str,
    data: PortServiceBillingBatchUpdate,
    current_user: dict = Depends(get_current_admin_user)
):
    """Edita desconto/observação de uma fatura já gerada - a lista de
    serviços fica fixa (não é reaberta pra adicionar/remover), pra não
    desencontrar a baixa já feita em cada Serviço Portuário. Bloqueado pra
    fatura CANCELADA (estado final, congelado)."""
    batch = await db.port_service_billing_batches.find_one({"id": batch_id}, {"_id": 0})
    if not batch:
        raise HTTPException(status_code=404, detail="Fatura de Serviço Portuário não encontrada")
    if batch['status'] == 'CANCELADO':
        raise HTTPException(status_code=400, detail="Fatura cancelada não pode ser editada")

    update_data = {}
    discount_value = batch.get('discount_value') or 0
    if data.discount_value is not None:
        discount_value = round(data.discount_value, 2)
        if discount_value < 0:
            raise HTTPException(status_code=400, detail="Desconto não pode ser negativo")
        if discount_value > batch['total_value']:
            raise HTTPException(status_code=400, detail="Desconto não pode ser maior que o valor dos serviços")
        update_data['discount_value'] = discount_value
        update_data['net_total'] = round(batch['total_value'] - discount_value, 2)
    if data.observations is not None:
        update_data['observations'] = data.observations

    if update_data:
        update_data['updated_at'] = datetime.now(timezone.utc)
        await db.port_service_billing_batches.update_one({"id": batch_id}, {"$set": update_data})

    result = await db.port_service_billing_batches.find_one({"id": batch_id}, {"_id": 0})
    return result


@api_router.get("/port-services/billing-batches/{batch_id}/services")
async def get_port_service_billing_batch_services(batch_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Expande os service_ids da fatura pros registros completos de Serviço
    Portuário, pro modal de detalhe - mesmo papel de GET /invoices/{id}/movements."""
    batch = await db.port_service_billing_batches.find_one({"id": batch_id}, {"_id": 0})
    if not batch:
        raise HTTPException(status_code=404, detail="Fatura de Serviço Portuário não encontrada")
    services = await db.port_services.find(
        {"id": {"$in": batch['service_ids']}}, {"_id": 0}
    ).sort("service_date", 1).to_list(None)
    return [_port_service_serialize(s) for s in services]


@api_router.put("/port-services/billing-batches/{batch_id}/status")
async def update_port_service_billing_batch_status(
    batch_id: str,
    status: str,
    current_user: dict = Depends(get_current_admin_user)
):
    """Atualiza o status da fatura (Pendente/Pago/Cancelado). CANCELADO
    desfaz a baixa dos serviços (volta billed=False), mesmo comportamento
    de remover item de uma Fatura geral (Invoice) - libera pra entrar numa
    fatura futura."""
    if status not in ["PENDENTE", "PAGO", "CANCELADO"]:
        raise HTTPException(status_code=400, detail="Status inválido")

    batch = await db.port_service_billing_batches.find_one({"id": batch_id}, {"_id": 0})
    if not batch:
        raise HTTPException(status_code=404, detail="Fatura de Serviço Portuário não encontrada")
    # Cancelada é definitiva: o cancelamento liberou os serviços (podem já
    # estar noutra fatura) - reabrir cobraria o mesmo serviço duas vezes.
    if batch['status'] == 'CANCELADO' and status != 'CANCELADO':
        raise HTTPException(status_code=400, detail="Fatura cancelada não pode ser reaberta. Gere uma nova fatura com os serviços.")

    update_data = {"status": status}
    update_data["paid_at"] = datetime.now(timezone.utc) if status == "PAGO" else None
    await db.port_service_billing_batches.update_one({"id": batch_id}, {"$set": update_data})

    if status == "CANCELADO":
        await db.port_services.update_many(
            {"id": {"$in": batch['service_ids']}},
            {"$set": {"billed": False, "billed_at": None, "billing_batch_id": None}}
        )

    return {"message": "Status atualizado com sucesso"}


@api_router.get("/port-services/billing-batches/{batch_id}/pdf")
async def download_port_service_billing_batch_pdf(batch_id: str, current_user: dict = Depends(get_current_admin_user)):
    batch = await db.port_service_billing_batches.find_one({"id": batch_id}, {"_id": 0})
    if not batch:
        raise HTTPException(status_code=404, detail="Fatura de Serviço Portuário não encontrada")
    services = await db.port_services.find(
        {"id": {"$in": batch['service_ids']}}, {"_id": 0}
    ).sort("service_date", 1).to_list(None)

    company = await get_company_settings()
    pdf_buffer = generate_port_service_invoice_pdf(batch, services, company=company)
    filename = f"fatura_servico_portuario_{batch['batch_number']}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_buffer),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@api_router.get("/port-services/billing-batches/{batch_id}/excel")
async def download_port_service_billing_batch_excel(batch_id: str, current_user: dict = Depends(get_current_admin_user)):
    batch = await db.port_service_billing_batches.find_one({"id": batch_id}, {"_id": 0})
    if not batch:
        raise HTTPException(status_code=404, detail="Fatura de Serviço Portuário não encontrada")
    services = await db.port_services.find(
        {"id": {"$in": batch['service_ids']}}, {"_id": 0}
    ).sort("service_date", 1).to_list(None)

    company = await get_company_settings()
    excel_buffer = generate_port_service_invoice_excel(batch, services, company=company)
    filename = f"fatura_servico_portuario_{batch['batch_number']}.xlsx"
    return StreamingResponse(
        io.BytesIO(excel_buffer),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
