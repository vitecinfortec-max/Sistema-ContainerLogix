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
    _build_pdf_header, _make_pdf_footer, now_brt, merge_company, format_currency,
    generate_port_services_report_pdf, generate_port_services_report_excel,
    generate_port_service_invoice_pdf, generate_port_service_invoice_excel,
)
from shared import db, get_current_active_user, get_current_admin_user, get_company_settings, load_logo_buffer

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
    current_user: dict = Depends(get_current_active_user)
):
    """Lista Serviços Portuários com paginação e busca por Cliente/Motorista/Placa"""
    query = {}
    if search:
        search_escaped = re.escape(search)
        query["$or"] = [
            {"client_name": {"$regex": search_escaped, "$options": "i"}},
            {"driver_name": {"$regex": search_escaped, "$options": "i"}},
            {"cavalo_plate": {"$regex": search_escaped, "$options": "i"}},
        ]

    total = await db.port_services.count_documents(query)
    skip = (page - 1) * per_page

    services = await db.port_services.find(query, {"_id": 0}).sort("service_number", -1).skip(skip).limit(per_page).to_list(per_page)

    return {
        "items": [_port_service_serialize(s) for s in services],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page
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


@api_router.put("/port-services/{service_id}", response_model=PortServiceResponse)
async def update_port_service(service_id: str, data: PortServiceCreate, current_user: dict = Depends(get_current_active_user)):
    """Atualiza um Serviço Portuário existente"""
    existing = await db.port_services.find_one({"id": service_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Serviço Portuário não encontrado")

    update_data = data.model_dump()
    update_data["updated_at"] = datetime.now(timezone.utc)

    await db.port_services.update_one({"id": service_id}, {"$set": update_data})

    result = await db.port_services.find_one({"id": service_id}, {"_id": 0})
    return result


@api_router.delete("/port-services/{service_id}")
async def delete_port_service(service_id: str, current_user: dict = Depends(get_current_active_user)):
    """Deleta um Serviço Portuário"""
    result = await db.port_services.delete_one({"id": service_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Serviço Portuário não encontrado")
    return {"message": "Serviço Portuário deletado com sucesso"}


@api_router.get("/port-services/{service_id}/pdf")
async def generate_port_service_pdf(service_id: str, current_user: dict = Depends(get_current_active_user)):
    """Gera o voucher em PDF de um único Serviço Portuário - mesmo padrão
    visual do Status de Entrega (cabeçalho/rodapé via
    _build_pdf_header/_make_pdf_footer), só que com uma caixa simples de
    label/valor no lugar da tabela de itens (aqui é 1 registro só)."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, KeepTogether
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_CENTER

    service = await db.port_services.find_one({"id": service_id}, {"_id": 0})
    if not service:
        raise HTTPException(status_code=404, detail="Serviço Portuário não encontrado")
    service = _port_service_serialize(service)

    company = merge_company(await get_company_settings())
    buffer = io.BytesIO()

    BLACK = colors.black
    BORDER_COLOR = colors.black
    HEADER_BG = colors.HexColor('#F5F5F5')
    PRIMARY_GREEN = colors.HexColor('#008B7B')

    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=15*mm,
        leftMargin=15*mm,
        topMargin=12*mm,
        bottomMargin=12*mm
    )
    CONTENT_WIDTH = doc.width

    elements = []
    styles = getSampleStyleSheet()

    logo_buffer = load_logo_buffer(company)
    elements.extend(_build_pdf_header(styles, logo_buffer, "Serviço Portuário", company=company, content_width=CONTENT_WIDTH))

    stats_style = ParagraphStyle('StatsLine', parent=styles['Normal'], fontSize=11, textColor=PRIMARY_GREEN, alignment=TA_CENTER, fontName='Helvetica-Bold', spaceBefore=6, spaceAfter=8)
    elements.append(Paragraph(f"Nº {service['service_number']}", stats_style))

    gen_info_style = ParagraphStyle('GenInfo', parent=styles['Normal'], fontSize=9, textColor=colors.HexColor('#808080'), alignment=TA_CENTER, spaceAfter=12)
    elements.append(Paragraph(f"Gerado em: {now_brt().strftime('%d/%m/%Y %H:%M')}", gen_info_style))

    label_style = ParagraphStyle('Label', parent=styles['Normal'], fontSize=8, fontName='Helvetica', textColor=BLACK)
    value_style = ParagraphStyle('Value', parent=styles['Normal'], fontSize=10, fontName='Helvetica-Bold', textColor=BLACK)
    section_title = ParagraphStyle('SectionTitle', parent=styles['Normal'], fontSize=10, fontName='Helvetica-Bold', textColor=BLACK)

    info_header = [[Paragraph("Informações do Serviço", section_title)]]
    info_header_table = Table(info_header, colWidths=[CONTENT_WIDTH])
    info_header_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), HEADER_BG),
        ('BOX', (0, 0), (-1, -1), 1, BORDER_COLOR),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
    ]))
    elements.append(info_header_table)

    date_display = service.get('service_date') or '-'
    try:
        date_display = datetime.strptime(service['service_date'], '%Y-%m-%d').strftime('%d/%m/%Y')
    except Exception:
        pass

    situacao_label = 'Concluído' if service['situacao'] == 'CONCLUIDO' else 'Em Andamento (No Pátio)'

    info_rows = [
        [Paragraph("Cliente", label_style), Paragraph(service['client_name'], value_style)],
        [Paragraph("Motorista", label_style), Paragraph(service['driver_name'], value_style)],
        [Paragraph("Placa do Cavalo", label_style), Paragraph(service['cavalo_plate'], value_style)],
        [Paragraph("Data do Serviço", label_style), Paragraph(date_display, value_style)],
        [Paragraph("Turno", label_style), Paragraph(_TURNO_LABELS.get(service['turno'], service['turno']), value_style)],
        [Paragraph("Horário de Entrada", label_style), Paragraph(service.get('entry_time') or '-', value_style)],
        [Paragraph("Horário de Saída", label_style), Paragraph(service.get('exit_time') or '-', value_style)],
        [Paragraph("Situação", label_style), Paragraph(situacao_label, value_style)],
        [Paragraph("Valor da Operação", label_style), Paragraph(format_currency(service['operation_value']), value_style)],
    ]

    info_table = Table(info_rows, colWidths=[CONTENT_WIDTH * 0.35, CONTENT_WIDTH * 0.65])
    info_table.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 1, BORDER_COLOR),
        ('LINEBELOW', (0, 0), (-1, -2), 0.5, colors.HexColor('#CCCCCC')),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    elements.append(info_table)
    elements.append(Spacer(1, 6))

    if service.get('observations'):
        obs_header = [[Paragraph("Observações", section_title)]]
        obs_header_table = Table(obs_header, colWidths=[CONTENT_WIDTH])
        obs_header_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), HEADER_BG),
            ('BOX', (0, 0), (-1, -1), 1, BORDER_COLOR),
            ('TOPPADDING', (0, 0), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
            ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ]))
        obs_content_style = ParagraphStyle('ObsContent', parent=styles['Normal'], fontSize=9, fontName='Helvetica', textColor=BLACK)
        obs_table = Table([[Paragraph(service['observations'], obs_content_style)]], colWidths=[CONTENT_WIDTH])
        obs_table.setStyle(TableStyle([
            ('BOX', (0, 0), (-1, -1), 1, BORDER_COLOR),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ]))
        elements.append(KeepTogether([obs_header_table, obs_table]))

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
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
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
