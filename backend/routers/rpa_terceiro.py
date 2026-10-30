from datetime import datetime, timezone
from typing import Optional, List
import io
import re
from xml.sax.saxutils import escape as xml_escape

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from models import RPATerceiro, RPATerceiroCreate, RPATerceiroUpdate, RPATerceiroResponse
from reports import now_brt, merge_company

from shared import db, get_current_admin_user, get_company_settings, refuse_negative
from routers.freight_payments import brt_day_range

api_router = APIRouter(prefix="/api")

# ==================== CONTRATO DE FRETE (nome técnico legado: RPA TERCEIRO) ====================
from models import RPATerceiro, RPATerceiroCreate, RPATerceiroUpdate, RPATerceiroResponse


def _rpa_calc_balance(rpa: dict) -> float:
    """Calcula SALDO A RECEBER: service_value + daily + fuel + others - advance - discounts"""
    sv = float(rpa.get('service_value') or 0)
    dr = float(rpa.get('daily_rate') or 0)
    fu = float(rpa.get('fuel') or 0)
    ad = float(rpa.get('advance') or 0)
    ot = float(rpa.get('others') or 0)
    de = float(rpa.get('discounts') or 0)
    return round(sv + dr + fu + ot - ad - de, 2)


def _rpa_serialize(rpa: dict) -> dict:
    """Adiciona balance calculado ao dict de RPA para resposta."""
    out = {**rpa}
    out['balance'] = _rpa_calc_balance(rpa)
    return out


@api_router.get("/rpa-terceiro", response_model=List[RPATerceiroResponse])
async def list_rpa_terceiro(
    search: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    rpa_type: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user)
):
    """Listar RPAs (todos, sem paginação)."""
    query = {}
    if rpa_type:
        # Aceita 'terceiro' ou 'agregado'. Documentos antigos sem campo são tratados como 'terceiro'.
        if rpa_type == "terceiro":
            query["$or"] = [{"rpa_type": "terceiro"}, {"rpa_type": {"$exists": False}}]
        else:
            query["rpa_type"] = rpa_type
    if search:
        search_escaped = re.escape(search)
        search_or = [
            {"driver_name": {"$regex": search_escaped, "$options": "i"}},
            {"client_name": {"$regex": search_escaped, "$options": "i"}},
            {"container_number": {"$regex": search_escaped, "$options": "i"}},
            {"truck_plate": {"$regex": search_escaped, "$options": "i"}},
            {"bank_beneficiary": {"$regex": search_escaped, "$options": "i"}},
        ]
        if "$or" in query:
            # Combinar com filtro de tipo
            existing_or = query.pop("$or")
            query["$and"] = [{"$or": existing_or}, {"$or": search_or}]
        else:
            query["$or"] = search_or
    range_q = brt_day_range(date_from, date_to)
    if range_q:
        query["created_at"] = range_q

    rpas = await db.rpa_terceiro.find(query, {"_id": 0}).sort("rpa_number", -1).to_list(None)
    return [_rpa_serialize(r) for r in rpas]


@api_router.get("/rpa-terceiro/next-number")
async def get_next_rpa_number(
    rpa_type: Optional[str] = "terceiro",
    current_user: dict = Depends(get_current_admin_user)
):
    """Próximo número sequencial do RPA (separado por tipo) - só uma prévia para
    exibir na tela; o número real é reservado de forma atômica na criação (ver
    create_rpa_terceiro). Lê o mesmo contador em vez de buscar o último RPA
    criado, senão a prévia pode ficar dessincronizada sob concorrência."""
    counter = await db.counters.find_one({"_id": f"rpa_number:{rpa_type or 'terceiro'}"})
    next_num = (counter["seq"] + 1) if counter else 1
    return {"next_number": next_num}


@api_router.get("/rpa-terceiro/driver-info/{driver_id}")
async def get_rpa_driver_info(driver_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Retorna info do motorista para autopreencher RPA. Prioriza o(s) veículo(s)
    cadastrados com esse motorista como responsável; se não houver nenhum, cai
    para a última movimentação desse motorista (comportamento antigo)."""
    driver = await db.drivers.find_one({"id": driver_id}, {"_id": 0})
    if not driver:
        raise HTTPException(status_code=404, detail="Motorista não encontrado")

    driver_vehicles = await db.vehicles.find({"driver_id": driver_id}, {"_id": 0}).to_list(50)
    truck_vehicle = next((v for v in driver_vehicles if v.get("vehicle_type") in ("CAVALO", "CAMINHÃO")), None)
    trailer_vehicle = next((v for v in driver_vehicles if v.get("vehicle_type") == "CARRETA"), None)
    truck_plate = (truck_vehicle or {}).get("plate")
    trailer_plate = (trailer_vehicle or {}).get("plate")
    truck_renavam = (truck_vehicle or {}).get("renavam")
    trailer_renavam = (trailer_vehicle or {}).get("renavam")
    truck_owner = (truck_vehicle or {}).get("transport_company")
    trailer_owner = (trailer_vehicle or {}).get("transport_company")

    if not truck_plate and not trailer_plate:
        last_mov = await db.movements.find_one(
            {"driver_name": driver["name"]},
            {"_id": 0},
            sort=[("created_at", -1)]
        )
        truck_plate = (last_mov or {}).get("truck_plate")
        trailer_plate = (last_mov or {}).get("trailer_plate_1")
        truck_owner = (last_mov or {}).get("transport_company")

    return {
        "driver_name": driver.get("name"),
        "driver_cpf": driver.get("cpf"),
        "driver_phone": driver.get("phone"),
        "truck_plate": truck_plate,
        "trailer_plate": trailer_plate,
        "truck_owner": truck_owner,
        "trailer_owner": trailer_owner,
        "truck_renavam": truck_renavam,
        "trailer_renavam": trailer_renavam,
    }


def _parse_weight(value) -> float:
    """Peso digitado como texto na Ordem ("28.500" ou "28500,5"), mesma leitura do CT-e."""
    try:
        return float(str(value or "0").replace(".", "").replace(",", "."))
    except ValueError:
        return 0.0


def _format_weight(value: float) -> str:
    return f"{value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


async def _vehicle_by_plate(plate: Optional[str]) -> dict:
    """Veículo cadastrado com essa placa, com ou sem o traço."""
    compact = re.sub(r"[^A-Z0-9]", "", (plate or "").upper())
    if len(compact) < 4:
        return {}
    vehicle = await db.vehicles.find_one(
        {"plate": {"$regex": f"^{compact[:3]}-?{compact[3:]}$", "$options": "i"}}, {"_id": 0}
    )
    return vehicle or {}


async def _driver_fields(driver_id: Optional[str], name: Optional[str], cpf: Optional[str]) -> dict:
    query = {"id": driver_id} if driver_id else {"name": name} if name else None
    driver = (await db.drivers.find_one(query, {"_id": 0}) if query else None) or {}
    return {
        "driver_name": driver.get("name") or name,
        "driver_cpf": driver.get("cpf") or cpf,
        "driver_phone": driver.get("phone"),
    }


async def _vehicle_fields(truck_plate: Optional[str], trailer_plates: List[str]) -> dict:
    truck = await _vehicle_by_plate(truck_plate)
    out = {
        "truck_plate": truck.get("plate") or truck_plate,
        "truck_renavam": truck.get("renavam"),
        "truck_owner": truck.get("transport_company"),
        "vehicle_type": truck.get("vehicle_type"),
    }
    for prefix, plate in zip(("trailer", "trailer2"), trailer_plates):
        trailer = await _vehicle_by_plate(plate)
        out.update({
            f"{prefix}_plate": trailer.get("plate") or plate,
            f"{prefix}_renavam": trailer.get("renavam"),
            f"{prefix}_owner": trailer.get("transport_company"),
        })
    return out


async def _contratado_fields(name: Optional[str]) -> dict:
    """Transportadora cadastrada com esse nome, com os dados bancários dela."""
    if not name:
        return {}
    company = await db.transport_companies.find_one(
        {"name": {"$regex": f"^{re.escape(name.strip())}$", "$options": "i"}}, {"_id": 0}
    )
    if not company:
        return {"contratado_name": name}
    return {
        "contratado_id": company.get("id"),
        "contratado_name": company.get("name"),
        "bank_agency": company.get("bank_agency"),
        "bank_account": company.get("bank_account"),
        "bank_pix": company.get("pix_key"),
        "bank_beneficiary": company.get("trade_name") or company.get("name"),
    }


async def _draft_from_order(order: dict) -> dict:
    route = await db.freight_routes.find_one({"id": order.get("route_id")}, {"_id": 0}) if order.get("route_id") else None
    items = [i for i in order.get("items") or [] if i.get("container_number")]
    weight = sum(_parse_weight(i.get("gross_weight")) for i in items)
    freight = order.get("freight_value")
    type_label = "Ordem de Entrega" if order.get("order_type") == "ENTREGA" else "Ordem de Coleta"
    draft = {
        **await _driver_fields(order.get("driver_id"), order.get("driver_name"), order.get("driver_cpf")),
        **await _vehicle_fields(order.get("truck_plate"), [p for p in [order.get("trailer_plate")] if p]),
        **await _contratado_fields(order.get("transport_company")),
        "loading_order_id": order["id"],
        "loading_order_number": order.get("order_number"),
        "client_name": order.get("client_name"),
        "origin": (route or {}).get("origin") or order.get("origin_terminal"),
        "destination": (route or {}).get("destination") or order.get("port"),
        "container_number": ", ".join(i["container_number"] for i in items),
        "documents_list": f"{type_label} Nº {order.get('order_number')}",
        "cargo_items": [
            {"nature": i.get("size_type"), "species": "CONTAINER", "quantity": "1",
             "weight_kg": _parse_weight(i.get("gross_weight")) or None}
            for i in items
        ],
    }
    if weight:
        draft["weight"] = _format_weight(weight)
        draft["collection_weight"] = weight
    if freight:
        # Frete da Rota, o mesmo que vai para o Pagamento Frete do motorista
        description = f"FRETE - {order['route_name']}" if order.get("route_name") else "FRETE"
        draft["service_value"] = freight
        draft["services"] = [{"description": description, "value": freight}]
    return draft


def _cte_client(cte: dict) -> Optional[str]:
    roles = {3: "destinatario", 4: "tomador"}
    party = cte.get(roles.get(cte.get("tomador_papel"), "remetente")) or {}
    return party.get("nome")


def _cte_place(place: Optional[dict]) -> Optional[str]:
    place = place or {}
    return "/".join(filter(None, [place.get("cidade"), place.get("uf")])) or None


def _cte_weight(cte: dict) -> float:
    factors = {"01": 1, "02": 1000}
    return sum(q.get("quantidade", 0) * factors[q.get("unidade")] for q in cte.get("quantidades") or [] if q.get("unidade") in factors)


def _cte_cargo_items(cte: dict) -> list:
    product = cte.get("produto_predominante")
    items = []
    for document in cte.get("documentos") or []:
        # Na chave da NF-e, as posições 26 a 34 são o número da nota
        number = document.get("numero") or (document.get("chave") or "")[25:34].lstrip("0")
        items.append({"nf_number": number or None, "fiscal_date": document.get("data_emissao"), "nature": product, "value": document.get("valor")})
    if not items and (product or cte.get("valor_carga")):
        items.append({"nature": product, "value": cte.get("valor_carga")})
    return items


async def _draft_from_cte(cte: dict) -> dict:
    """Parte da Ordem ligada ao CT-e, quando houver, e o CT-e prevalece. O
    valor do CT-e é o que o cliente paga, não o que se paga ao contratado:
    por isso o Frete só vem da Ordem."""
    order = await db.loading_orders.find_one({"id": cte.get("loading_order_id")}, {"_id": 0}) if cte.get("loading_order_id") else None
    draft = await _draft_from_order(order) if order else {}
    driver = cte.get("motorista") or {}
    if driver.get("nome") or driver.get("driver_id"):
        draft.update(await _driver_fields(driver.get("driver_id"), driver.get("nome"), driver.get("cpf")))
    if cte.get("veiculo_placa"):
        draft.update(await _vehicle_fields(cte["veiculo_placa"], cte.get("reboque_placas") or []))
    weight = _cte_weight(cte)
    containers = ", ".join(c["numero"] for c in cte.get("containers") or [] if c.get("numero"))
    fields = {
        "cte_id": cte["id"],
        "cte": str(cte["numero"]) if cte.get("numero") else None,
        "client_name": _cte_client(cte),
        "origin": _cte_place(cte.get("origem")),
        "destination": _cte_place(cte.get("destino")),
        "container_number": containers,
        "cargo_items": _cte_cargo_items(cte),
        "weight": _format_weight(weight) if weight else None,
        "collection_weight": weight or None,
    }
    draft.update({k: v for k, v in fields.items() if v})
    number = f"CT-e Nº {cte['numero']}" if cte.get("numero") else "CT-e em rascunho"
    draft["documents_list"] = " / ".join(filter(None, [draft.get("documents_list"), number]))
    return draft


async def _contract_numbers(query: dict) -> list:
    rows = await db.rpa_terceiro.find(query, {"_id": 0, "rpa_number": 1}).sort("rpa_number", 1).to_list(None)
    return [r["rpa_number"] for r in rows]


@api_router.get("/rpa-terceiro/sources")
async def list_rpa_sources(current_user: dict = Depends(get_current_admin_user)):
    """Ordens e CT-es que podem preencher um contrato (os mais recentes).
    Fica aqui, e não em /api/ctes, porque quem cuida do contrato pode não ter
    o módulo Fiscal liberado."""
    orders = await db.loading_orders.find(
        {"status": {"$ne": "CANCELADA"}},
        {"_id": 0, "id": 1, "order_number": 1, "order_type": 1, "client_name": 1, "driver_name": 1, "items.container_number": 1},
    ).sort("created_at", -1).to_list(300)
    ctes = await db.ctes.find(
        {"status": {"$nin": ["CANCELADO", "DENEGADO"]}},
        {"_id": 0, "id": 1, "numero": 1, "status": 1, "motorista.nome": 1, "containers.numero": 1,
         "tomador_papel": 1, "remetente.nome": 1, "destinatario.nome": 1, "tomador.nome": 1},
    ).sort("created_at", -1).to_list(300)

    def order_label(o):
        containers = ", ".join(i["container_number"] for i in o.get("items") or [] if i.get("container_number"))
        kind = "Entrega" if o.get("order_type") == "ENTREGA" else "Coleta"
        return " · ".join(filter(None, [f"{kind} Nº {o.get('order_number')}", o.get("client_name"), o.get("driver_name"), containers]))

    def cte_label(c):
        containers = ", ".join(i["numero"] for i in c.get("containers") or [] if i.get("numero"))
        number = f"CT-e Nº {c['numero']}" if c.get("numero") else f"CT-e {str(c.get('status') or '').lower()}"
        return " · ".join(filter(None, [number, _cte_client(c), (c.get("motorista") or {}).get("nome"), containers]))

    return {
        "orders": [{"id": o["id"], "label": order_label(o)} for o in orders],
        "ctes": [{"id": c["id"], "label": cte_label(c)} for c in ctes],
    }


@api_router.get("/rpa-terceiro/from-loading-order/{order_id}")
async def rpa_draft_from_loading_order(order_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Rascunho (não salvo) do contrato com os dados da Ordem de Coleta/Entrega."""
    order = await db.loading_orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Ordem não encontrada")
    return {"draft": await _draft_from_order(order), "used_in": await _contract_numbers({"loading_order_id": order_id})}


@api_router.get("/rpa-terceiro/from-cte/{cte_id}")
async def rpa_draft_from_cte(cte_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Rascunho (não salvo) do contrato com os dados do CT-e."""
    cte = await db.ctes.find_one({"id": cte_id}, {"_id": 0})
    if not cte:
        raise HTTPException(status_code=404, detail="CT-e não encontrado")
    conditions = [{"cte_id": cte_id}]
    if cte.get("loading_order_id"):
        conditions.append({"loading_order_id": cte["loading_order_id"]})
    return {"draft": await _draft_from_cte(cte), "used_in": await _contract_numbers({"$or": conditions})}


@api_router.get("/rpa-terceiro/{rpa_id}", response_model=RPATerceiroResponse)
async def get_rpa_terceiro(rpa_id: str, current_user: dict = Depends(get_current_admin_user)):
    rpa = await db.rpa_terceiro.find_one({"id": rpa_id}, {"_id": 0})
    if not rpa:
        raise HTTPException(status_code=404, detail="RPA não encontrado")
    return _rpa_serialize(rpa)


# Campos digitados. Saldo de combustível, complemento, resultado e frete
# líquido são calculados e podem ser negativos de verdade (adiantamento
# maior que o frete, por exemplo), então ficam de fora.
_RPA_NUMBER_LABELS = {
    "distance_km": "Km", "axle_count": "Nº de Eixos", "return_km": "Km de Retorno",
    "minimum_freight": "Frete Mínimo", "tolerance": "Tolerância", "driver_fee": "Tarifa do Motorista",
    "collection_weight": "Peso de Coleta", "service_value": "Valor dos serviços", "daily_rate": "Diária",
    "other_discounts": "Outros Descontos", "inss_discount_percent": "Desconto INSS (%)",
    "sest_senat_discount_percent": "Desconto SEST/SENAT (%)", "ir_calculation_base": "Base de Cálculo IR",
    "irrf_discount": "Desconto IRRF", "insurance_discount": "Desconto de Seguro", "toll_value": "Valor de Pedágio",
    "advance": "Adiantamentos", "advance_installments": "Parcelas do Adiantamento", "fuel": "Combustível",
    "arrival_weight": "Peso de Chegada", "weight_loss_discount": "Desconto de Quebra de Peso",
    "others": "Outros Acréscimos", "discounts": "Descontos", "inss_ceiling": "Teto do INSS",
    "contratado_monthly_inss_discount": "Desconto Mensal de INSS do Contratado",
}


@api_router.post("/rpa-terceiro", response_model=RPATerceiroResponse)
async def create_rpa_terceiro(data: RPATerceiroCreate, current_user: dict = Depends(get_current_admin_user)):
    refuse_negative(data.model_dump(), _RPA_NUMBER_LABELS)
    # Próximo número - separado por tipo (terceiro / agregado), gerado de forma
    # atômica para não duplicar número com duas criações concorrentes.
    rpa_type = data.rpa_type or "terceiro"
    counter = await db.counters.find_one_and_update(
        {"_id": f"rpa_number:{rpa_type}"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    next_num = counter["seq"]

    rpa = RPATerceiro(
        rpa_number=next_num,
        **data.model_dump(),
        created_by=current_user["sub"],
        created_by_name=current_user["name"]
    )
    rpa_dict = rpa.model_dump()
    rpa_dict["created_at"] = rpa.created_at.isoformat()
    await db.rpa_terceiro.insert_one(rpa_dict)
    return _rpa_serialize(rpa_dict)


@api_router.put("/rpa-terceiro/{rpa_id}", response_model=RPATerceiroResponse)
async def update_rpa_terceiro(rpa_id: str, data: RPATerceiroUpdate, current_user: dict = Depends(get_current_admin_user)):
    existing = await db.rpa_terceiro.find_one({"id": rpa_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="RPA não encontrado")

    # Campo enviado vazio (null) apaga o valor salvo (ex.: pedágio removido)
    update_data = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None or k not in ("driver_name", "rpa_type")}
    refuse_negative(update_data, _RPA_NUMBER_LABELS)
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.rpa_terceiro.update_one({"id": rpa_id}, {"$set": update_data})

    updated = await db.rpa_terceiro.find_one({"id": rpa_id}, {"_id": 0})
    return _rpa_serialize(updated)


@api_router.delete("/rpa-terceiro/{rpa_id}")
async def delete_rpa_terceiro(rpa_id: str, current_user: dict = Depends(get_current_admin_user)):
    result = await db.rpa_terceiro.delete_one({"id": rpa_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="RPA não encontrado")
    return {"message": "RPA removido"}


# 14 cláusulas do Contrato de Afretamento, com base no Dec. 89874/84 - texto
# padrão de mercado (mesmo usado pelo Bsoft TMS, referência fornecida pelo
# usuário em 2026-08-24), adaptado para não citar dados específicos de um
# cliente (seguradora, comarca) já que o sistema é revendido white-label -
# ver [[project-menu-checklist-rework]] na memória sobre a limpeza de marca.
CONTRATO_FRETE_CLAUSES = [
    "Através do presente instrumento de transporte, declara o Transportador que recebeu e se responsabiliza a transportar as mercadorias constantes das Notas Fiscais descritas no CTRC caracterizado abaixo, bem como entregá-las no tempo e lugar convencionados.",
    "O CONTRATADO, sendo pessoa física, está sendo contratado na qualidade de transportador autônomo, sem qualquer vínculo empregatício, devendo responder pelo recolhimento de suas contribuições previdenciárias e fiscais, estando livre, após o cumprimento deste contrato, para prestar serviços a outras empresas.",
    "Em caso de acidente com veículo e caso seja vítima de furto ou roubo, deverá o CONTRATADO comunicar o fato imediatamente à seguradora responsável, relatando detalhadamente o evento e registrando ocorrência na delegacia mais próxima, providenciando uma cópia do respectivo Boletim de Ocorrência.",
    "Somente será permitida a troca de veículo, para entrega da mercadoria no destino, em caso de pane mecânica do veículo contratado e mediante autorização da CONTRATANTE e do cliente.",
    "O prazo inicial da responsabilidade do transportador começa a fluir desde o recebimento da mercadoria para transporte e cessa com a efetiva entrega ao destinatário, mediante comprovante de entrega das mercadorias, ficando vedado ao Transportador efetivar, após a consulta de Gerenciamento de Risco e do recebimento das mercadorias, troca de condutores do veículo de transporte das mercadorias sem que haja prévio e expresso consentimento do Contratante, sob pena de caracterizar infração contratual, sujeitando o Transportador nas condições descritas na Cláusula 10 deste contrato.",
    "Fica vedado ao Transportador aceitar variação de consignação, ou seja, alteração do destinatário, inclusive de via de encaminhamento e do destino.",
    "No caso de perdas, furtos ou avarias nas mercadorias transportadas, o Transportador será responsabilizado desde o momento em que recebeu as mercadorias até a sua efetiva entrega.",
    "É de responsabilidade exclusiva do Transportador verificar, no momento em que receber as mercadorias, a ocorrência de defeito na embalagem do produto ou qualquer outra condição que possa acarretar perdas ou avarias das mercadorias transportadas.",
    "Resta estabelecido que a indenização ou liquidação do prejuízo decorrente de perdas, furtos ou avarias das mercadorias transportadas, deverá observar o preço constante no CTRC de embarque do produto. Não havendo o preço neste, aplicar-se-á o preço de mercado do produto. No caso em que a mercadoria tenha apenas o seu valor diminuído pela avaria ou dano, o apuramento do prejuízo levará em consideração a diminuição de seu valor.",
    "O prazo de entrega das mercadorias em seu destino é o constante neste documento, sendo que no caso de inadimplência de data de entrega, fica estabelecido que a responsabilidade pelo atraso na entrega deverá ser suportada exclusivamente pelo transportador.",
    "No caso de descumprimento de formalidades fiscais no curso da viagem ocasionados pelo Transportador, fica estabelecido que os danos por tal razão, tais como atraso na entrega, perecimento da mercadoria, multas, etc. serão de responsabilidade exclusiva deste.",
    "O Transportador fica responsabilizado a seguir o itinerário que for ajustado, caso determinado. Não obedecendo, responderá o Transportador pelos riscos, inclusive os que caberiam ao remetente.",
    "Será de responsabilidade do Contratado a realização do Seguro de Responsabilidade Civil, destinado à reparação dos danos causados a pessoas em decorrência de acidentes que porventura se envolvam os veículos.",
    "As partes elegem o foro da comarca da CONTRATANTE para dirimir eventuais dúvidas ou controvérsias oriundas deste contrato. E por estarem plenamente de acordo com as condições acima especificadas as partes assinam o presente contrato em 5 vias de igual teor e forma, tendo cada via a seguinte destinação: 1ª Arquivo da Contratante / 2ª Comprovante de receita de Contratado / 3ª Contabilidade do Contratante / 4ª Arquivo da Contratante (recibo de saldo) / 5ª Arquivo da Contratante (recibo de adiantamento).",
]

CONTRATO_FRETE_VIAS = [
    (1, "Arquivo da Contratante"),
    (2, "Comprovante de receita de Contratado"),
    (3, "Contabilidade"),
    (4, "Saldo"),
    (5, "Adiantamento"),
]


def _escape_for_pdf(value):
    if isinstance(value, str):
        return xml_escape(value)
    if isinstance(value, dict):
        return {k: _escape_for_pdf(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_escape_for_pdf(v) for v in value]
    return value


@api_router.get("/rpa-terceiro/{rpa_id}/pdf")
async def download_rpa_terceiro_pdf(rpa_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Gera o PDF do Contrato de Frete (Contrato de Afretamento, Dec. 89874/84) em 5 vias."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT, TA_JUSTIFY
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, PageBreak, KeepInFrame
    from reports import download_logo, PRIMARY_COLOR

    rpa = await db.rpa_terceiro.find_one({"id": rpa_id}, {"_id": 0})
    if not rpa:
        raise HTTPException(status_code=404, detail="RPA não encontrado")

    rpa['balance'] = _rpa_calc_balance(rpa)
    filename = f"ContratoFrete_{rpa['rpa_number']}_{(rpa.get('driver_name') or 'motorista').upper().replace(' ', '_')}.pdf"
    # O texto vira marcação do reportlab: sem isto, "T&L" saía como "T&L;"
    rpa = _escape_for_pdf(rpa)
    company = merge_company(await get_company_settings())
    company = {k: xml_escape(v) if k in ("name", "address", "phone", "cnpj", "email") and isinstance(v, str) else v for k, v in company.items()}

    contratado = None
    if rpa.get('contratado_id'):
        contratado = await db.transport_companies.find_one({"id": rpa['contratado_id']}, {"_id": 0})

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        leftMargin=9 * mm, rightMargin=9 * mm,
        topMargin=6 * mm, bottomMargin=6 * mm
    )

    styles = getSampleStyleSheet()
    PRIMARY = colors.HexColor(f'#{PRIMARY_COLOR}')
    RULE_COLOR = colors.HexColor('#2D3748')
    VALUE_COLOR = colors.HexColor('#1A202C')
    MUTED_COLOR = colors.HexColor('#718096')
    CONTENT_WIDTH = 192 * mm

    def money(v):
        try:
            return f"R$ {float(v or 0):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
        except Exception:
            return "R$ 0,00"

    def num(v, suffix=""):
        if v is None or v == "":
            return "-"
        try:
            return f"{float(v):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".") + suffix
        except Exception:
            return f"{v}{suffix}"

    def fmt_date_br(iso_str):
        if not iso_str:
            return "-"
        try:
            return datetime.fromisoformat(str(iso_str).replace('Z', '+00:00')).strftime('%d/%m/%Y')
        except Exception:
            return str(iso_str)

    def field_cell(label, val, size=7, val_size=8):
        return Paragraph(
            f"<font color='#4A5568' size='{size}'>{label}</font><br/>"
            f"<font color='#1A202C' size='{val_size}'><b>{val if val not in (None, '') else '-'}</b></font>",
            ParagraphStyle('Cell', parent=styles['Normal'], leading=val_size + 2)
        )

    def box(title, rows, col_widths, spans=None):
        """Caixa com título de seção (fundo cinza) + grid de campos label/valor.
        `spans` é uma lista opcional de (row, col_start, col_end) pra mesclar
        células de uma linha (ex: um campo que ocupa a largura toda)."""
        elems = []
        title_bar = Table([[Paragraph(f"<b>{title}</b>", ParagraphStyle('BoxTitle', parent=styles['Normal'], fontSize=8, textColor=colors.white))]], colWidths=[CONTENT_WIDTH])
        title_bar.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), RULE_COLOR),
            ('TOPPADDING', (0, 0), (-1, -1), 3),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
            ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ]))
        elems.append(title_bar)
        grid = Table(rows, colWidths=col_widths)
        style_cmds = [
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('BOX', (0, 0), (-1, -1), 0.5, colors.HexColor('#CBD5E0')),
            ('LEFTPADDING', (0, 0), (-1, -1), 5),
            ('RIGHTPADDING', (0, 0), (-1, -1), 5),
            ('TOPPADDING', (0, 0), (-1, -1), 2),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
        ]
        for row, col_start, col_end in (spans or []):
            style_cmds.append(('SPAN', (col_start, row), (col_end, row)))
        grid.setStyle(TableStyle(style_cmds))
        elems.append(grid)
        return elems

    def build_via(via_num, via_label):
        elements = []

        # ===== CABEÇALHO =====
        logo_buffer = download_logo(company)
        header_left = []
        if logo_buffer:
            img = Image(logo_buffer, width=14 * mm, height=14 * mm)
            header_left.append(img)
        company_block = Paragraph(
            f"<font size='11'><b>{company['name']}</b></font><br/>"
            f"<font size='7'>{(company.get('address') or '').replace(chr(10), ', ')}</font><br/>"
            f"<font size='7'>Fone: {company.get('phone') or '-'} | CNPJ: {company.get('cnpj') or '-'}</font><br/>"
            f"<font size='7'>{company.get('email') or ''}</font>",
            ParagraphStyle('CompanyBlock', parent=styles['Normal'], alignment=TA_LEFT, leading=9)
        )
        header_right = Paragraph(
            f"<font size='9'><b>Nº {rpa['rpa_number']}</b></font><br/>"
            f"<font size='7'>Emissão: {fmt_date_br(rpa.get('emission_date')) if rpa.get('emission_date') else now_brt().strftime('%d/%m/%Y')}</font>",
            ParagraphStyle('HeaderRight', parent=styles['Normal'], alignment=TA_RIGHT, leading=9)
        )
        header_table = Table([[header_left if header_left else "", company_block, header_right]], colWidths=[16 * mm, 136 * mm, 40 * mm])
        header_table.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('LEFTPADDING', (0, 0), (-1, -1), 0),
            ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ]))
        elements.append(header_table)
        elements.append(Spacer(1, 3))

        title_style = ParagraphStyle(
            'DocTitle', parent=styles['Normal'], fontSize=10, leading=12,
            alignment=TA_CENTER, fontName='Helvetica-Bold', textColor=PRIMARY
        )
        elements.append(Paragraph(
            f"CONTRATO DE AFRETAMENTO &nbsp;-&nbsp; {via_num}ª Via &nbsp;-&nbsp; {via_label}",
            title_style
        ))
        elements.append(Spacer(1, 4))

        # ===== CONTRATADO =====
        contratado_name = rpa.get('contratado_name') or (contratado or {}).get('name')
        contratado_cnpj = (contratado or {}).get('cnpj')
        elements += box("Contratado", [
            [field_cell("Nome/CNPJ", f"{contratado_name or '-'}{(' / ' + contratado_cnpj) if contratado_cnpj else ''}"),
             field_cell("Talão", rpa.get('talao')),
             field_cell("CIOT", rpa.get('ciot'))],
        ], [116 * mm, 30 * mm, 46 * mm])
        elements.append(Spacer(1, 3))

        # ===== MOTORISTA / VEÍCULOS =====
        placas = " / ".join(filter(None, [
            f"Principal: {rpa['truck_plate']}" if rpa.get('truck_plate') else None,
            f"Vinculado 01: {rpa['trailer_plate']}" if rpa.get('trailer_plate') else None,
            f"Vinculado 02: {rpa['trailer2_plate']}" if rpa.get('trailer2_plate') else None,
        ])) or "-"
        elements += box("Motorista", [
            [field_cell("Nome/CPF", f"{rpa.get('driver_name') or '-'} / {rpa.get('driver_cpf') or '-'}"),
             field_cell("Telefone", rpa.get('driver_phone'))],
            [field_cell("Placas", placas), ""],
        ], [130 * mm, 62 * mm], spans=[(1, 0, 1)])
        elements.append(Spacer(1, 4))

        # ===== TEXTO INTRODUTÓRIO + CLÁUSULAS =====
        clause_style = ParagraphStyle(
            'Clause', parent=styles['Normal'], fontSize=6.3, leading=7.6,
            alignment=TA_JUSTIFY, textColor=VALUE_COLOR, spaceAfter=1.5
        )
        elements.append(Paragraph(
            "As partes acima identificadas contratam com base no Dec. 89874, de 28/06/84, o serviço de transporte "
            "nas seguintes condições:", clause_style
        ))
        for idx, clause in enumerate(CONTRATO_FRETE_CLAUSES, start=1):
            elements.append(Paragraph(f"{idx} - {clause}", clause_style))
        elements.append(Spacer(1, 4))

        # ===== DADOS DO TRANSPORTE =====
        elements += box("Dados do Transporte", [
            [field_cell("Local Coleta", rpa.get('origin')),
             field_cell("Local Entrega", rpa.get('destination')),
             field_cell("Prazo Entrega", fmt_date_br(rpa.get('delivery_date')))],
            [field_cell("Data Inicial da Viagem", fmt_date_br(rpa.get('trip_start_date'))),
             field_cell("Data Final da Viagem", fmt_date_br(rpa.get('trip_end_date'))),
             field_cell("Forma de Pagamento", rpa.get('payment_method'))],
            [field_cell("Cliente", rpa.get('client_name')),
             field_cell("CT-e", rpa.get('cte')),
             field_cell("Container", rpa.get('container_number'))],
        ], [64 * mm, 64 * mm, 64 * mm])
        elements.append(Spacer(1, 3))

        # ===== DADOS DA CARGA =====
        cargo_items = rpa.get('cargo_items') or []
        cargo_header = [Paragraph(f"<font size='6.5'><b>{h}</b></font>", styles['Normal']) for h in
                         ["Nro NF", "Natureza", "Espécie", "Qtd.", "Kg", "M³", "Valor"]]
        cargo_data = [cargo_header]
        if not cargo_items:
            cargo_data.append([Paragraph("<font size='7'>-</font>", styles['Normal'])] * 7)
        else:
            for c in cargo_items:
                cargo_data.append([
                    Paragraph(f"<font size='7'>{c.get('nf_number') or '-'}</font>", styles['Normal']),
                    Paragraph(f"<font size='7'>{c.get('nature') or '-'}</font>", styles['Normal']),
                    Paragraph(f"<font size='7'>{c.get('species') or '-'}</font>", styles['Normal']),
                    Paragraph(f"<font size='7'>{c.get('quantity') or '-'}</font>", styles['Normal']),
                    Paragraph(f"<font size='7'>{num(c.get('weight_kg'))}</font>", styles['Normal']),
                    Paragraph(f"<font size='7'>{num(c.get('cubage_m3'))}</font>", styles['Normal']),
                    Paragraph(f"<font size='7'>{money(c.get('value'))}</font>", styles['Normal']),
                ])
        cargo_table = Table(cargo_data, colWidths=[28 * mm, 46 * mm, 28 * mm, 18 * mm, 22 * mm, 20 * mm, 30 * mm])
        cargo_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#EDF2F7')),
            ('GRID', (0, 0), (-1, -1), 0.4, colors.HexColor('#CBD5E0')),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('TOPPADDING', (0, 0), (-1, -1), 2), ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
            ('LEFTPADDING', (0, 0), (-1, -1), 3), ('RIGHTPADDING', (0, 0), (-1, -1), 3),
        ]))
        elements.append(Paragraph("<b><font size='8'>Dados da Carga</font></b>", ParagraphStyle('T', parent=styles['Normal'], spaceAfter=2)))
        elements.append(cargo_table)
        elements.append(Spacer(1, 2))
        elements.append(Paragraph(
            f"<font size='7'><b>Relação de Documentos:</b> {rpa.get('documents_list') or '-'}</font>",
            ParagraphStyle('Docs', parent=styles['Normal'], leading=9)
        ))
        elements.append(Spacer(1, 4))

        # ===== VALORES =====
        val_rows = [
            [field_cell("Frete", money(rpa.get('service_value')), val_size=9),
             field_cell("(-) Adiantamento", money(rpa.get('advance'))),
             field_cell("(-) Desconto INSS", (num(rpa.get('inss_discount_percent'), '%') if rpa.get('inss_discount_percent') is not None else '-'))],
            [field_cell("(-) IRRF", money(rpa.get('irrf_discount'))),
             field_cell("(-) Outros Descontos", money(rpa.get('other_discounts'))),
             field_cell("(-) SEST/SENAT", (num(rpa.get('sest_senat_discount_percent'), '%') if rpa.get('sest_senat_discount_percent') is not None else '-'))],
            [field_cell("(+) Diária", money(rpa.get('daily_rate'))),
             field_cell("(+) Pedágio", money(rpa.get('toll_value'))),
             field_cell("(+) Outros Acréscimos", money(rpa.get('others')))],
            [field_cell("Frete Líquido", money(rpa.get('net_freight')), val_size=9),
             field_cell("Saldo", money(rpa['balance']), val_size=9),
             field_cell("Combustível", money(rpa.get('fuel')))],
        ]
        elements += box("Valores", val_rows, [64 * mm, 64 * mm, 64 * mm])
        elements.append(Spacer(1, 3))

        # ===== COMPOSIÇÃO DO FRETE =====
        elements += box("Composição do Frete", [
            [field_cell("Peso de Coleta", num(rpa.get('collection_weight'), ' Kg')),
             field_cell("Peso de Chegada", num(rpa.get('arrival_weight'), ' Kg')),
             field_cell("(-) Seguro", money(rpa.get('insurance_discount')))],
        ], [64 * mm, 64 * mm, 64 * mm])
        elements.append(Spacer(1, 3))

        if rpa.get('observations'):
            elements.append(Paragraph(
                f"<font size='7'><b>Observações/Instruções de Transporte:</b> {rpa['observations']}</font>",
                ParagraphStyle('Obs', parent=styles['Normal'], leading=9)
            ))
            elements.append(Spacer(1, 4))

        # ===== ASSINATURAS =====
        sig_label_style = ParagraphStyle('SigLabel', parent=styles['Normal'], fontSize=7.5, alignment=TA_CENTER, fontName='Helvetica-Bold', textColor=VALUE_COLOR)
        sign_data = [
            [Paragraph("&nbsp;", styles['Normal']), Paragraph("&nbsp;", styles['Normal'])],
            [Paragraph("Contratante", sig_label_style), Paragraph(f"Motorista: {rpa.get('driver_name') or '-'}", sig_label_style)],
        ]
        sign_table = Table(sign_data, colWidths=[96 * mm, 96 * mm], rowHeights=[16, None])
        sign_table.setStyle(TableStyle([
            ('LINEABOVE', (0, 1), (-1, 1), 0.5, RULE_COLOR),
            ('TOPPADDING', (0, 0), (-1, -1), 1), ('BOTTOMPADDING', (0, 0), (-1, -1), 1),
        ]))
        elements.append(sign_table)
        elements.append(Spacer(1, 3))

        footer_meta_style = ParagraphStyle('FooterMeta', parent=styles['Normal'], fontSize=6.5, leading=8, alignment=TA_LEFT, textColor=MUTED_COLOR)
        elements.append(Paragraph(
            f"Manifestador: {rpa.get('created_by_name') or '-'} &nbsp;|&nbsp; Impresso em: {now_brt().strftime('%d/%m/%Y %H:%M')} "
            f"&nbsp;|&nbsp; Página {via_num} de 5",
            footer_meta_style
        ))

        return elements

    all_elements = []
    for i, (via_num, via_label) in enumerate(CONTRATO_FRETE_VIAS):
        if i > 0:
            all_elements.append(PageBreak())
        # Cada via é uma folha: com muita carga ou observação longa, reduz em vez de quebrar
        all_elements.append(KeepInFrame(doc.width, doc.height - 12, build_via(via_num, via_label), mode="shrink"))

    doc.build(all_elements)
    pdf_bytes = buffer.getvalue()
    buffer.close()

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


