"""Multi-cliente, Etapa 1: cadastro central de empresas - validação, um
banco/endereço por empresa, cadastro idempotente que nunca altera uma
empresa existente e busca pelo endereço de acesso."""
import asyncio
import os

import pytest
from mongomock_motor import AsyncMongoMockClient
from pydantic import ValidationError

from tenants import TenantCreate, ensure_central_indexes, find_tenant_by_host, get_tenant, list_tenants, normalize_host, register_tenant


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


@pytest.fixture
def central():
    db = AsyncMongoMockClient()["central_teste"]
    run(ensure_central_indexes(db))
    return db


def _ja(**over):
    data = {"slug": "ja", "name": "J.A Logística", "db_name": "containerlogix_jalogistica",
            "hosts": ["JA.containerlogix.com.br", "https://containerlogix-jalogistica.vercel.app/login"]}
    data.update(over)
    return TenantCreate(**data)


def test_normalize_host():
    assert normalize_host("https://JA.ContainerLogix.com.br:443/x?y") == "ja.containerlogix.com.br"
    assert normalize_host("localhost:3000") == "localhost"
    assert normalize_host("") == ""


def test_validation():
    t = _ja()
    assert t.hosts == ["ja.containerlogix.com.br", "containerlogix-jalogistica.vercel.app"]
    for bad in ({"slug": "J A"}, {"slug": "x"}, {"db_name": "a.b"}, {"db_name": "admin"}, {"name": "  "},
                {"hosts": ["não é host"]}, {"status": "XYZ"}):
        with pytest.raises(ValidationError):
            _ja(**bad)
    assert _ja(db_name="containerlogix_tll-containers").db_name == "containerlogix_tll-containers"


def test_register_is_idempotent_and_never_overwrites(central):
    first = run(register_tenant(central, _ja()))
    assert first["created"] is True
    again = run(register_tenant(central, _ja(name="Outro nome", db_name="outro_banco")))
    assert again["created"] is False and again["tenant"]["name"] == "J.A Logística"
    assert run(get_tenant(central, "JA"))["db_name"] == "containerlogix_jalogistica"
    assert len(run(list_tenants(central))) == 1


def test_bank_and_host_belong_to_one_tenant(central):
    run(register_tenant(central, _ja()))
    with pytest.raises(ValueError, match="banco"):
        run(register_tenant(central, _ja(slug="tll", hosts=["tll.containerlogix.com.br"])))
    with pytest.raises(ValueError, match="endereço"):
        run(register_tenant(central, _ja(slug="tll", db_name="containerlogix_tll-containers",
                                         hosts=["tll.containerlogix.com.br", "ja.containerlogix.com.br"])))
    tll = run(register_tenant(central, _ja(slug="tll", name="TLL", db_name="containerlogix_tll-containers",
                                           hosts=["tll.containerlogix.com.br"])))
    assert tll["created"]


def test_find_by_host(central):
    run(register_tenant(central, _ja()))
    assert run(find_tenant_by_host(central, "https://ja.containerlogix.com.br/rh"))["slug"] == "ja"
    assert run(find_tenant_by_host(central, "containerlogix-jalogistica.vercel.app"))["slug"] == "ja"
    assert run(find_tenant_by_host(central, "outro.containerlogix.com.br")) is None
    assert run(find_tenant_by_host(central, "")) is None


@pytest.mark.skipif(os.environ.get("TEST_MULTI_TENANT") == "1", reason="cenário de instância única")
def test_platform_on_a_single_instance(api):
    """Com MULTI_TENANT desligado (hoje), o dono já administra o cadastro central."""
    api.run(api.db.users.update_one({"id": "admin-1"}, {"$set": {"is_superadmin": True}}))
    assert api.get("/api/platform/tenants").json() == []
    r = api.post("/api/platform/tenants", json={"slug": "novo", "name": "Cliente Novo", "admin_name": "Ana", "admin_email": "ana@novo.com"})
    assert r.status_code == 200, r.text
    assert [t["slug"] for t in api.get("/api/platform/tenants").json()] == ["novo"]
    assert api.get("/api/platform/tenants", as_user="operator").status_code == 403
