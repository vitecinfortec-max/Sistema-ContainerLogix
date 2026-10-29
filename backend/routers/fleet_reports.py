from typing import Optional

from fastapi import APIRouter, Depends

from list_filters import combine, period_query, text_query
from period_reports import Column, Section, DAY, INT, pdf_response, excel_response, period_text
from routers.container_reports import _day
from routers.frota import _compute_vehicle_maintenance_status
from shared import db, get_current_active_user, plate_key

api_router = APIRouter(prefix="/api")

# ==================== FROTA - RELATÓRIO DE REVISÕES ====================
# O Controle de Revisão só tinha o PDF de cada revisão. Aqui: as revisões do
# período (pela data da revisão), o resumo por veículo, a situação de
# manutenção de hoje de cada veículo ativo e os veículos que nunca tiveram
# revisão lançada (sem ela o sistema não consegue avisar a próxima troca).

MAINTENANCE_LABELS = {"OK": "Em dia", "DUE_SOON": "Próxima", "OVERDUE": "Vencida"}
MAINTENANCE_ORDER = {"OVERDUE": 0, "DUE_SOON": 1, "OK": 2}


async def build_revision_report(date_from=None, date_to=None, plate=None) -> dict:
    query = combine(period_query("revision_date", date_from, date_to), text_query(("vehicle_plate", "vehicle_model"), plate))
    revisions = await db.vehicle_revisions.find(query, {"_id": 0}).sort("revision_date", 1).to_list(None)

    rows, vehicles = [], {}
    for r in revisions:
        row = {
            "revision_number": r.get("revision_number"),
            "day": _day(r.get("revision_date")),
            "vehicle_plate": (r.get("vehicle_plate") or "").upper(),
            "vehicle_model": r.get("vehicle_model"),
            "current_km": r.get("current_km"),
            "oil_used": r.get("oil_used"),
            "mechanic_name": r.get("mechanic_name"),
            "performed_by": r.get("performed_by"),
        }
        rows.append(row)
        v = vehicles.setdefault(row["vehicle_plate"], {"vehicle_plate": row["vehicle_plate"], "vehicle_model": row["vehicle_model"],
                                                       "count": 0, "last_day": None, "last_km": None})
        v["count"] += 1
        if (row["day"] or "") >= (v["last_day"] or ""):
            v["last_day"], v["last_km"] = row["day"], row["current_km"]

    # Situação de hoje: todos os veículos com hodômetro próprio, ativos
    active = await db.vehicles.find(
        {"vehicle_type": {"$in": ["CAVALO", "CAMINHÃO"]}, "status": "ATIVO"}, {"_id": 0, "id": 1, "plate": 1, "model": 1}
    ).to_list(None)
    plate_re = (plate or "").strip().upper()
    maintenance, without_revision = [], []
    for vehicle in active:
        if plate_re and plate_key(plate_re) not in plate_key(vehicle.get("plate")) and plate_re not in (vehicle.get("model") or "").upper():
            continue
        status = await _compute_vehicle_maintenance_status(vehicle)
        if status:
            maintenance.append(status)
        else:
            without_revision.append({"vehicle_plate": (vehicle.get("plate") or "").upper(), "vehicle_model": vehicle.get("model")})
    maintenance.sort(key=lambda m: (MAINTENANCE_ORDER.get(m["status"], 3), m["km_remaining"]))
    without_revision.sort(key=lambda v: v["vehicle_plate"])

    return {
        "rows": rows,
        "vehicles": sorted(vehicles.values(), key=lambda v: v["vehicle_plate"]),
        "maintenance": maintenance,
        "without_revision": without_revision,
        "summary": {
            "revisions": len(rows),
            "vehicles_revised": len(vehicles),
            "overdue": sum(1 for m in maintenance if m["status"] == "OVERDUE"),
            "due_soon": sum(1 for m in maintenance if m["status"] == "DUE_SOON"),
            "without_revision": len(without_revision),
        },
    }


def _sections(data):
    situation = Section(
        "Situação de manutenção hoje",
        [Column("Placa", width=10, align="center"), Column("Modelo", width=22), Column("KM atual", INT, 11),
         Column("Próxima troca (KM)", INT, 14), Column("Faltam (KM)", INT, 11), Column("Itens", width=34),
         Column("Situação", width=10, align="center")],
        [[m["vehicle_plate"], m["vehicle_model"], m["current_km"], m["next_due_km"], m["km_remaining"],
          ", ".join(m["next_due_items"]), MAINTENANCE_LABELS.get(m["status"], m["status"])] for m in data["maintenance"]],
        empty_text="Nenhum veículo ativo com revisão lançada.", sheet_name="Situação hoje",
    )
    missing = Section(
        "Veículos ativos sem nenhuma revisão lançada",
        [Column("Placa", width=12, align="center"), Column("Modelo", width=40)],
        [[v["vehicle_plate"], v["vehicle_model"]] for v in data["without_revision"]],
        empty_text="Todos os veículos ativos têm revisão lançada.", sheet_name="Sem revisão",
    )
    by_vehicle = Section(
        "Por veículo no período",
        [Column("Placa", width=12, align="center"), Column("Modelo", width=28), Column("Revisões", INT, 10),
         Column("Última revisão", DAY, 12), Column("KM na última", INT, 12)],
        [[v["vehicle_plate"], v["vehicle_model"], v["count"], v["last_day"], v["last_km"]] for v in data["vehicles"]],
        total=["TOTAL", None, data["summary"]["revisions"], None, None],
        empty_text="Nenhuma revisão no período.", sheet_name="Por veículo",
    )
    detail = Section(
        "Revisões do período",
        [Column("Nº", INT, 7), Column("Data", DAY, 10), Column("Placa", width=10, align="center"), Column("Modelo", width=20),
         Column("KM", INT, 10), Column("Óleo", width=20), Column("Mecânico", width=18), Column("Realizado por", width=18)],
        [[r["revision_number"], r["day"], r["vehicle_plate"], r["vehicle_model"], r["current_km"], r["oil_used"],
          r["mechanic_name"], r["performed_by"]] for r in data["rows"]],
        empty_text="Nenhuma revisão no período.", sheet_name="Revisões",
    )
    return [situation, missing, by_vehicle, detail]


def _subtitle(date_from, date_to, plate):
    parts = [period_text("Revisões", date_from, date_to), f"Veículo: {plate}" if plate else None]
    return " · ".join(p for p in parts if p) or None


@api_router.get("/reports/vehicle-revisions")
async def get_revision_report(
    date_from: Optional[str] = None, date_to: Optional[str] = None, plate: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user),
):
    """Revisões do período, resumo por veículo e situação de manutenção de hoje"""
    return await build_revision_report(date_from, date_to, plate)


@api_router.get("/reports/vehicle-revisions/pdf")
async def get_revision_report_pdf(
    date_from: Optional[str] = None, date_to: Optional[str] = None, plate: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user),
):
    data = await build_revision_report(date_from, date_to, plate)
    s = data["summary"]
    info = [("Revisões no período", str(s["revisions"])), ("Veículos revisados", str(s["vehicles_revised"])),
            ("Troca vencida", str(s["overdue"])), ("Troca próxima", str(s["due_soon"])),
            ("Sem revisão lançada", str(s["without_revision"]))]
    return await pdf_response("Relatório de Revisões da Frota", _subtitle(date_from, date_to, plate), info,
                              _sections(data), "relatorio_revisoes", current_user.get("name", "Sistema"))


@api_router.get("/reports/vehicle-revisions/excel")
async def get_revision_report_excel(
    date_from: Optional[str] = None, date_to: Optional[str] = None, plate: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user),
):
    data = await build_revision_report(date_from, date_to, plate)
    return await excel_response("Relatório de Revisões da Frota", _subtitle(date_from, date_to, plate) or "Todas as revisões",
                                _sections(data), "relatorio_revisoes")
