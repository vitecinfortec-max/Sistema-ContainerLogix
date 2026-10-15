"""Controle de Pátio: containers em estoque, tempo de permanência, saída
rápida e exportações. Separado de movements.py.
"""
from datetime import datetime, timezone
from typing import Optional
import io
import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel as PydanticBaseModel, ValidationError

from models import ContainerMovementCreate
from reports import generate_yard_control_pdf, now_brt, BRT_TZ

from shared import db, get_current_active_user, get_company_settings, parse_datetime_value
from routers.movements import _create_container_movement, _parse_filter_day, _movement_order_key

api_router = APIRouter(prefix="/api")
logger = logging.getLogger(__name__)


# ==================== CONTROLE DE ESTOQUE / CONTAINERS NO PÁTIO ====================

@api_router.get("/yard-control")
async def get_yard_control(
    status_filter: Optional[str] = None,
    client_name: Optional[str] = None,
    shipping_line: Optional[str] = None,
    min_days: Optional[int] = None,
    movement_type: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user)
):
    """Retorna containers em estoque no pátio com contagem de dias"""
    # Otimização: projeta só os campos usados abaixo (id, datas, status etc.) em vez
    # do documento inteiro de cada movimentação (que inclui fotos, observações etc.
    # não usados aqui) - reduz bastante o volume de dados trafegado, sem mudar a
    # lógica de pareamento entrada/saída que continua precisando do histórico inteiro.
    all_movements = await db.movements.find({}, {
        "_id": 0, "id": 1, "transaction_id": 1, "container_number": 1, "status": 1,
        "size_type": 1, "shipping_line": 1, "client_name": 1, "booking": 1,
        "created_at": 1, "tare": 1, "seal": 1, "service_type": 1, "operation_type": 1,
    }).sort("created_at", -1).to_list(None)
    
    # Agrupar por container - rastrear pares de entrada/saída
    container_data = {}
    for m in sorted(all_movements, key=_movement_order_key):
        container = m['container_number']
        if container not in container_data:
            container_data[container] = {
                'entries': [],
                'exits': [],
                'movements': []
            }
        
        if m['operation_type'] == 'ENTRADA':
            container_data[container]['entries'].append(m)
            container_data[container]['movements'].append(m)
        elif m['operation_type'] == 'SAIDA':
            container_data[container]['exits'].append(m)
            container_data[container]['movements'].append(m)
    
    # Calcular dias no pátio
    now = datetime.now(timezone.utc)
    yard_containers = []
    
    # Parse date filters - dias no horário de Brasília (00:00:00 do primeiro
    # dia até 23:59:59 do último), não em UTC
    date_from_dt = None
    date_to_dt = None
    if date_from:
        date_from_dt = datetime.combine(_parse_filter_day(date_from, "date_from"), datetime.min.time(), tzinfo=BRT_TZ)
    if date_to:
        date_to_dt = datetime.combine(_parse_filter_day(date_to, "date_to"), datetime.min.time(), tzinfo=BRT_TZ).replace(hour=23, minute=59, second=59)

    for container, data in container_data.items():
        num_entries = len(data['entries'])
        num_exits = len(data['exits'])
        
        # Container ainda em estoque: a última movimentação dele é uma ENTRADA
        # (mesma regra de in_stock_movements em movements.py)
        last_movement = data['movements'][-1] if data['movements'] else None
        if last_movement and last_movement['operation_type'] == 'ENTRADA':
            # Filtro por tipo - se for SAIDA, pular containers em estoque
            if movement_type == 'SAIDA':
                continue
                
            m = last_movement
            entry_date = parse_datetime_value(m['created_at'])
            
            # Aplicar filtros básicos primeiro
            if status_filter and m['status'] != status_filter:
                continue
            # Filtro de cliente: verificar se todas as palavras da busca estão no nome
            if client_name:
                container_client = (m.get('client_name') or '').lower()
                search_words = client_name.lower().split()
                if not all(word in container_client for word in search_words):
                    continue
            if shipping_line and m.get('shipping_line') != shipping_line:
                continue
            
            # Para ESTOQUE ou TODOS com filtro de data:
            # - Mostra containers que estão em estoque E entraram dentro ou antes do período
            if (movement_type == 'ESTOQUE' or not movement_type) and (date_from_dt or date_to_dt):
                # Se container entrou DEPOIS do período final, não mostrar
                if date_to_dt and entry_date > date_to_dt:
                    continue
                
                # Data de referência para início do cálculo: maior entre data de entrada e date_from
                calc_start = entry_date
                if date_from_dt and entry_date < date_from_dt:
                    calc_start = date_from_dt
                
                # Data de referência para fim do cálculo: menor entre agora e date_to
                calc_end = now
                if date_to_dt and now > date_to_dt:
                    calc_end = date_to_dt
                
                # Calcular dias no pátio dentro do período selecionado
                days_in_yard = max(0, (calc_end - calc_start).days)
            elif movement_type == 'ENTRADA' and (date_from_dt or date_to_dt):
                # Para filtro ENTRADA, filtrar pela data de entrada
                if date_from_dt and entry_date < date_from_dt:
                    continue
                if date_to_dt and entry_date > date_to_dt:
                    continue
                days_in_yard = (now - entry_date).days
            else:
                # Cálculo padrão: dias desde a entrada até agora
                days_in_yard = (now - entry_date).days
            
            if min_days is not None and days_in_yard < min_days:
                continue
            
            yard_containers.append({
                'id': m['id'],
                'transaction_id': m.get('transaction_id', 0),
                'container_number': container,
                'status': m['status'],
                'size_type': m['size_type'],
                'shipping_line': m['shipping_line'],
                'client_name': m.get('client_name'),
                'booking': m.get('booking'),
                'entry_date': entry_date.isoformat(),
                'exit_date': None,
                'days_in_yard': days_in_yard,
                'tare': m.get('tare'),
                'seal': m.get('seal'),
                'service_type': m.get('service_type'),
                'operation_type': 'ENTRADA',
                'in_stock': True
            })
        
        # Containers que já saíram - mostrar quando filtro for SAIDA ou TODOS (não ESTOQUE)
        if num_exits > 0 and movement_type != 'ESTOQUE':
            # Para cada par entrada/saída, calcular tempo no pátio
            for i, exit_m in enumerate(data['exits']):
                # Encontrar a entrada correspondente (entrada anterior à saída)
                exit_date = parse_datetime_value(exit_m['created_at'])
                entry_m = None
                entry_date = None
                
                # Buscar a entrada mais recente antes desta saída
                for entry in reversed(data['entries'][:i+1] if i < len(data['entries']) else data['entries']):
                    e_date = parse_datetime_value(entry['created_at'])
                    if e_date < exit_date:
                        entry_m = entry
                        entry_date = e_date
                        break
                
                if not entry_date:
                    # Se não encontrou entrada correspondente, usar a primeira entrada
                    if data['entries']:
                        entry_m = data['entries'][0]
                        entry_date = parse_datetime_value(entry_m['created_at'])
                    else:
                        continue
                
                # Cálculo dos dias no pátio:
                # - Sem filtro de data: tempo total entre entrada e saída
                # - Com filtro de data: limitar ao período selecionado (sobreposição)
                if date_from_dt or date_to_dt:
                    calc_start = entry_date
                    if date_from_dt and entry_date < date_from_dt:
                        calc_start = date_from_dt
                    calc_end = exit_date
                    if date_to_dt and exit_date > date_to_dt:
                        calc_end = date_to_dt
                    days_in_yard = max(0, (calc_end - calc_start).days)
                else:
                    days_in_yard = (exit_date - entry_date).days
                
                # Aplicar filtros na saída
                if status_filter and exit_m['status'] != status_filter:
                    continue
                # Filtro de cliente: verificar se todas as palavras da busca estão no nome
                if client_name:
                    exit_client = (exit_m.get('client_name') or '').lower()
                    search_words = client_name.lower().split()
                    if not all(word in exit_client for word in search_words):
                        continue
                if shipping_line and exit_m.get('shipping_line') != shipping_line:
                    continue
                if min_days is not None and days_in_yard < min_days:
                    continue
                # Filtro por período: incluir a saída se houve sobreposição com o período
                # (entrada antes do date_to E saída depois do date_from)
                if date_from_dt and exit_date < date_from_dt:
                    continue
                if date_to_dt and entry_date > date_to_dt:
                    continue
                
                # Evitar duplicatas - verificar se já foi adicionado
                existing = next((c for c in yard_containers if c['id'] == exit_m['id']), None)
                if existing:
                    continue
                
                yard_containers.append({
                    'id': exit_m['id'],
                    'transaction_id': exit_m.get('transaction_id', 0),
                    'container_number': container,
                    'status': exit_m['status'],
                    'size_type': exit_m['size_type'],
                    'shipping_line': exit_m['shipping_line'],
                    'client_name': exit_m.get('client_name'),
                    'booking': exit_m.get('booking'),
                    'entry_date': entry_date.isoformat() if entry_date else None,
                    'exit_date': exit_date.isoformat(),
                    'days_in_yard': days_in_yard,
                    'tare': exit_m.get('tare'),
                    'seal': exit_m.get('seal'),
                    'service_type': exit_m.get('service_type'),
                    'operation_type': 'SAIDA',
                    'in_stock': False
                })
    
    # Ordenar por dias no pátio (maior primeiro)
    yard_containers.sort(key=lambda x: x['days_in_yard'], reverse=True)

    # Estatísticas (cards do topo, breakdown por cliente/armador) - sempre calculadas
    # só a partir do estoque atual (in_stock), independente do filtro "Tipo" da
    # tabela abaixo. Sem isso, escolher "Todos" ou "Saída" em Tipo inflava "Total
    # no Pátio" somando containers que já saíram junto com os que ainda estão lá.
    stock_only = [c for c in yard_containers if c['in_stock']]
    total_containers = len(stock_only)
    total_empty = sum(1 for c in stock_only if c['status'] == 'VAZIO')
    total_full = sum(1 for c in stock_only if c['status'] == 'CHEIO')
    avg_days = sum(c['days_in_yard'] for c in stock_only) / total_containers if total_containers > 0 else 0
    max_days = max((c['days_in_yard'] for c in stock_only), default=0)

    # Containers com mais de 30 dias (alerta)
    over_30_days = sum(1 for c in stock_only if c['days_in_yard'] > 30)
    over_60_days = sum(1 for c in stock_only if c['days_in_yard'] > 60)
    over_90_days = sum(1 for c in stock_only if c['days_in_yard'] > 90)

    # Estoque por Cliente
    stock_by_client = {}
    for c in stock_only:
        client = c.get('client_name') or 'Sem Cliente'
        if client not in stock_by_client:
            stock_by_client[client] = {'total': 0, 'empty': 0, 'full': 0}
        stock_by_client[client]['total'] += 1
        if c['status'] == 'VAZIO':
            stock_by_client[client]['empty'] += 1
        else:
            stock_by_client[client]['full'] += 1

    by_client = [{'client': k, **v} for k, v in sorted(stock_by_client.items(), key=lambda x: x[1]['total'], reverse=True)]

    # Estoque por Armador
    stock_by_shipping = {}
    for c in stock_only:
        shipping = c.get('shipping_line') or 'Sem Armador'
        if shipping not in stock_by_shipping:
            stock_by_shipping[shipping] = {'total': 0, 'empty': 0, 'full': 0}
        stock_by_shipping[shipping]['total'] += 1
        if c['status'] == 'VAZIO':
            stock_by_shipping[shipping]['empty'] += 1
        else:
            stock_by_shipping[shipping]['full'] += 1

    by_shipping = [{'shipping_line': k, **v} for k, v in sorted(stock_by_shipping.items(), key=lambda x: x[1]['total'], reverse=True)]
    
    return {
        'containers': yard_containers,
        'stats': {
            'total': total_containers,
            'empty': total_empty,
            'full': total_full,
            'avg_days': round(avg_days, 1),
            'max_days': max_days,
            'over_30_days': over_30_days,
            'over_60_days': over_60_days,
            'over_90_days': over_90_days
        },
        'by_client': by_client,
        'by_shipping': by_shipping
    }


from pydantic import BaseModel as PydanticBaseModel

class QuickExitRequest(PydanticBaseModel):
    entry_movement_id: str
    driver_id: Optional[str] = None
    driver_name: Optional[str] = None
    vehicle_plate: Optional[str] = None
    transport_company_id: Optional[str] = None
    transport_company_name: Optional[str] = None
    observations: Optional[str] = None

@api_router.post("/yard-control/quick-exit")
async def register_quick_exit(
    data: QuickExitRequest,
    current_user: dict = Depends(get_current_active_user)
):
    """Registra saída rápida de container do pátio"""
    # Buscar movimentação de entrada
    entry_movement = await db.movements.find_one({"id": data.entry_movement_id}, {"_id": 0})
    if not entry_movement:
        raise HTTPException(status_code=404, detail="Movimentação de entrada não encontrada")
    
    # Verificar se já existe saída
    existing_exit = await db.movements.find_one({
        "container_number": entry_movement["container_number"],
        "operation_type": "SAIDA",
        "created_at": {"$gt": entry_movement["created_at"]}
    }, {"_id": 0})
    
    if existing_exit:
        raise HTTPException(status_code=400, detail="Container já possui saída registrada")
    
    # CPF do motorista vem do cadastro (o formulário de saída rápida só
    # manda o id e o nome).
    driver_cpf = ''
    if data.driver_id:
        driver = await db.drivers.find_one({"id": data.driver_id}, {"_id": 0, "cpf": 1})
        driver_cpf = (driver or {}).get('cpf') or ''

    # A saída é criada pelo mesmo caminho da Emissão de EIR
    # (_create_container_movement), com os mesmos nomes de campo. Antes este
    # endpoint gravava o documento à mão, com outros nomes (vehicle_plate,
    # transport_company_name, created_by_name), e pulava a trava de
    # duplicidade, a Segregação de Unidade e o aviso em tempo real.
    try:
        movement_input = ContainerMovementCreate(
            operation_type="SAIDA",
            driver_name=data.driver_name or '',
            driver_cpf=driver_cpf,
            truck_plate=data.vehicle_plate or '',
            trailer_plate_1='',
            transport_company=data.transport_company_name or '',
            client_name=entry_movement.get("client_name"),
            buyer_name=entry_movement.get("buyer_name"),
            container_number=entry_movement["container_number"],
            status=entry_movement["status"],
            size_type=entry_movement["size_type"],
            tare=entry_movement.get("tare"),
            shipping_line=entry_movement["shipping_line"],
            seal=entry_movement.get("seal"),
            booking=entry_movement.get("booking"),
            service_type=entry_movement.get("service_type"),
            observations=data.observations or f"Saída rápida - Entrada #{entry_movement.get('transaction_id')}",
        )
    except ValidationError:
        raise HTTPException(
            status_code=400,
            detail="A entrada deste container tem dados fora do padrão atual. Registre a saída pela Emissão de EIR."
        )

    response = await _create_container_movement(movement_input, current_user)

    return {
        "message": "Saída registrada com sucesso",
        "movement": response,
        "transaction_id": response.transaction_id
    }

@api_router.get("/yard-control/excel")
async def download_yard_control_excel(
    status_filter: Optional[str] = None,
    client_name: Optional[str] = None,
    shipping_line: Optional[str] = None,
    min_days: Optional[int] = None,
    movement_type: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user)
):
    """Gera relatório Excel de containers no pátio (padrão visual das planilhas
    via generate_yard_control_excel)."""
    from reports import generate_yard_control_excel

    yard_data = await get_yard_control(status_filter, client_name, shipping_line, min_days, movement_type, date_from, date_to, current_user)

    # Filtros aplicados viram o complemento do título ("Controle de Pátio - ...")
    filter_parts = []
    if movement_type:
        filter_parts.append(f"Tipo: {movement_type}")
    if status_filter:
        filter_parts.append(f"Status: {status_filter}")
    if client_name:
        filter_parts.append(f"Cliente: {client_name}")
    if shipping_line:
        filter_parts.append(f"Armador: {shipping_line}")
    if min_days:
        filter_parts.append(f"Mínimo de {min_days} dias")
    if date_from or date_to:
        filter_parts.append(f"Período: {date_from or 'início'} a {date_to or 'atual'}")

    company = await get_company_settings()
    excel_bytes = generate_yard_control_excel(
        yard_data['containers'], yard_data['stats'], filter_text=' · '.join(filter_parts) or None, company=company,
    )

    filename = f"controle_patio_{now_brt().strftime('%d-%m-%Y_%H-%M')}.xlsx"
    return StreamingResponse(
        io.BytesIO(excel_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@api_router.get("/yard-control/pdf")
async def download_yard_control_pdf(
    status_filter: Optional[str] = None,
    client_name: Optional[str] = None,
    shipping_line: Optional[str] = None,
    min_days: Optional[int] = None,
    movement_type: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user)
):
    """Gera relatório PDF de containers no pátio"""
    yard_data = await get_yard_control(status_filter, client_name, shipping_line, min_days, movement_type, date_from, date_to, current_user)
    company = await get_company_settings()
    pdf_bytes = generate_yard_control_pdf(yard_data['containers'], yard_data['stats'], company)

    filename = f"controle_patio_{now_brt().strftime('%d-%m-%Y_%H-%M')}.pdf"

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
