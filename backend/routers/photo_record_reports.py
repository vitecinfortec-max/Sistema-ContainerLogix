from collections import Counter
from typing import Optional

from fastapi import APIRouter, Depends, Query

from period_reports import Column, Section, DAY, INT, pdf_response, excel_response, period_text
from routers.container_inspections import inspection_query
from routers.container_reports import _day
from routers.container_vistorias import DAMAGE_PATTERN, vistoria_query
from reports import short_person_name
from shared import db, get_current_active_user

api_router = APIRouter(prefix="/api")

# ==================== VISTORIA E REGISTRO FOTOGRÁFICO - RELATÓRIO DO PERÍODO ====================
# As duas telas só tinham o PDF de cada registro. Aqui: quantos containers
# foram vistoriados, com e sem avaria, por cliente, os serviços/itens de
# avaria mais frequentes e os registros incompletos (estado não marcado, sem
# fotos e, na Vistoria, sem a EIR de entrada).

DAMAGE_LABELS = {"COM_AVARIA": "Com avaria", "SEM_AVARIA": "Sem avarias", "NAO_INFORMADO": "Não informado"}


def _state(doc) -> str:
    if doc.get("no_damage"):
        return "SEM_AVARIA"
    return "COM_AVARIA" if doc.get("damage_items") else "NAO_INFORMADO"


async def _build(collection, query, number_field, is_vistoria) -> dict:
    docs = await db[collection].find(query, {"_id": 0}).sort(number_field, 1).to_list(None)
    rows, clients, items = [], {}, Counter()
    summary = {"count": 0, "SEM_AVARIA": 0, "COM_AVARIA": 0, "NAO_INFORMADO": 0, "without_photos": 0, "without_eir": 0}
    for doc in docs:
        state = _state(doc)
        photos = len(doc.get("photos") or [])
        pending = []
        if state == "NAO_INFORMADO":
            pending.append("Estado não marcado")
        if not photos:
            pending.append("Sem fotos")
        if is_vistoria and not doc.get("movement_id"):
            pending.append("Sem EIR de entrada")
            summary["without_eir"] += 1
        summary["count"] += 1
        summary[state] += 1
        summary["without_photos"] += 0 if photos else 1
        items.update(doc.get("damage_items") or [])
        client = doc.get("client_name") or "(sem cliente)"
        c = clients.setdefault(client, {"client_name": client, "count": 0, "SEM_AVARIA": 0, "COM_AVARIA": 0, "NAO_INFORMADO": 0})
        c["count"] += 1
        c[state] += 1
        rows.append({
            "number": doc.get(number_field),
            "day": _day(doc.get("created_at")),
            "container_number": doc.get("container_number"),
            "client_name": doc.get("client_name"),
            "shipping_line": doc.get("shipping_line") if is_vistoria else doc.get("shipping_line_name"),
            "transport_company": doc.get("transport_company"),
            "driver_name": doc.get("driver_name"),
            "truck_plate": doc.get("truck_plate"),
            "booking": doc.get("booking"),
            "eir_number": doc.get("movement_transaction_id"),
            "state": state,
            "damage_count": len(doc.get("damage_items") or []),
            "photos": photos,
            "pending": "; ".join(pending),
            "created_by_name": doc.get("created_by_name"),
        })
    return {
        "rows": rows,
        "clients": sorted(clients.values(), key=lambda c: (-c["count"], c["client_name"])),
        "items": [{"item": name, "count": count} for name, count in items.most_common()],
        "summary": summary,
    }


def _sections(data, is_vistoria, item_label):
    plural, singular = item_label
    s = data["summary"]
    by_client = Section(
        "Por cliente",
        [Column("Cliente", width=40), Column("Registros", INT, 10), Column("Sem avarias", INT, 11),
         Column("Com avaria", INT, 11), Column("Não informado", INT, 12)],
        [[c["client_name"], c["count"], c["SEM_AVARIA"], c["COM_AVARIA"], c["NAO_INFORMADO"]] for c in data["clients"]],
        total=["TOTAL", s["count"], s["SEM_AVARIA"], s["COM_AVARIA"], s["NAO_INFORMADO"]],
        empty_text="Nenhum registro no período.", sheet_name="Por cliente",
    )
    items = Section(
        f"{plural} mais frequentes",
        [Column(singular, width=50), Column("Containers", INT, 12)],
        [[i["item"], i["count"]] for i in data["items"]],
        empty_text="Nenhuma avaria marcada no período.", sheet_name="Avarias",
    )
    if is_vistoria:
        columns = [Column("Nº", INT, 6), Column("Data", DAY, 9), Column("Container", width=14), Column("Cliente", width=20),
                   Column("Transportadora", width=18), Column("Motorista", width=18), Column("Placa", width=9, align="center"),
                   Column("EIR", INT, 7), Column("Estado", width=11, align="center"), Column("Serviços", INT, 7),
                   Column("Fotos", INT, 6), Column("Pendências", width=22)]
        values = lambda r: [r["number"], r["day"], r["container_number"], r["client_name"], r["transport_company"], short_person_name(r["driver_name"]),
                            r["truck_plate"], r["eir_number"], DAMAGE_LABELS[r["state"]], r["damage_count"], r["photos"], r["pending"]]
    else:
        columns = [Column("Nº", INT, 6), Column("Data", DAY, 9), Column("Container", width=14), Column("Cliente", width=22),
                   Column("Armador", width=16), Column("Booking", width=14), Column("Estado", width=11, align="center"),
                   Column("Itens", INT, 7), Column("Fotos", INT, 6), Column("Responsável", width=16), Column("Pendências", width=20)]
        values = lambda r: [r["number"], r["day"], r["container_number"], r["client_name"], r["shipping_line"], r["booking"],
                            DAMAGE_LABELS[r["state"]], r["damage_count"], r["photos"], r["created_by_name"], r["pending"]]
    detail = Section("Registros", columns, [values(r) for r in data["rows"]], empty_text="Nenhum registro no período.", sheet_name="Registros")
    return [by_client, items, detail]


def _subtitle(date_from, date_to, damage, search):
    parts = [period_text("Data", date_from, date_to), DAMAGE_LABELS.get(damage), f"Busca: {search}" if search else None]
    return " · ".join(p for p in parts if p) or None


def _info(data, is_vistoria):
    s = data["summary"]
    info = [("Registros", str(s["count"])), ("Sem avarias", str(s["SEM_AVARIA"])), ("Com avaria", str(s["COM_AVARIA"])),
            ("Estado não marcado", str(s["NAO_INFORMADO"])), ("Sem fotos", str(s["without_photos"]))]
    if is_vistoria:
        info.append(("Sem EIR de entrada", str(s["without_eir"])))
    return info


REPORTS = {
    "container-vistorias": ("container_vistorias", vistoria_query, "vistoria_number", True, ("Serviços", "Serviço"),
                            "Relatório de Vistorias de Container", "relatorio_vistorias"),
    "container-inspections": ("container_inspections", inspection_query, "inspection_number", False, ("Itens com avaria", "Item"),
                              "Relatório de Registros Fotográficos", "relatorio_registros_fotograficos"),
}


def _register(slug):
    collection, build_query, number_field, is_vistoria, item_label, title, filename = REPORTS[slug]

    async def build(date_from, date_to, damage, search):
        return await _build(collection, build_query(search, date_from, date_to, damage), number_field, is_vistoria)

    @api_router.get(f"/reports/{slug}", name=f"{slug}-report")
    async def get_report(
        date_from: Optional[str] = None, date_to: Optional[str] = None,
        damage: Optional[str] = Query(None, pattern=DAMAGE_PATTERN), search: Optional[str] = None,
        current_user: dict = Depends(get_current_active_user),
    ):
        return await build(date_from, date_to, damage, search)

    @api_router.get(f"/reports/{slug}/pdf", name=f"{slug}-report-pdf")
    async def get_report_pdf(
        date_from: Optional[str] = None, date_to: Optional[str] = None,
        damage: Optional[str] = Query(None, pattern=DAMAGE_PATTERN), search: Optional[str] = None,
        current_user: dict = Depends(get_current_active_user),
    ):
        data = await build(date_from, date_to, damage, search)
        return await pdf_response(title, _subtitle(date_from, date_to, damage, search), _info(data, is_vistoria),
                                  _sections(data, is_vistoria, item_label), filename, current_user.get("name", "Sistema"))

    @api_router.get(f"/reports/{slug}/excel", name=f"{slug}-report-excel")
    async def get_report_excel(
        date_from: Optional[str] = None, date_to: Optional[str] = None,
        damage: Optional[str] = Query(None, pattern=DAMAGE_PATTERN), search: Optional[str] = None,
        current_user: dict = Depends(get_current_active_user),
    ):
        data = await build(date_from, date_to, damage, search)
        return await excel_response(title, _subtitle(date_from, date_to, damage, search) or "Todos os registros",
                                    _sections(data, is_vistoria, item_label), filename)


for _slug in REPORTS:
    _register(_slug)
