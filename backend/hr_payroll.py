"""RH - motor de cálculo da folha (sem banco): INSS progressivo, IRRF (com a
redução da Lei 15.270/2025), FGTS, salário-família, contracheque mensal, 13º
salário, férias e a simulação da rescisão.

As tabelas vêm de `settings` (Tabelas de Cálculo, editáveis pelo admin);
DEFAULT_PAYROLL_SETTINGS traz as de 2026. É um controle interno: não
substitui o eSocial nem o cálculo do contador (médias de variáveis no 13º e
nas férias, por exemplo, entram como lançamento manual).
"""
from calendar import monthrange
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

DEFAULT_PAYROLL_SETTINGS = {
    "valid_from": "2026-01-01",
    "min_wage": 1621.00,
    # Portaria Interministerial MPS/MF nº 13/2026
    "inss_brackets": [
        {"up_to": 1621.00, "rate": 7.5},
        {"up_to": 2902.84, "rate": 9.0},
        {"up_to": 4354.27, "rate": 12.0},
        {"up_to": 8475.55, "rate": 14.0},
    ],
    # Última faixa sem limite (up_to = None)
    "irrf_brackets": [
        {"up_to": 2428.80, "rate": 0.0, "deduction": 0.0},
        {"up_to": 2826.65, "rate": 7.5, "deduction": 182.16},
        {"up_to": 3751.05, "rate": 15.0, "deduction": 394.16},
        {"up_to": 4664.68, "rate": 22.5, "deduction": 675.49},
        {"up_to": None, "rate": 27.5, "deduction": 908.73},
    ],
    "irrf_dependent_deduction": 189.59,
    "irrf_simplified_discount": 607.20,
    # Lei 15.270/2025: rendimento até 5.000 fica isento (redução de até
    # 312,89); até 7.350 a redução é a - b x rendimento
    "irrf_reduction_full_up_to": 5000.00,
    "irrf_reduction_full_max": 312.89,
    "irrf_reduction_partial_up_to": 7350.00,
    "irrf_reduction_partial_a": 978.62,
    "irrf_reduction_partial_b": 0.133145,
    "fgts_rate": 8.0,
    "fgts_apprentice_rate": 2.0,
    "family_allowance_limit": 1980.38,
    "family_allowance_value": 67.54,
    "vt_rate": 6.0,
    "night_bonus_rate": 20.0,
    "monthly_hours": 220,
    # Encargos da empresa sobre a folha (custo); optante do Simples Nacional
    # (anexos I a III e V) não paga a contribuição patronal: zere as três
    "employer_inss_rate": 20.0,
    "rat_rate": 2.0,  # RAT/GILRAT já ajustado pelo FAP
    "third_party_rate": 5.8,  # Sistema S, salário-educação, Incra
    # Banco de horas: prazo para compensar (6 meses no acordo individual,
    # até 12 no coletivo - art. 59, §§ 2º e 5º, da CLT)
    "time_bank_months": 6,
    # Adiantamento quinzenal (vale): % do salário pago por volta do dia 20 e
    # descontado na folha do mês. A CLT não obriga nem fixa o percentual - vem
    # da convenção coletiva ou do acordo da empresa (40% é o mais comum)
    "salary_advance_rate": 40.0,
}

# Variáveis que entram na média das férias, do 13º e da rescisão
VARIABLE_EVENT_CODES = ("HE50", "HE100", "ADIC_NOTURNO", "DSR", "COMISSAO")

CONTRACT_TYPES = {
    "CLT": "CLT",
    "EXPERIENCIA": "CLT - Experiência",
    "APRENDIZ": "Aprendiz",
    "TEMPORARIO": "Temporário",
    "ESTAGIO": "Estágio",
    "PJ": "PJ / Prestador",
}
# PJ não entra na folha; estagiário recebe bolsa (sem INSS/FGTS, com IRRF)
PAYROLL_CONTRACT_TYPES = {"CLT", "EXPERIENCIA", "APRENDIZ", "TEMPORARIO", "ESTAGIO"}

# code: (código do holerite, descrição, P/D, entrada, INSS, IRRF, FGTS, reduz as bases)
# entrada: AUTO (calculado), HOURS, DAYS ou VALUE (lançado na folha)
EVENTS = {
    "SALARIO": ("001", "Salário", "P", "AUTO", True, True, True, False),
    "INSALUBRIDADE": ("002", "Adicional de insalubridade", "P", "AUTO", True, True, True, False),
    "PERICULOSIDADE": ("003", "Adicional de periculosidade", "P", "AUTO", True, True, True, False),
    "HE50": ("010", "Horas extras 50%", "P", "HOURS", True, True, True, False),
    "HE100": ("011", "Horas extras 100%", "P", "HOURS", True, True, True, False),
    "ADIC_NOTURNO": ("012", "Adicional noturno", "P", "HOURS", True, True, True, False),
    "DSR": ("013", "Reflexo DSR", "P", "VALUE", True, True, True, False),
    "COMISSAO": ("020", "Comissões", "P", "VALUE", True, True, True, False),
    "GRATIFICACAO": ("021", "Gratificação", "P", "VALUE", True, True, True, False),
    "PREMIO": ("022", "Prêmio", "P", "VALUE", False, True, False, False),
    "OUTROS_PROVENTOS": ("029", "Outros proventos", "P", "VALUE", True, True, True, False),
    "AJUDA_CUSTO": ("030", "Ajuda de custo", "P", "VALUE", False, False, False, False),
    "REEMBOLSO": ("031", "Reembolso de despesas", "P", "VALUE", False, False, False, False),
    "SALARIO_FAMILIA": ("040", "Salário-família", "P", "AUTO", False, False, False, False),
    "ADIANT_QUINZENA": ("060", "Adiantamento salarial (quinzena)", "P", "AUTO", False, False, False, False),
    "DECIMO_1": ("050", "13º salário - 1ª parcela", "P", "AUTO", False, False, True, False),
    "DECIMO": ("051", "13º salário", "P", "AUTO", True, True, True, False),
    "DECIMO_MEDIAS": ("052", "13º salário - médias de variáveis", "P", "AUTO", True, True, True, False),
    "FALTAS": ("101", "Faltas", "D", "DAYS", True, True, True, True),
    "DSR_FALTAS": ("102", "DSR sobre faltas", "D", "DAYS", True, True, True, True),
    "ATRASOS": ("103", "Atrasos", "D", "HOURS", True, True, True, True),
    "ADIANTAMENTO": ("110", "Adiantamento salarial", "D", "VALUE", False, False, False, False),
    "VALE_TRANSPORTE": ("111", "Vale-transporte", "D", "AUTO", False, False, False, False),
    "VALE_REFEICAO": ("112", "Vale-refeição / alimentação", "D", "VALUE", False, False, False, False),
    "PLANO_SAUDE": ("113", "Plano de saúde", "D", "VALUE", False, False, False, False),
    "PENSAO": ("114", "Pensão alimentícia", "D", "VALUE", False, False, False, False),
    "EMPRESTIMO": ("115", "Empréstimo consignado", "D", "VALUE", False, False, False, False),
    "OUTROS_DESCONTOS": ("119", "Outros descontos", "D", "VALUE", False, False, False, False),
    "ADIANT_QUINZENA_DESC": ("116", "Adiantamento quinzenal", "D", "AUTO", False, False, False, False),
    "DECIMO_ADIANT": ("150", "13º salário - adiantamento", "D", "AUTO", False, False, False, False),
    "INSS": ("201", "INSS", "D", "AUTO", False, False, False, False),
    "IRRF": ("202", "IRRF", "D", "AUTO", False, False, False, False),
}
MANUAL_EVENT_CODES = [code for code, ev in EVENTS.items() if ev[3] != "AUTO"]

RUN_TYPES = {"MENSAL": "Folha mensal", "ADIANTAMENTO": "Adiantamento quinzenal", "DECIMO_1": "13º salário - 1ª parcela",
             "DECIMO_2": "13º salário - 2ª parcela"}

TERMINATION_TYPES = {
    "SEM_JUSTA_CAUSA": "Dispensa sem justa causa",
    "PEDIDO": "Pedido de demissão",
    "JUSTA_CAUSA": "Dispensa por justa causa",
    "ACORDO": "Acordo entre as partes (art. 484-A)",
    "FIM_CONTRATO": "Término do contrato (experiência/prazo)",
}
NOTICE_TYPES = {
    "TRABALHADO": "Trabalhado",
    "INDENIZADO": "Indenizado",
    "NAO_CUMPRIDO": "Não cumprido (descontado)",
    "DISPENSADO": "Dispensado",
}


def r2(value) -> float:
    """Arredonda em centavos meio-para-cima (o round do Python é bancário)."""
    return float(Decimal(str(value or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def merge_settings(stored: Optional[dict]) -> dict:
    return {**DEFAULT_PAYROLL_SETTINGS, **{k: v for k, v in (stored or {}).items() if k in DEFAULT_PAYROLL_SETTINGS and v is not None}}


# ---------------------------------------------------------------- Impostos

def calc_inss(base: float, s: dict) -> float:
    """INSS progressivo: cada faixa paga só sobre a parte do salário dentro dela, até o teto."""
    base = max(0.0, base or 0)
    total, previous = 0.0, 0.0
    for bracket in s["inss_brackets"]:
        if base <= previous:
            break
        portion = min(base, bracket["up_to"]) - previous
        total += portion * bracket["rate"] / 100
        previous = bracket["up_to"]
    return r2(total)


def _irrf_table(base: float, s: dict):
    for bracket in s["irrf_brackets"]:
        if bracket["up_to"] is None or base <= bracket["up_to"]:
            return bracket
    return s["irrf_brackets"][-1]


def irrf_reduction(income: float, tax: float, s: dict) -> float:
    """Redução mensal da Lei 15.270/2025, limitada ao imposto calculado."""
    if tax <= 0:
        return 0.0
    if income <= s["irrf_reduction_full_up_to"]:
        reduction = s["irrf_reduction_full_max"]
    elif income <= s["irrf_reduction_partial_up_to"]:
        reduction = s["irrf_reduction_partial_a"] - s["irrf_reduction_partial_b"] * income
    else:
        reduction = 0.0
    return r2(min(tax, max(0.0, reduction)))


def calc_irrf(income: float, inss: float, dependents: int, pension: float, s: dict, allow_simplified=True, apply_reduction=True) -> dict:
    """IRRF do mês: deduções legais (INSS, dependentes, pensão) ou o desconto
    simplificado, o que for melhor para o empregado; depois a redução da Lei 15.270."""
    income = max(0.0, income or 0)
    legal = (inss or 0) + (dependents or 0) * s["irrf_dependent_deduction"] + (pension or 0)
    simplified = allow_simplified and s["irrf_simplified_discount"] > legal
    deduction = s["irrf_simplified_discount"] if simplified else legal
    base = r2(max(0.0, income - deduction))
    bracket = _irrf_table(base, s)
    tax = r2(max(0.0, base * bracket["rate"] / 100 - bracket["deduction"]))
    reduction = irrf_reduction(income, tax, s) if apply_reduction else 0.0
    return {
        "base": base, "rate": bracket["rate"], "gross_tax": tax, "reduction": reduction,
        "tax": r2(tax - reduction), "simplified": simplified,
    }


# ---------------------------------------------------------------- Datas

def parse_day(value) -> Optional[date]:
    if not value:
        return None
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def competence_bounds(competence: str):
    year, month = (int(x) for x in competence.split("-"))
    return date(year, month, 1), date(year, month, monthrange(year, month)[1])


def overlap_days(start: date, end: date, first: date, last: date) -> int:
    lo, hi = max(start, first), min(end, last)
    return max(0, (hi - lo).days + 1)


def commercial_days(first_day: date, last_day: date, month_last: date) -> int:
    """Dias no mês comercial de 30 dias: quem trabalha até o fim do mês tem
    30 - (dia inicial - 1); fevereiro inteiro também vale 30."""
    if last_day >= month_last:
        return max(0, min(30, 30 - (first_day.day - 1)))
    return max(0, min(30, (last_day - first_day).days + 1))


def commercial_overlap(start: date, end: date, first: date, last: date) -> int:
    """Dias de [start, end] dentro do mês [first, last] no mês comercial de 30
    dias: um intervalo que vai até o fim do mês conta como 30 - (dia inicial - 1)
    (fevereiro inteiro de férias = 30 dias, não 28)."""
    lo, hi = max(start, first), min(end, last)
    if hi < lo:
        return 0
    return commercial_days(lo, hi, last)


def add_months(day: date, months: int) -> date:
    month_index = day.month - 1 + months
    year, month = day.year + month_index // 12, month_index % 12 + 1
    return date(year, month, min(day.day, monthrange(year, month)[1]))


def months_by_fifteen(start: date, end: date, excluded=()) -> int:
    """Avos (1/12): cada mês do calendário com 15 dias ou mais trabalhados entre
    start e end. `excluded`: intervalos (início, fim) que não contam - o
    afastamento pelo INSS depois do 15º dia (quem paga é o INSS)."""
    if end < start:
        return 0
    count, cursor = 0, date(start.year, start.month, 1)
    while cursor <= end:
        last = date(cursor.year, cursor.month, monthrange(cursor.year, cursor.month)[1])
        worked = overlap_days(start, end, cursor, last)
        for lo, hi in excluded:
            worked -= overlap_days(max(lo, start), min(hi, end), cursor, last) if lo <= end and hi >= start else 0
        if worked >= 15:
            count += 1
        cursor = last + timedelta(days=1)
    return count


def months_in_period_by_fifteen(start: date, end: date) -> int:
    """Avos de férias: meses contados a partir do início do período aquisitivo
    (não do calendário); a fração final de 15 dias ou mais vale um mês."""
    if end < start:
        return 0
    months = 0
    while add_months(start, months + 1) - timedelta(days=1) <= end:
        months += 1
    remainder_start = add_months(start, months)
    if remainder_start <= end and (end - remainder_start).days + 1 >= 15:
        months += 1
    return min(12, months)


def age_on(birth, day: date) -> Optional[int]:
    birth = parse_day(birth)
    if not birth:
        return None
    return day.year - birth.year - ((day.month, day.day) < (birth.month, birth.day))


def entitled_vacation_days(unjustified_absences: int) -> int:
    """CLT art. 130: dias de férias conforme as faltas injustificadas no período aquisitivo."""
    if unjustified_absences <= 5:
        return 30
    if unjustified_absences <= 14:
        return 24
    if unjustified_absences <= 23:
        return 18
    if unjustified_absences <= 32:
        return 12
    return 0


# ---------------------------------------------------------------- Contracheque

def _event(code, value, reference="", description=None, auto=True):
    hol, label, kind, *_ = EVENTS[code]
    return {"code": code, "number": hol, "label": description or label, "kind": kind,
            "reference": reference, "value": r2(value), "auto": auto}


def _days(n) -> str:
    return f"{_fmt_qty(n)} {'dia' if float(n or 0) == 1 else 'dias'}"


def _fmt_qty(value) -> str:
    value = float(value or 0)
    return (f"{value:.2f}".rstrip("0").rstrip(".")).replace(".", ",")


def fixed_additions(ctx: dict, s: dict) -> tuple:
    """Insalubridade (% do salário mínimo) e periculosidade (30% do salário) do mês cheio."""
    insal = s["min_wage"] * (ctx.get("insalubridade_grade") or 0) / 100
    peric = (ctx.get("base_salary") or 0) * 0.30 if ctx.get("periculosidade") else 0.0
    return insal, peric


def _manual_value(code: str, item: dict, ctx: dict, s: dict, hourly: float) -> float:
    entry = EVENTS[code][3]
    qty = float(item.get("quantity") or 0)
    if entry == "VALUE":
        return float(item.get("value") or 0)
    if entry == "DAYS":
        return (ctx.get("base_salary") or 0) / 30 * qty
    if code == "HE50":
        return hourly * 1.5 * qty
    if code == "HE100":
        return hourly * 2 * qty
    if code == "ADIC_NOTURNO":
        return hourly * s["night_bonus_rate"] / 100 * qty
    return hourly * qty  # ATRASOS


def _totals(events: list, ctx: dict, s: dict, allow_simplified=True, irrf_events=True) -> dict:
    def base(flag_index):
        plus = sum(e["value"] for e in events if e["kind"] == "P" and EVENTS[e["code"]][flag_index])
        minus = sum(e["value"] for e in events if e["kind"] == "D" and EVENTS[e["code"]][7] and EVENTS[e["code"]][flag_index])
        return r2(max(0.0, plus - minus))

    contract_type = ctx.get("contract_type") or "CLT"
    inss_base, irrf_income, fgts_base = base(4), base(5), base(6)
    if contract_type == "ESTAGIO":
        inss_base, fgts_base = 0.0, 0.0
    # INSS é da competência: as férias gozadas no mês já tiveram INSS no
    # recibo, então o daqui é o da soma (até o teto) menos o já descontado
    other_base = ctx.get("other_inss_base") or 0
    other_withheld = ctx.get("other_inss_withheld") or 0
    if other_base and inss_base:
        inss = r2(max(0.0, calc_inss(inss_base + other_base, s) - other_withheld))
    else:
        inss = calc_inss(inss_base, s)
    pension = sum(e["value"] for e in events if e["code"] == "PENSAO")
    irrf = calc_irrf(irrf_income, inss, ctx.get("irrf_dependents") or 0, pension, s, allow_simplified=allow_simplified)
    if inss > 0:
        effective = inss / inss_base * 100 if inss_base else 0
        events.append(_event("INSS", inss, "complemento (férias no mês)" if other_base and inss_base else f"{_fmt_qty(round(effective, 2))}%"))
    if irrf_events and irrf["tax"] > 0:
        events.append(_event("IRRF", irrf["tax"], f"{_fmt_qty(irrf['rate'])}%"))
    fgts_rate = s["fgts_apprentice_rate"] if contract_type == "APRENDIZ" else s["fgts_rate"]
    gross = r2(sum(e["value"] for e in events if e["kind"] == "P"))
    deductions = r2(sum(e["value"] for e in events if e["kind"] == "D"))
    return {
        "events": sorted(events, key=lambda e: (e["kind"] != "P", e["number"])),
        "gross": gross, "deductions": deductions, "net": r2(gross - deductions),
        "inss_base": inss_base, "inss": inss, "irrf_base": irrf["base"], "irrf_income": irrf_income,
        "irrf": irrf["tax"] if irrf_events else 0.0, "irrf_rate": irrf["rate"], "irrf_simplified": irrf["simplified"],
        "irrf_reduction": irrf["reduction"], "fgts_base": fgts_base, "fgts_rate": fgts_rate,
        "fgts": r2(fgts_base * fgts_rate / 100),
    }


def compute_monthly_payslip(ctx: dict, inputs: list, s: dict) -> dict:
    """Contracheque do mês.
    ctx: base_salary, contract_type, days_worked (0-30), insalubridade_grade,
    periculosidade, vt_opt_in, vt_monthly_cost, irrf_dependents,
    family_children (filhos que dão direito ao salário-família), absence_days
    (faltas injustificadas/suspensão vindas das Ocorrências).
    inputs: lançamentos [{code, quantity | value, description}] (manuais e recorrentes)."""
    base_salary = ctx.get("base_salary") or 0
    days = max(0, min(30, int(ctx.get("days_worked", 30))))
    insal, peric = fixed_additions(ctx, s)
    hourly = (base_salary + insal + peric) / (s["monthly_hours"] or 220)
    events = []
    if days:
        events.append(_event("SALARIO", base_salary / 30 * days, _days(days)))
        if insal:
            events.append(_event("INSALUBRIDADE", insal / 30 * days, f"{_fmt_qty(ctx.get('insalubridade_grade'))}%"))
        if peric:
            events.append(_event("PERICULOSIDADE", peric / 30 * days, "30%"))

    absence_days = min(days, int(ctx.get("absence_days") or 0))
    if absence_days:
        events.append(_event("FALTAS", base_salary / 30 * absence_days, _days(absence_days), "Faltas (ocorrências)"))

    for item in inputs or []:
        code = item.get("code")
        if code not in EVENTS or EVENTS[code][3] == "AUTO":
            continue
        value = _manual_value(code, item, ctx, s, hourly)
        if value <= 0:
            continue
        reference = "" if EVENTS[code][3] == "VALUE" else (
            _days(item.get("quantity")) if EVENTS[code][3] == "DAYS" else f"{_fmt_qty(item.get('quantity'))} h")
        events.append(_event(code, value, reference, (item.get("description") or "").strip() or None, auto=False))

    if ctx.get("salary_advance_paid"):
        events.append(_event("ADIANT_QUINZENA_DESC", ctx["salary_advance_paid"]))

    contract_type = ctx.get("contract_type") or "CLT"
    if ctx.get("vt_opt_in") and contract_type != "ESTAGIO" and days:
        vt = base_salary / 30 * days * s["vt_rate"] / 100
        cost = ctx.get("vt_monthly_cost")
        if cost:
            vt = min(vt, float(cost))
        if vt > 0:
            events.append(_event("VALE_TRANSPORTE", vt, f"{_fmt_qty(s['vt_rate'])}%"))

    children = int(ctx.get("family_children") or 0)
    if children and contract_type not in ("ESTAGIO",):
        remuneration = sum(e["value"] for e in events if e["kind"] == "P" and EVENTS[e["code"]][4]) - \
            sum(e["value"] for e in events if e["kind"] == "D" and EVENTS[e["code"]][7])
        if 0 < remuneration <= s["family_allowance_limit"]:
            events.append(_event("SALARIO_FAMILIA", children * s["family_allowance_value"] * (days / 30 if days < 30 else 1), f"{children} filho(s)"))

    return _totals(events, ctx, s)


def compute_advance_payslip(ctx: dict, s: dict) -> dict:
    """Adiantamento quinzenal: % do salário-base proporcional aos dias do mês
    (admissão, férias e afastamento contam como na folha). Não tem INSS, IRRF
    nem FGTS - eles saem na folha mensal, que desconta o adiantamento."""
    days = max(0, min(30, int(ctx.get("days_worked", 30))))
    rate = s.get("salary_advance_rate") or 0
    value = (ctx.get("base_salary") or 0) * rate / 100 * days / 30
    events = [_event("ADIANT_QUINZENA", value, f"{_fmt_qty(rate)}%")] if value > 0 else []
    gross = r2(sum(e["value"] for e in events))
    return {"events": events, "gross": gross, "deductions": 0.0, "net": gross, "inss_base": 0.0, "inss": 0.0,
            "irrf_base": 0.0, "irrf_income": 0.0, "irrf": 0.0, "irrf_rate": 0.0, "irrf_simplified": False,
            "irrf_reduction": 0.0, "fgts_base": 0.0, "fgts_rate": 0.0, "fgts": 0.0}


def compute_13th_payslip(ctx: dict, part: int, months: int, first_paid: float, inputs: list, s: dict) -> dict:
    """13º salário: 1ª parcela = metade dos avos, sem INSS/IRRF (só FGTS);
    2ª parcela = valor integral com INSS e IRRF próprios, menos o adiantamento.
    Médias de horas extras/comissões entram como lançamento manual."""
    insal, peric = fixed_additions(ctx, s)
    monthly = (ctx.get("base_salary") or 0) + insal + peric
    full = monthly / 12 * months
    events = []
    if part == 1:
        if full:
            events.append(_event("DECIMO_1", full / 2, f"{months}/12"))
        for item in inputs or []:
            code = item.get("code")
            if code in EVENTS and EVENTS[code][2] == "D" and EVENTS[code][3] == "VALUE" and float(item.get("value") or 0) > 0:
                events.append(_event(code, float(item["value"]), "", (item.get("description") or "").strip() or None, auto=False))
        gross = r2(sum(e["value"] for e in events if e["kind"] == "P"))
        deductions = r2(sum(e["value"] for e in events if e["kind"] == "D"))
        contract_type = ctx.get("contract_type") or "CLT"
        fgts_rate = s["fgts_apprentice_rate"] if contract_type == "APRENDIZ" else s["fgts_rate"]
        fgts_base = 0.0 if contract_type == "ESTAGIO" else gross
        return {"events": sorted(events, key=lambda e: (e["kind"] != "P", e["number"])), "gross": gross, "deductions": deductions,
                "net": r2(gross - deductions), "inss_base": 0.0, "inss": 0.0, "irrf_base": 0.0, "irrf_income": 0.0, "irrf": 0.0,
                "irrf_rate": 0.0, "irrf_simplified": False, "irrf_reduction": 0.0, "fgts_base": r2(fgts_base),
                "fgts_rate": fgts_rate, "fgts": r2(fgts_base * fgts_rate / 100)}

    if full:
        events.append(_event("DECIMO", full, f"{months}/12"))
    average = (ctx.get("variable_average") or 0) / 12 * months
    if average > 0:
        events.append(_event("DECIMO_MEDIAS", average, f"{months}/12"))
    for item in inputs or []:
        code = item.get("code")
        if code in EVENTS and EVENTS[code][3] == "VALUE" and float(item.get("value") or 0) > 0:
            events.append(_event(code, float(item["value"]), "", (item.get("description") or "").strip() or None, auto=False))
    result = _totals(events, ctx, s, allow_simplified=False)
    if first_paid:
        result["events"].append(_event("DECIMO_ADIANT", first_paid))
        result["deductions"] = r2(result["deductions"] + first_paid)
        result["net"] = r2(result["gross"] - result["deductions"])
        # o FGTS da 1ª parcela já foi recolhido
        result["fgts_base"] = r2(max(0.0, result["fgts_base"] - first_paid))
        result["fgts"] = r2(result["fgts_base"] * result["fgts_rate"] / 100)
    result["events"] = sorted(result["events"], key=lambda e: (e["kind"] != "P", e["number"]))
    return result


# ---------------------------------------------------------------- Férias

def compute_vacation(ctx: dict, days: int, sell_days: int, advance_13th: bool, s: dict) -> dict:
    """Recibo de férias: férias + 1/3 (com INSS e IRRF), abono pecuniário + 1/3
    (isento) e, se pedido, o adiantamento da 1ª parcela do 13º."""
    insal, peric = fixed_additions(ctx, s)
    monthly = (ctx.get("base_salary") or 0) + insal + peric
    average = ctx.get("variable_average") or 0
    base_pay = r2(monthly / 30 * days)
    average_pay = r2(average / 30 * days)
    pay = r2(base_pay + average_pay)
    third = r2(pay / 3)
    abono = r2((monthly + average) / 30 * (sell_days or 0))
    abono_third = r2(abono / 3)
    advance = r2(monthly / 2) if advance_13th else 0.0
    taxable = pay + third
    inss = 0.0 if ctx.get("contract_type") == "ESTAGIO" else calc_inss(taxable, s)
    irrf = calc_irrf(taxable, inss, ctx.get("irrf_dependents") or 0, 0, s)
    items = [{"label": f"Férias ({days} dias)", "kind": "P", "value": base_pay}]
    if average_pay:
        items.append({"label": "Médias de variáveis sobre férias", "kind": "P", "value": average_pay})
    items.append({"label": "1/3 constitucional sobre férias", "kind": "P", "value": third})
    if abono:
        items += [{"label": f"Abono pecuniário ({sell_days} dias)", "kind": "P", "value": abono},
                  {"label": "1/3 sobre abono pecuniário", "kind": "P", "value": abono_third}]
    if advance:
        items.append({"label": "Adiantamento 1ª parcela do 13º", "kind": "P", "value": advance})
    if inss:
        items.append({"label": "INSS sobre férias", "kind": "D", "value": inss})
    if irrf["tax"]:
        items.append({"label": "IRRF sobre férias", "kind": "D", "value": irrf["tax"]})
    gross = r2(sum(i["value"] for i in items if i["kind"] == "P"))
    deductions = r2(sum(i["value"] for i in items if i["kind"] == "D"))
    fgts_rate = s["fgts_apprentice_rate"] if ctx.get("contract_type") == "APRENDIZ" else s["fgts_rate"]
    fgts_base = 0.0 if ctx.get("contract_type") == "ESTAGIO" else taxable + advance
    return {
        "monthly_base": r2(monthly), "variable_average": r2(average), "average_pay": average_pay,
        "vacation_pay": pay, "one_third": third, "abono": abono, "abono_third": abono_third,
        "advance_13th": advance, "inss": inss, "irrf": irrf["tax"], "irrf_base": irrf["base"],
        "items": items, "gross": gross, "deductions": deductions, "net": r2(gross - deductions),
        "fgts": r2(fgts_base * fgts_rate / 100),
    }


def vacation_periods(admission, until: date, used_by_start: dict, absences_by_start: dict, settled_until=None) -> list:
    """Períodos aquisitivos desde a admissão até `until`. Cada período completo
    tem direito (art. 130), dias usados (gozo + abono), saldo e o fim do
    período concessivo; o período em curso traz os avos proporcionais.
    Períodos que terminam até `settled_until` foram quitados antes do sistema."""
    admission = parse_day(admission)
    settled_until = parse_day(settled_until)
    if not admission or admission > until:
        return []
    periods, start = [], admission
    while start <= until:
        end = add_months(start, 12) - timedelta(days=1)
        key = start.isoformat()
        absences = absences_by_start.get(key, 0)
        used = used_by_start.get(key, 0)
        complete = end < until
        if complete:
            entitled = entitled_vacation_days(absences)
            deadline = add_months(end + timedelta(days=1), 12) - timedelta(days=1)
            if settled_until and end <= settled_until:
                used = max(used, entitled)
            balance = max(0, entitled - used)
            if balance == 0:
                status = "QUITADO"
            elif deadline < until:
                status = "VENCIDO"
            elif (deadline - until).days <= 60:
                status = "A_VENCER"
            else:
                status = "DISPONIVEL"
            periods.append({"start": key, "end": end.isoformat(), "complete": True, "absences": absences,
                            "entitled": entitled, "used": used, "balance": balance, "deadline": deadline.isoformat(),
                            "status": status, "months": 12})
        else:
            months = months_in_period_by_fifteen(start, until)
            entitled_full = entitled_vacation_days(absences)
            proportional = round(entitled_full / 12 * months, 1)
            periods.append({"start": key, "end": end.isoformat(), "complete": False, "absences": absences,
                            "entitled": proportional, "used": used, "balance": max(0.0, round(proportional - used, 1)),
                            "deadline": None, "status": "EM_AQUISICAO", "months": months})
        start = end + timedelta(days=1)
    return periods


# ---------------------------------------------------------------- Rescisão

def notice_days(admission: date, termination: date) -> int:
    """Aviso prévio proporcional (Lei 12.506/2011): 30 dias + 3 por ano completo, até 90."""
    years = 0
    while add_months(admission, 12 * (years + 1)) <= termination:
        years += 1
    return min(90, 30 + 3 * years)


def compute_termination(ctx: dict, s: dict) -> dict:
    """Simulação da rescisão (não é o TRCT oficial).
    ctx: base_salary, contract_type, insalubridade_grade, periculosidade,
    irrf_dependents, admission_date, termination_date, termination_type,
    notice_type, vacation_balance_days (férias vencidas não gozadas, ainda no
    prazo de concessão), vacation_double_days (vencidas fora do prazo: em
    dobro, art. 137),
    current_period_start (início do período aquisitivo em curso),
    experience_end (fim do contrato de experiência: antes dele, a dispensa ou o
    pedido de demissão seguem os arts. 479/480 em vez do aviso prévio),
    current_period_absences, first_13th_paid (1ª parcela já paga no ano),
    fgts_balance (saldo para a multa)."""
    kind = ctx["termination_type"]
    notice = ctx.get("notice_type") or "TRABALHADO"
    admission = parse_day(ctx["admission_date"])
    end = parse_day(ctx["termination_date"])
    insal, peric = fixed_additions(ctx, s)
    salary = (ctx.get("base_salary") or 0) + insal + peric
    # aviso, férias e 13º levam a média das variáveis; o saldo, só o salário
    monthly = salary + (ctx.get("variable_average") or 0)
    leaves = [(parse_day(lo), parse_day(hi)) for lo, hi in ctx.get("leave_ranges") or []]
    items = []

    def add(label, kind_, value, reference=""):
        value = r2(value)
        if value > 0:
            items.append({"label": label, "kind": kind_, "value": value, "reference": reference})
        return value

    # Saldo de salário (dias trabalhados no mês do desligamento)
    month_start = date(end.year, end.month, 1)
    month_last = date(end.year, end.month, monthrange(end.year, end.month)[1])
    worked_days = commercial_days(max(admission, month_start), end, month_last)
    saldo = add("Saldo de salário", "P", salary / 30 * worked_days, _days(worked_days))

    # Aviso prévio - ou, na experiência encerrada antes do prazo, a indenização
    # de metade dos dias que faltavam (art. 479 se a empresa dispensa; art.
    # 480 se o empregado sai, descontada só quando o aviso é "Não cumprido")
    n_days = notice_days(admission, end)
    projected_end = end
    aviso = 0.0
    experience_end = parse_day(ctx.get("experience_end"))
    early_experience = bool(experience_end and end < experience_end and kind in ("SEM_JUSTA_CAUSA", "PEDIDO"))
    remaining = (experience_end - end).days if early_experience else 0
    if early_experience:
        n_days = 0
        if kind == "SEM_JUSTA_CAUSA":
            add("Indenização art. 479 CLT (metade dos dias restantes)", "P", monthly / 30 * remaining / 2, _days(remaining / 2))
        elif notice == "NAO_CUMPRIDO":
            add("Indenização art. 480 CLT (metade dos dias restantes)", "D", monthly / 30 * remaining / 2, _days(remaining / 2))
    elif kind == "SEM_JUSTA_CAUSA" and notice == "INDENIZADO":
        aviso = add("Aviso prévio indenizado", "P", monthly / 30 * n_days, f"{n_days} dias")
        projected_end = end + timedelta(days=n_days)
    elif kind == "ACORDO" and notice == "INDENIZADO":
        half = n_days / 2
        aviso = add("Aviso prévio indenizado (metade)", "P", monthly / 30 * half, f"{_fmt_qty(half)} dias")
        projected_end = end + timedelta(days=int(half))
    elif kind == "PEDIDO" and notice == "NAO_CUMPRIDO":
        add("Aviso prévio não cumprido", "D", salary, "30 dias")

    # Férias vencidas (todos os tipos) e proporcionais (menos justa causa)
    overdue_days = ctx.get("vacation_balance_days") or 0
    if overdue_days:
        overdue = add("Férias vencidas", "P", monthly / 30 * overdue_days, _days(overdue_days))
        add("1/3 sobre férias vencidas", "P", overdue / 3)
    double_days = ctx.get("vacation_double_days") or 0
    if double_days:
        double = add("Férias vencidas em dobro (art. 137)", "P", monthly / 30 * double_days * 2, _days(double_days))
        add("1/3 sobre férias em dobro", "P", double / 3)
    if kind != "JUSTA_CAUSA":
        period_start = parse_day(ctx.get("current_period_start")) or admission
        months = months_in_period_by_fifteen(period_start, projected_end)
        entitled = entitled_vacation_days(ctx.get("current_period_absences") or 0)
        if months and entitled:
            proportional = add("Férias proporcionais", "P", monthly / 30 * entitled / 12 * months, f"{months}/12")
            add("1/3 sobre férias proporcionais", "P", proportional / 3)

    # 13º proporcional
    thirteenth = 0.0
    if kind != "JUSTA_CAUSA":
        year_start = max(admission, date(projected_end.year, 1, 1))
        avos = months_by_fifteen(year_start, projected_end, leaves)
        thirteenth = add("13º salário proporcional", "P", monthly / 12 * avos, f"{avos}/12")
        first_paid = ctx.get("first_13th_paid") or 0
        if first_paid and thirteenth:
            add("13º salário - adiantamento já pago", "D", min(first_paid, thirteenth))

    if ctx.get("salary_advance_paid"):
        add("Adiantamento salarial (quinzena) já pago", "D", ctx["salary_advance_paid"])

    # INSS/IRRF: saldo de salário e 13º, cada um com o seu cálculo; férias
    # indenizadas e aviso indenizado não têm INSS nem IRRF
    exempt = ctx.get("contract_type") == "ESTAGIO"
    inss_salary = 0.0 if exempt else calc_inss(saldo, s)
    irrf_salary = calc_irrf(saldo, inss_salary, ctx.get("irrf_dependents") or 0, 0, s)["tax"]
    inss_13 = 0.0 if exempt else calc_inss(thirteenth, s)
    irrf_13 = calc_irrf(thirteenth, inss_13, ctx.get("irrf_dependents") or 0, 0, s, allow_simplified=False)["tax"]
    add("INSS sobre saldo de salário", "D", inss_salary)
    add("IRRF sobre saldo de salário", "D", irrf_salary)
    add("INSS sobre 13º salário", "D", inss_13)
    add("IRRF sobre 13º salário", "D", irrf_13)

    gross = r2(sum(i["value"] for i in items if i["kind"] == "P"))
    deductions = r2(sum(i["value"] for i in items if i["kind"] == "D"))

    fgts_rate = s["fgts_apprentice_rate"] if ctx.get("contract_type") == "APRENDIZ" else s["fgts_rate"]
    fgts_month = 0.0 if exempt else r2((saldo + thirteenth + aviso) * fgts_rate / 100)
    fgts_balance = r2((ctx.get("fgts_balance") or 0) + fgts_month)
    fine_rate = {"SEM_JUSTA_CAUSA": 40, "ACORDO": 20}.get(kind, 0)
    withdraw = {"SEM_JUSTA_CAUSA": "100% do saldo", "ACORDO": "até 80% do saldo", "FIM_CONTRATO": "100% do saldo"}.get(kind, "não pode sacar")
    return {
        "items": items, "gross": gross, "deductions": deductions, "net": r2(gross - deductions),
        "monthly_base": r2(salary), "variable_average": r2(ctx.get("variable_average") or 0),
        "notice_days": n_days, "projected_end": projected_end.isoformat(),
        "early_experience": early_experience, "experience_remaining_days": remaining,
        "fgts_month": fgts_month, "fgts_balance": fgts_balance, "fgts_fine_rate": fine_rate,
        "fgts_fine": r2(fgts_balance * fine_rate / 100), "fgts_withdraw": withdraw,
        "unemployment_insurance": kind in ("SEM_JUSTA_CAUSA",),
    }


# ---------------------------------------------------------------- Encargos e banco de horas

def employer_charges(inss_base: float, s: dict) -> float:
    """INSS patronal + RAT + terceiros sobre a base do INSS (custo da empresa)."""
    rate = (s.get("employer_inss_rate") or 0) + (s.get("rat_rate") or 0) + (s.get("third_party_rate") or 0)
    return r2((inss_base or 0) * rate / 100)


def time_bank_status(entries: list, today: date, months: int, warn_days: int = 30) -> dict:
    """Saldo do banco de horas com vencimento: cada débito compensa os créditos
    mais antigos primeiro; o crédito que passou do prazo sem compensar venceu
    (tem de ser pago como hora extra)."""
    credits = []  # [data do crédito, minutos ainda não compensados]
    debit = 0
    for e in sorted(entries, key=lambda e: e["date"]):
        if e["minutes"] >= 0:
            credits.append([parse_day(e["date"]), e["minutes"]])
        else:
            debit += -e["minutes"]
    to_use = debit
    for c in credits:
        used = min(c[1], to_use)
        c[1] -= used
        to_use -= used
    expired = expiring = 0
    next_expiry = None
    for day, left in credits:
        if not left:
            continue
        expiry = add_months(day, months)
        if expiry < today:
            expired += left
        else:
            if (expiry - today).days <= warn_days:
                expiring += left
            next_expiry = min(next_expiry or expiry, expiry)
    total_credit = sum(e["minutes"] for e in entries if e["minutes"] >= 0)
    return {"credit": total_credit, "debit": debit, "balance": total_credit - debit, "expired": expired,
            "expiring": expiring, "next_expiry": next_expiry.isoformat() if next_expiry else None}
