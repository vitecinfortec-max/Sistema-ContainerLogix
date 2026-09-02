"""
Envio automático diário do Relatório de Movimentações por e-mail para cada
Cliente cadastrado - reaproveita o Resend já usado pela recuperação de senha
(routers/auth.py) e o mesmo gerador de PDF usado no download manual
(reports.generate_pdf_report).
"""
import asyncio
import logging
import os
from datetime import date, datetime, time, timedelta
from typing import Optional

import resend
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import APIRouter, Depends

from reports import generate_pdf_report, now_brt, merge_company, BRT_TZ
from shared import db, get_company_settings, get_current_admin_user

api_router = APIRouter(prefix="/api")

logger = logging.getLogger(__name__)

resend.api_key = os.environ.get('RESEND_API_KEY', '')
SENDER_EMAIL = os.environ.get('SENDER_EMAIL', 'onboarding@resend.dev')


def _brt_day_range_utc(day: date):
    """Início/fim (00:00 BRT desse dia até 00:00 BRT do dia seguinte), em UTC -
    mesmo fuso usado em todo o resto do sistema (now_brt/to_brt)."""
    start = datetime.combine(day, time.min, tzinfo=BRT_TZ)
    end = start + timedelta(days=1)
    return start, end


async def _movements_for_client(client_name: str, day: date) -> list:
    start_utc, end_utc = _brt_day_range_utc(day)
    query = {
        "client_name": client_name,
        "$expr": {
            "$and": [
                {"$gte": [{"$toDate": "$created_at"}, start_utc]},
                {"$lt": [{"$toDate": "$created_at"}, end_utc]},
            ]
        },
    }
    return await db.movements.find(query, {"_id": 0}).sort("created_at", 1).to_list(None)


def _build_email_html(client_name: str, day: date, total: int) -> str:
    day_str = day.strftime('%d/%m/%Y')
    return f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #3B9BA8;">ContainerLogix</h1>
        </div>
        <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px;">
            <h3 style="color: #333; margin-top: 0;">Relatório de Movimentações</h3>
            <p>Olá,</p>
            <p>Segue em anexo o relatório de movimentações de <strong>{client_name}</strong> referente ao dia <strong>{day_str}</strong> ({total} movimentação{'ões' if total != 1 else ''}).</p>
        </div>
        <p style="color: #666; font-size: 12px; margin-top: 30px; text-align: center;">
            E-mail automático - ContainerLogix
        </p>
    </div>
    """


async def send_daily_client_movement_reports(day: date = None) -> dict:
    """Gera e envia por e-mail o relatório de movimentações do dia (BRT) pra
    cada cliente ativo com e-mail cadastrado. Clientes sem nenhuma
    movimentação no dia são pulados (não gera e-mail vazio)."""
    if day is None:
        day = (now_brt() - timedelta(days=1)).date()

    company = merge_company(await get_company_settings())

    clients = await db.clients.find(
        {
            # Vários cadastros antigos não têm o campo "status" gravado no
            # documento (só o default do Pydantic na leitura via API) - trata
            # ausência do campo como ativo, senão a query exclui esses clientes.
            "status": {"$nin": ["INATIVO", "EXCLUIDO"]},
            "email": {"$nin": [None, ""]},
        },
        {"_id": 0}
    ).to_list(None)

    sent, skipped, errors = [], [], []

    for c in clients:
        try:
            movements = await _movements_for_client(c["name"], day)
            if not movements:
                skipped.append(c["name"])
                continue

            pdf_bytes = generate_pdf_report(
                movements,
                report_title=f"Relatório de Movimentações - {c['name']}",
                company=company,
            )

            params = {
                "from": SENDER_EMAIL,
                "to": [c["email"]],
                "subject": f"ContainerLogix - Relatório de Movimentações - {day.strftime('%d/%m/%Y')}",
                "html": _build_email_html(c["name"], day, len(movements)),
                "attachments": [{
                    "filename": f"relatorio_movimentacoes_{day.strftime('%d-%m-%Y')}.pdf",
                    "content": list(pdf_bytes),
                }],
            }
            await asyncio.to_thread(resend.Emails.send, params)
            sent.append(c["name"])
        except Exception as e:
            logger.error(f"Erro ao enviar relatório diário pro cliente {c.get('name')}: {e}")
            errors.append({"client": c.get("name"), "error": str(e)})

    result = {"date": day.isoformat(), "sent": sent, "skipped": skipped, "errors": errors}
    logger.info(f"Relatórios diários de movimentação: {len(sent)} enviados, {len(skipped)} pulados (sem movimentação), {len(errors)} erros - {day.isoformat()}")
    return result


@api_router.post("/reports/send-daily-movements")
async def trigger_daily_movement_reports(
    target_date: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user),
):
    """Dispara manualmente o envio do relatório diário (mesma lógica do
    agendamento automático) - útil pra reenviar um dia específico ou testar
    sem esperar o horário agendado. target_date no formato YYYY-MM-DD;
    sem informar, usa o dia anterior (mesmo padrão do envio automático)."""
    day = date.fromisoformat(target_date) if target_date else None
    return await send_daily_client_movement_reports(day)


_scheduler: AsyncIOScheduler = None


def start_scheduler():
    """Chamado no startup do app - agenda o envio diário pra 07:00 (Brasília)."""
    global _scheduler
    if _scheduler is not None:
        return
    _scheduler = AsyncIOScheduler(timezone="America/Fortaleza")
    _scheduler.add_job(
        send_daily_client_movement_reports,
        CronTrigger(hour=7, minute=0),
        id="daily_client_movement_reports",
        replace_existing=True,
    )
    _scheduler.start()
    logger.info("Agendador de relatórios diários iniciado (07:00 América/Fortaleza)")


def stop_scheduler():
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
