"""
Testes unitários das regras que não dependem de servidor nem de banco:
períodos no horário de Brasília, validação de entrada, upload e sessão do
WebSocket. Rodam com `pytest tests/test_rules_unit.py`, sem nada no ar.
"""
import asyncio
import io
import time
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

import server
import shared
from models import ContainerMovementCreate, StockMovementItem
from routers import stock
from routers.movements import _filter_movements_by_period, _parse_filter_day

BRT = timezone(timedelta(hours=-3))


def _utc_iso(brt_text: str) -> str:
    """created_at como o banco grava: ISO 8601 em UTC."""
    return datetime.fromisoformat(brt_text).replace(tzinfo=BRT).astimezone(timezone.utc).isoformat()


# ---------- Períodos no horário de Brasília ----------

class TestFilterMovementsByPeriod:
    movements = [
        {"id": "antes", "created_at": _utc_iso("2026-09-30T23:30:00")},
        {"id": "primeiro_minuto", "created_at": _utc_iso("2026-10-01T00:00:00")},
        {"id": "noite_do_ultimo_dia", "created_at": _utc_iso("2026-10-31T22:30:00")},
        {"id": "depois", "created_at": _utc_iso("2026-11-01T00:00:00")},
    ]

    def _ids(self, date_from, date_to, movements=None):
        return [m["id"] for m in _filter_movements_by_period(movements or self.movements, date_from, date_to)]

    def test_period_uses_brasilia_day(self):
        # 31/10 22:30 BRT já é 01/11 em UTC - tem que continuar em outubro.
        assert self._ids("2026-10-01", "2026-10-31") == ["primeiro_minuto", "noite_do_ultimo_dia"]

    def test_only_date_from(self):
        assert self._ids("2026-11-01", None) == ["depois"]

    def test_only_date_to(self):
        assert self._ids(None, "2026-09-30") == ["antes"]

    def test_no_period_returns_everything(self):
        assert len(self._ids(None, None)) == 4
        assert len(self._ids("", "")) == 4

    def test_unreadable_created_at_is_kept(self):
        movements = self.movements + [{"id": "ilegivel", "created_at": "lixo"}]
        assert "ilegivel" in self._ids("2026-10-01", "2026-10-31", movements)

    def test_invalid_date_is_rejected(self):
        with pytest.raises(HTTPException) as error:
            _filter_movements_by_period(self.movements, "31/10/2026", None)
        assert error.value.status_code == 400


def test_parse_filter_day_names_the_field():
    with pytest.raises(HTTPException) as error:
        _parse_filter_day("ontem", "date_to")
    assert "date_to" in error.value.detail


# ---------- Validação da movimentação de container ----------

MOVEMENT = dict(
    operation_type="ENTRADA", driver_name="Motorista", driver_cpf="00000000000", truck_plate="AAA0A00",
    trailer_plate_1="BBB0B00", transport_company="Transportadora", container_number="ABCU1234567",
    status="CHEIO", size_type="20DC", shipping_line="Armador",
)


class TestContainerMovementCreate:
    def test_container_number_is_normalized(self):
        movement = ContainerMovementCreate(**{**MOVEMENT, "container_number": "  abcu1234567 "})
        assert movement.container_number == "ABCU1234567"

    def test_valid_value_and_currency(self):
        movement = ContainerMovementCreate(**{**MOVEMENT, "service_value": 150.5, "currency": "USD"})
        assert (movement.service_value, movement.currency) == (150.5, "USD")

    @pytest.mark.parametrize("field, value", [
        ("service_value", -1),
        ("service_value", float("nan")),
        ("service_value", float("inf")),
        ("currency", "EUR"),
        ("container_number", "   "),
    ])
    def test_invalid_input_is_rejected(self, field, value):
        with pytest.raises(ValidationError):
            ContainerMovementCreate(**{**MOVEMENT, field: value})


# ---------- Itens da movimentação de estoque ----------

def _item(quantity, unit_value, total_value=0.0):
    return StockMovementItem(
        product_id="p1", product_description="Luva", quantity=quantity, unit_value=unit_value, total_value=total_value,
    )


class TestStockMovementItems:
    def test_total_is_computed_on_the_server(self):
        items = [_item(3, 12.5, total_value=999)]
        stock._validate_movement_items(items)
        assert items[0].total_value == 37.5

    def test_empty_list_is_rejected(self):
        with pytest.raises(HTTPException):
            stock._validate_movement_items([])

    @pytest.mark.parametrize("quantity, unit_value", [
        (0, 1), (-2, 1), (float("inf"), 1), (1, -1), (1, float("nan")),
    ])
    def test_invalid_quantity_or_value_is_rejected(self, quantity, unit_value):
        with pytest.raises(HTTPException) as error:
            stock._validate_movement_items([_item(quantity, unit_value)])
        assert error.value.status_code == 400


# ---------- Upload ----------

class FakeUpload:
    def __init__(self, filename, data):
        self.filename = filename
        self._buffer = io.BytesIO(data)

    async def read(self, size=-1):
        return self._buffer.read(size)


def _upload(filename, data, allowed=shared.ALLOWED_RECEIPT_EXTENSIONS):
    return asyncio.run(shared.validate_and_read_upload(FakeUpload(filename, data), allowed))


PNG = bytes.fromhex("89504e470d0a1a0a") + b"x" * 64
JPEG = bytes.fromhex("ffd8ffe0") + b"x" * 64


class TestUploadValidation:
    @pytest.mark.parametrize("filename, data", [
        ("foto.png", PNG),
        ("foto.JPG", JPEG),
        ("foto.jpeg", JPEG),
        ("foto.webp", b"RIFF\x00\x00\x00\x00WEBPVP8 "),
        ("recibo.pdf", b"%PDF-1.7\n"),
    ])
    def test_real_files_are_accepted(self, filename, data):
        extension, content = _upload(filename, data)
        assert extension == "." + filename.rsplit(".", 1)[1].lower()
        assert content == data

    def test_content_must_match_extension(self):
        with pytest.raises(HTTPException) as error:
            _upload("foto.png", b"<html>nao e uma imagem</html>")
        assert error.value.status_code == 400

    def test_extension_must_be_allowed(self):
        with pytest.raises(HTTPException):
            _upload("programa.exe", b"MZ")

    def test_file_over_the_limit_is_rejected(self):
        with pytest.raises(HTTPException) as error:
            _upload("foto.png", PNG + b"x" * shared.MAX_FILE_SIZE)
        assert "grande" in error.value.detail

    def test_extension_without_known_signature_passes(self):
        extension, _ = _upload("nota.xml", b'<?xml version="1.0"?>', {".xml"})
        assert extension == ".xml"


# ---------- Sessão do WebSocket ----------

class _FakeUsers:
    def __init__(self, user_doc):
        self.user_doc = user_doc

    async def find_one(self, *args, **kwargs):
        return self.user_doc


class _FakeDb:
    def __init__(self, user_doc):
        self.users = _FakeUsers(user_doc)


def _ws_session_valid(monkeypatch, user_doc, exp_offset=3600, disabled_modules=()):
    async def fake_disabled_modules():
        return list(disabled_modules)

    monkeypatch.setattr(server, "db", _FakeDb(user_doc))
    monkeypatch.setattr(server, "get_disabled_modules", fake_disabled_modules)
    return asyncio.run(server._ws_session_valid({"sub": "u1", "exp": time.time() + exp_offset}))


class TestWebSocketSession:
    def test_active_user_with_valid_token(self, monkeypatch):
        assert _ws_session_valid(monkeypatch, {"id": "u1", "active": True}) is True

    def test_user_without_active_field_counts_as_active(self, monkeypatch):
        assert _ws_session_valid(monkeypatch, {"id": "u1"}) is True

    def test_expired_token(self, monkeypatch):
        assert _ws_session_valid(monkeypatch, {"id": "u1"}, exp_offset=-1) is False

    def test_deactivated_user(self, monkeypatch):
        assert _ws_session_valid(monkeypatch, {"id": "u1", "active": False}) is False

    def test_removed_user(self, monkeypatch):
        assert _ws_session_valid(monkeypatch, None) is False

    def test_disabled_module(self, monkeypatch):
        assert _ws_session_valid(monkeypatch, {"id": "u1"}, disabled_modules=["terminal"]) is False
