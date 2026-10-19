from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from period_reports import Column, Section, MONEY, INT, TEXT, pdf_response, excel_response, period_text
from reports import BRT_TZ, format_currency
from routers.financial_reports import _in_period, _r
from shared import db, get_current_admin_user, get_disabled_modules, is_module_disabled, parse_datetime_value

api_router = APIRouter(prefix="/api")

# ==================== FINANCEIRO - RESUMO FINANCEIRO ====================
# Uma visão só do que entrou e saiu no período, somando o que antes ficava
# espalhado em várias telas, e da posição atual do que falta receber e pagar.
# Cada linha vem de um módulo; módulo não contratado fica de fora.
# Observação: um cheque compensado pode ser o meio de pagamento de outra saída
# (ex.: um frete pago com cheque) - por isso cheques aparecem em linha própria.


def _day(value) -> Optional[str]:
    if not value:
        return None
    if isinstance(value, str) and len(value) == 10:
        return value
    try:
        return parse_datetime_value(value).astimezone(BRT_TZ).date().isoformat()
    except Exception:
        return None


def _line(key, label, module, docs, value_of, day_of=None, note=None):
    return {"key": key, "label": label, "module": module, "docs": docs, "value_of": value_of, "day_of": day_of, "note": note}


async def build_financial_summary(date_from: Optional[str], date_to: Optional[str]) -> dict:
    disabled = await get_disabled_modules()
    enabled = lambda module: not is_module_disabled(module, disabled)

    async def find(collection, query, module):
        return await db[collection].find(query, {"_id": 0}).to_list(None) if enabled(module) else None

    invoices_paid = await find("invoices", {"status": "PAGO"}, "financeiro.faturas")
    invoices_open = await find("invoices", {"status": {"$in": ["PENDENTE", None]}}, "financeiro.faturas")
    port_paid = await find("port_service_billing_batches", {"status": "PAGO"}, "financeiro.faturamento_portuario")
    port_open = await find("port_service_billing_batches", {"status": "PENDENTE"}, "financeiro.faturamento_portuario")
    sales_received = await find("container_sales", {"status": "RECEBIDO"}, "gestao_container.venda")
    sales_open = await find("container_sales", {"status": "PENDENTE"}, "gestao_container.venda")
    checks_comp = await find("checks", {"status": "COMPENSADO"}, "financeiro.controle_cheque")
    checks_open = await find("checks", {"status": "EMITIDO"}, "financeiro.controle_cheque")
    freight_paid = await find("freight_payments", {"status": "PAGO"}, "financeiro.pagamento_frete")
    freight_open = await find("freight_payments", {"status": "PENDENTE"}, "financeiro.pagamento_frete")
    daily_paid = await find("daily_rate_requests", {"status": "PAGO"}, "financeiro.diaria")
    daily_open = await find("daily_rate_requests", {"status": "PENDENTE"}, "financeiro.diaria")
    expense_reports = await find("expense_reports", {}, "financeiro.prestacao_contas")
    purchases = await find("container_purchases", {}, "gestao_container.compra")

    deposits = None
    if expense_reports is not None:
        deposits = [d for rep in expense_reports for d in rep.get("deposits") or []]

    legacy_paid_invoices = sum(1 for i in invoices_paid or [] if not i.get("paid_date"))

    inflows = [
        _line("invoices", "Faturas recebidas", "financeiro.faturas", invoices_paid, lambda d: d.get("total_value"), lambda d: d.get("paid_date"),
              note=f"{legacy_paid_invoices} fatura(s) paga(s) antes da data de recebimento existir ficam de fora" if legacy_paid_invoices else None),
        _line("port_billing", "Faturamento Portuário recebido", "financeiro.faturamento_portuario", port_paid,
              lambda d: d.get("net_total", d.get("total_value")), lambda d: _day(d.get("paid_at"))),
        _line("container_sales", "Vendas de container recebidas", "gestao_container.venda", sales_received,
              lambda d: d.get("received_value") if d.get("received_value") is not None else d.get("sale_value"), lambda d: _day(d.get("received_at"))),
    ]
    outflows = [
        _line("checks", "Cheques compensados", "financeiro.controle_cheque", checks_comp, lambda d: d.get("amount"), lambda d: d.get("compensation_date"),
              note="o cheque pode ter sido o meio de pagamento de outra saída desta lista"),
        _line("freight", "Pagamento de frete", "financeiro.pagamento_frete", freight_paid, lambda d: d.get("freight_value"), lambda d: _day(d.get("paid_at"))),
        _line("daily", "Diárias pagas", "financeiro.diaria", daily_paid, lambda d: d.get("total_value"),
              lambda d: _day(d.get("paid_at") or d.get("updated_at"))),
        _line("expense_deposits", "Depósitos para Prestação de Contas", "financeiro.prestacao_contas", deposits, lambda d: d.get("amount"), lambda d: d.get("date")),
        _line("container_purchases", "Compras de container", "gestao_container.compra", purchases, lambda d: d.get("purchase_value"),
              lambda d: _day(d.get("entry_date") or d.get("created_at"))),
    ]
    receivable = [
        _line("invoices_open", "Faturas em aberto", "financeiro.faturas", invoices_open, lambda d: d.get("total_value")),
        _line("port_open", "Faturamento Portuário pendente", "financeiro.faturamento_portuario", port_open, lambda d: d.get("net_total", d.get("total_value"))),
        _line("sales_open", "Vendas de container a receber", "gestao_container.venda", sales_open,
              lambda d: (d.get("sale_value") or 0) - (d.get("received_value") or 0)),
    ]
    payable = [
        _line("checks_open", "Cheques emitidos a compensar", "financeiro.controle_cheque", checks_open, lambda d: d.get("amount")),
        _line("freight_open", "Fretes a pagar", "financeiro.pagamento_frete", freight_open, lambda d: d.get("freight_value")),
        _line("daily_open", "Diárias a pagar", "financeiro.diaria", daily_open, lambda d: d.get("total_value")),
    ]

    def resolve(lines, use_period):
        out = []
        for line in lines:
            if line["docs"] is None:
                continue
            docs = [d for d in line["docs"] if not use_period or _in_period(line["day_of"](d), date_from, date_to)]
            out.append({"key": line["key"], "label": line["label"], "count": len(docs),
                        "total": _r(sum(line["value_of"](d) or 0 for d in docs)), "note": line["note"]})
        return out

    ins, outs = resolve(inflows, True), resolve(outflows, True)
    to_receive, to_pay = resolve(receivable, False), resolve(payable, False)
    total = lambda rows: _r(sum(r["total"] for r in rows))
    return {
        "inflows": ins, "outflows": outs, "receivable": to_receive, "payable": to_pay,
        "summary": {
            "inflow_total": total(ins), "outflow_total": total(outs), "balance": _r(total(ins) - total(outs)),
            "receivable_total": total(to_receive), "payable_total": total(to_pay),
        },
    }


def _sections(data):
    s = data["summary"]
    cols = lambda title: [Column(title, width=40), Column("Lançamentos", INT, 10), Column("Valor", MONEY, 14), Column("Observação", TEXT, 40)]
    rows = lambda items: [[i["label"], i["count"], i["total"], i["note"]] for i in items]
    return [
        Section("Entradas no período", cols("Entrada"), rows(data["inflows"]), total=["TOTAL", None, s["inflow_total"], None],
                empty_text="Nenhum módulo de entrada contratado.", sheet_name="Entradas"),
        Section("Saídas no período", cols("Saída"), rows(data["outflows"]), total=["TOTAL", None, s["outflow_total"], None],
                empty_text="Nenhum módulo de saída contratado.", sheet_name="Saídas"),
        Section("A receber (posição de hoje)", cols("A receber"), rows(data["receivable"]), total=["TOTAL", None, s["receivable_total"], None],
                empty_text="Nada a receber.", sheet_name="A receber"),
        Section("A pagar (posição de hoje)", cols("A pagar"), rows(data["payable"]), total=["TOTAL", None, s["payable_total"], None],
                empty_text="Nada a pagar.", sheet_name="A pagar"),
    ]


def _require_period(date_from, date_to):
    if not date_from or not date_to:
        raise HTTPException(status_code=400, detail="Informe o período (de e até)")


@api_router.get("/reports/financial-summary")
async def get_financial_summary(date_from: Optional[str] = Query(None), date_to: Optional[str] = Query(None),
                                current_user: dict = Depends(get_current_admin_user)):
    _require_period(date_from, date_to)
    return await build_financial_summary(date_from, date_to)


@api_router.get("/reports/financial-summary/pdf")
async def get_financial_summary_pdf(date_from: Optional[str] = Query(None), date_to: Optional[str] = Query(None),
                                    current_user: dict = Depends(get_current_admin_user)):
    _require_period(date_from, date_to)
    data = await build_financial_summary(date_from, date_to)
    s = data["summary"]
    money = lambda v: format_currency(v, "BRL")
    info = [("Entradas", money(s["inflow_total"])), ("Saídas", money(s["outflow_total"])), ("Saldo do período", money(s["balance"])),
            ("A receber / a pagar hoje", f"{money(s['receivable_total'])} / {money(s['payable_total'])}")]
    return await pdf_response("Resumo Financeiro", period_text("Período", date_from, date_to), info, _sections(data),
                              "resumo_financeiro", current_user.get("name", "Sistema"))


@api_router.get("/reports/financial-summary/excel")
async def get_financial_summary_excel(date_from: Optional[str] = Query(None), date_to: Optional[str] = Query(None),
                                      current_user: dict = Depends(get_current_admin_user)):
    _require_period(date_from, date_to)
    data = await build_financial_summary(date_from, date_to)
    return await excel_response("Resumo Financeiro", period_text("Período", date_from, date_to), _sections(data), "resumo_financeiro")
