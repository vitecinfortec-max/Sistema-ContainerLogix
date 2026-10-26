"""Multi-cliente, Etapa 2: com MULTI_TENANT ligado, o mesmo servidor atende
duas empresas, cada uma no próprio banco e na própria pasta de arquivos, e
uma nunca enxerga os dados da outra - nem trocando o cabeçalho, nem usando o
token de outra empresa."""
import asyncio
import sys
from datetime import datetime, timezone

import pytest


@pytest.fixture
def mt(monkeypatch, tmp_path):
    from mongomock_motor import AsyncMongoMockClient

    from conftest import _teach_mongomock_date_operators
    _teach_mongomock_date_operators()
    import server
    import shared
    import tenancy
    from audit import AuditedDatabase
    from auth import create_access_token, get_password_hash
    from tenants import TenantCreate, ensure_central_indexes, register_tenant

    client = AsyncMongoMockClient(tz_aware=True)
    routed = tenancy.TenantRoutedDatabase(client, wrap=AuditedDatabase)
    real_db = shared.db
    for module in list(sys.modules.values()):
        if getattr(module, "db", None) is real_db:
            monkeypatch.setattr(module, "db", routed)
    uploads = tenancy.TenantUploadsRoot(tmp_path)
    real_uploads = [shared.UPLOADS_DIR]
    import reports
    real_uploads.append(reports.UPLOADS_DIR)
    for module in list(sys.modules.values()):
        if any(getattr(module, "UPLOADS_DIR", None) is u for u in real_uploads):
            monkeypatch.setattr(module, "UPLOADS_DIR", uploads)
    monkeypatch.setattr(tenancy, "MULTI_TENANT", True)
    monkeypatch.setattr(shared, "_module_config_cache_by_tenant", {})
    shared._rate_limit_attempts.clear()

    loop = asyncio.new_event_loop()
    central = client["central_teste"]
    tenancy.configure(central)
    loop.run_until_complete(ensure_central_indexes(central))
    for slug, name in (("t1", "Empresa Um"), ("t2", "Empresa Dois")):
        loop.run_until_complete(register_tenant(central, TenantCreate(
            slug=slug, name=name, db_name=f"db_{slug}", hosts=[f"{slug}.containerlogix.com.br"])))
        # mesmo e-mail nas duas empresas, senhas diferentes
        loop.run_until_complete(client[f"db_{slug}"].users.insert_one({
            "id": f"admin-{slug}", "name": f"Admin {slug}", "email": "admin@empresa.com", "role": "admin", "active": True,
            "password": get_password_hash(f"senha-{slug}"), "created_at": datetime.now(timezone.utc).isoformat(),
        }))

    import httpx
    http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")

    class Client:
        db = client
        uploads_root = tmp_path

        def request(self, method, path, tenant=None, token=None, headers=None, **kw):
            h = dict(headers or {})
            if tenant:
                h["X-Tenant"] = tenant
            if token:
                h["Authorization"] = f"Bearer {token}"
            return loop.run_until_complete(http.request(method, path, headers=h, **kw))

        def token(self, slug, **extra):
            return create_access_token({"sub": f"admin-{slug}", "email": "admin@empresa.com", "name": f"Admin {slug}", "tid": slug, **extra})

        def run(self, coro):
            return loop.run_until_complete(coro)

    yield Client()
    loop.run_until_complete(http.aclose())
    loop.close()
    tenancy.configure(None)


def test_request_without_company_is_refused(mt):
    assert mt.request("GET", "/api/clients").status_code == 400
    assert mt.request("GET", "/api/clients", tenant="nao-existe").status_code == 404
    assert mt.request("GET", "/api/").status_code == 200  # verificação de saúde do Render


def test_login_is_per_company_and_token_carries_it(mt):
    from auth import decode_token
    r1 = mt.request("POST", "/api/auth/login", tenant="t1", json={"email": "admin@empresa.com", "password": "senha-t1"})
    assert r1.status_code == 200, r1.text
    assert decode_token(r1.json()["access_token"])["tid"] == "t1"
    # a senha da empresa 1 não abre a empresa 2
    assert mt.request("POST", "/api/auth/login", tenant="t2",
                      json={"email": "admin@empresa.com", "password": "senha-t1"}).status_code == 401
    r2 = mt.request("POST", "/api/auth/login", tenant="t2", json={"email": "admin@empresa.com", "password": "senha-t2"})
    assert decode_token(r2.json()["access_token"])["tid"] == "t2"
    # pelo endereço do site também
    r = mt.request("POST", "/api/auth/login", headers={"X-Tenant-Host": "https://t2.containerlogix.com.br/login"},
                   json={"email": "admin@empresa.com", "password": "senha-t2"})
    assert r.status_code == 200


def test_data_never_crosses_companies(mt):
    t1, t2 = mt.token("t1"), mt.token("t2")
    r = mt.request("POST", "/api/clients", token=t1, json={"name": "Cliente da Empresa Um", "cnpj": "11.111.111/0001-11"})
    assert r.status_code == 200, r.text
    assert [c["name"] for c in mt.request("GET", "/api/clients", token=t1).json()] == ["Cliente da Empresa Um"]
    assert mt.request("GET", "/api/clients", token=t2).json() == []
    # gravou só no banco da empresa 1, com o log de auditoria lá mesmo
    assert mt.run(mt.db["db_t1"].clients.count_documents({})) == 1
    assert mt.run(mt.db["db_t2"].clients.count_documents({})) == 0
    assert mt.run(mt.db["db_t1"].audit_log.count_documents({})) >= 1
    assert mt.run(mt.db["db_t2"].audit_log.count_documents({})) == 0


def test_token_of_one_company_never_opens_another(mt):
    t1 = mt.token("t1")
    # token da empresa 1 com o cabeçalho da empresa 2
    assert mt.request("GET", "/api/clients", token=t1, tenant="t2").status_code == 403
    # token "forjado" pra empresa 2 com o usuário da 1: o usuário não existe lá
    forged = mt.token("t1", tid="t2")
    assert mt.request("GET", "/api/clients", token=forged).status_code == 401
    # token sem empresa (formato antigo) não serve
    from auth import create_access_token
    old = create_access_token({"sub": "admin-t1", "email": "admin@empresa.com", "name": "x"})
    assert mt.request("GET", "/api/clients", token=old, tenant="t1").status_code == 401


def test_suspended_company_is_blocked(mt):
    t1 = mt.token("t1")
    mt.run(mt.db["central_teste"].tenants.update_one({"slug": "t1"}, {"$set": {"status": "SUSPENSO"}}))
    import tenancy
    tenancy.directory().clear()
    r = mt.request("GET", "/api/clients", token=t1)
    assert r.status_code == 403 and "suspenso" in r.json()["detail"]
    assert mt.request("GET", "/api/clients", token=mt.token("t2")).status_code == 200


def test_files_live_in_each_company_folder(mt):
    t1 = mt.token("t1")
    pdf = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"
    r = mt.request("POST", "/api/hr/uploads", token=t1, files={"file": ("atestado.pdf", pdf, "application/pdf")})
    assert r.status_code == 200, r.text
    name, url = r.json()["filename"], r.json()["url"]
    assert url == f"/api/uploads/{name}"  # o endereço gravado não muda
    assert (mt.uploads_root / "t1" / name).is_file()
    assert not (mt.uploads_root / "t2" / name).exists()
    assert mt.request("GET", url, tenant="t1").content == pdf
    assert mt.request("GET", url, tenant="t2").status_code == 404
    # imagem pedida pelo <img> com o token de arquivos na URL
    assert mt.request("GET", f"{url}?token={mt.token('t1', scope='files')}").status_code == 200


def test_modules_are_per_company(mt):
    from shared import invalidate_module_config_cache  # noqa: F401  (o cache é por empresa)
    mt.run(mt.db["db_t1"].module_config.insert_one({"disabled_modules": ["rh"]}))
    assert mt.request("GET", "/api/hr/positions", token=mt.token("t1")).status_code == 403
    assert mt.request("GET", "/api/hr/positions", token=mt.token("t2")).status_code == 200


def test_database_access_without_company_fails_loudly(mt):
    import shared
    import tenancy
    with pytest.raises(tenancy.NoTenantError):
        shared.db.users  # noqa: B018
    with tenancy.tenant_context({"slug": "t2", "db_name": "db_t2"}):
        assert mt.run(shared.db.users.count_documents({})) == 1


def test_cors_regex_accepts_company_subdomains(monkeypatch):
    import re
    pattern = re.compile(r"^https://([a-z0-9-]+\.)?containerlogix\.com\.br$")
    assert pattern.match("https://ja.containerlogix.com.br")
    assert pattern.match("https://containerlogix.com.br")
    assert not pattern.match("https://ja.containerlogix.com.br.evil.com")
    assert not pattern.match("https://evilcontainerlogix.com.br")


def test_tenant_info_for_login_screen(mt):
    mt.run(mt.db["db_t2"].company_settings.insert_one({"name": "Transportes Dois LTDA", "logo_filename": "logo2.png"}))
    info = mt.request("GET", "/api/tenant-info", headers={"X-Tenant-Host": "t2.containerlogix.com.br"}).json()
    assert info == {"multi_tenant": True, "slug": "t2", "name": "Transportes Dois LTDA", "logo_filename": "logo2.png"}
    assert mt.request("GET", "/api/tenant-info", tenant="t1").json()["name"] == "Empresa Um"
    # endereço que não é de empresa nenhuma (ex.: app no celular): a tela pede o código
    assert mt.request("GET", "/api/tenant-info", headers={"X-Tenant-Host": "localhost"}).status_code == 404
    assert mt.request("GET", "/api/tenant-info").status_code == 400
    # logo antes do login, pela URL
    (mt.uploads_root / "t2").mkdir(exist_ok=True)
    (mt.uploads_root / "t2" / "logo2.png").write_bytes(b"png")
    assert mt.request("GET", "/api/uploads/logo2.png?tenant=t2").content == b"png"
    assert mt.request("GET", "/api/uploads/logo2.png?tenant=t1").status_code == 404


def test_only_api_paths_need_a_company(mt):
    # o site (quando servido pelo mesmo processo) e a documentação não passam pelo filtro
    assert mt.request("GET", "/login").status_code != 400
    assert mt.request("GET", "/openapi.json").status_code == 200
