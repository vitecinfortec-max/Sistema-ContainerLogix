from datetime import datetime, timezone, timedelta
from typing import Optional, List
import io
import re

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from models import PortService, PortServiceCreate, PortServiceResponse, DailyPortServicePoint
from reports import (
    _build_pdf_header, _make_pdf_footer, now_brt, merge_company, format_currency,
    generate_port_services_report_pdf, generate_port_services_report_excel,
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
) -> list:
    """Consulta db.port_services com os mesmos filtros usados pelo Relatório
    de Serviço Portuário (resumo, gráfico diário, PDF e Excel), sempre a
    partir de service_date (string YYYY-MM-DD, comparável lexicograficamente)."""
    query = {}
    if client_id and client_id != 'all':
        query['client_id'] = client_id
    if turno and turno != 'all':
        query['turno'] = turno
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
