"""Grupo Cadastro: listas sem o corte de 100 registros, CNPJ/CPF/nome
duplicado, exclusão bloqueada quando o cadastro está em uso, renomear
cliente atualizando a Tabela de Serviços/Vínculos, status Bloqueado
valendo no EIR novo e Dados da Empresa gravando só o que foi enviado."""
from test_api_movements import MOVEMENT


def _client(api, name, **over):
    r = api.post("/api/clients", json={"name": name, **over})
    assert r.status_code == 200, r.text
    return r.json()


def test_lists_are_not_cut_at_100(api):
    api.run(api.db.clients.insert_many([
        {"id": f"c{i}", "name": f"Cliente {i:03d}", "location_type": "BRASIL", "status": "ATIVO",
         "created_at": f"2026-01-01T00:{i // 60:02d}:{i % 60:02d}+00:00", "created_by": "admin-1"}
        for i in range(130)
    ]))
    api.run(api.db.suppliers.insert_many([
        {"id": f"s{i}", "name": f"Fornecedor {i}", "status": "ATIVO",
         "created_at": "2026-01-01T00:00:00+00:00", "created_by": "admin-1"}
        for i in range(105)
    ]))
    assert len(api.get("/api/clients").json()) == 130
    assert len(api.get("/api/suppliers").json()) == 105
    # paginação explícita continua funcionando
    assert len(api.get("/api/clients", params={"page": 2, "per_page": 100}).json()) == 30


def test_duplicate_documents_and_client_names_are_refused(api):
    _client(api, "Alfa Logística", cnpj="12.345.678/0001-90")
    r = api.post("/api/clients", json={"name": "Outro", "cnpj": "12345678000190"})
    assert r.status_code == 400 and "CNPJ" in r.json()["detail"]
    r = api.post("/api/clients", json={"name": "  alfa   LOGÍSTICA "})
    assert r.status_code == 400 and "nome" in r.json()["detail"]

    ok = api.post("/api/suppliers", json={"name": "Posto A", "cnpj": "11.111.111/0001-11"})
    assert ok.status_code == 200
    r = api.post("/api/suppliers", json={"name": "Posto B", "cnpj": "11111111000111"})
    assert r.status_code == 400

    emp = {"name": "Ana", "cpf": "123.456.789-00"}
    assert api.post("/api/employees", json=emp).status_code == 200
    r = api.post("/api/employees", json={"name": "Ana 2", "cpf": "12345678900"})
    assert r.status_code == 400 and "CPF" in r.json()["detail"]

    drv = {"name": "Zé", "cpf": "111.222.333-44"}
    assert api.post("/api/drivers", json=drv).status_code == 200
    assert api.post("/api/drivers", json={"name": "Zé 2", "cpf": "11122233344"}).status_code == 400

    # editar o próprio registro sem mudar o documento continua permitido
    me = api.get("/api/suppliers").json()[0]
    assert api.put(f"/api/suppliers/{me['id']}", json={"name": "Posto A2", "cnpj": "11.111.111/0001-11"}).status_code == 200


def test_delete_is_blocked_while_in_use(api):
    used = _client(api, "Cliente Um")
    free = _client(api, "Cliente Livre")
    assert api.post("/api/movements", json=MOVEMENT).status_code == 200

    r = api.delete(f"/api/clients/{used['id']}")
    assert r.status_code == 400
    assert "movimentação" in r.json()["detail"] and "Inativo" in r.json()["detail"]
    assert api.delete(f"/api/clients/{free['id']}").status_code == 200

    d = api.post("/api/drivers", json={"name": "Motorista Um", "cpf": "111.222.333-44"}).json()
    r = api.delete(f"/api/drivers/{d['id']}")
    assert r.status_code == 400 and "movimentação" in r.json()["detail"]

    t = api.post("/api/transport-companies", json={"name": "transportadora um"}).json()
    assert api.delete(f"/api/transport-companies/{t['id']}").status_code == 400

    s = api.post("/api/suppliers", json={"name": "Posto"}).json()
    api.run(api.db.fuel_supplies.insert_one({"id": "f1", "supplier_id": s["id"]}))
    assert api.delete(f"/api/suppliers/{s['id']}").status_code == 400


def test_client_rename_follows_into_price_table_and_links(api):
    c = _client(api, "Nome Antigo")
    api.run(api.db.service_price_entries.insert_one({"id": "p1", "client_id": c["id"], "client_name": "Nome Antigo"}))
    api.run(api.db.client_representative_links.insert_one({"id": "l1", "client_id": c["id"], "client_name": "Nome Antigo"}))
    api.run(api.db.service_price_entries.insert_one({"id": "p2", "client_id": "outro", "client_name": "Nome Antigo"}))

    assert api.put(f"/api/clients/{c['id']}", json={"name": "Nome Novo"}).status_code == 200
    entry = api.run(api.db.service_price_entries.find_one({"id": "p1"}))
    link = api.run(api.db.client_representative_links.find_one({"id": "l1"}))
    other = api.run(api.db.service_price_entries.find_one({"id": "p2"}))
    assert entry["client_name"] == "Nome Novo" and link["client_name"] == "Nome Novo"
    assert other["client_name"] == "Nome Antigo"


def test_blocked_client_or_driver_cannot_get_a_new_eir(api):
    c = _client(api, "Cliente Um", status="BLOQUEADO")
    r = api.post("/api/movements", json=MOVEMENT)
    assert r.status_code == 400 and "bloqueado" in r.json()["detail"]

    api.put(f"/api/clients/{c['id']}", json={"name": "Cliente Um", "status": "INATIVO"})
    assert api.post("/api/movements", json=MOVEMENT).status_code == 200

    api.post("/api/drivers", json={"name": "Motorista Um", "cpf": "111.222.333-44", "status": "BLOQUEADO"})
    r = api.post("/api/movements", json={**MOVEMENT, "operation_type": "SAIDA"})
    assert r.status_code == 400 and "Motorista" in r.json()["detail"]


def test_company_settings_partial_update_keeps_other_fields(api):
    full = {"name": "Empresa X", "cnpj": "12.345.678/0001-90", "phone": "(85) 99999-0000", "auto_booking_prefix": "TLL"}
    assert api.put("/api/company-settings", json=full).status_code == 200
    r = api.put("/api/company-settings", json={"phone": "(85) 3333-0000"})
    assert r.status_code == 200
    saved = api.get("/api/company-settings").json()
    assert saved["name"] == "Empresa X" and saved["auto_booking_prefix"] == "TLL"
    assert saved["phone"] == "(85) 3333-0000"
