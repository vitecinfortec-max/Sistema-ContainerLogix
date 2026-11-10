"""CT-e (10/11/2026): containers com tara/tipo/tamanho/valor, composição do
frete no padrão do print (Frete Valor, Outros, Pedágio, Diária, Seguro) e o
piso mínimo de frete da ANTT. Os coeficientes daqui são de TESTE (não são
os oficiais): o sistema não traz nenhum coeficiente cadastrado."""
import io
import json
from datetime import date

from pdfminer.high_level import extract_text

import antt_piso
import fiscal_cte
from test_cte import _check_fields, _full_body, _full_settings
from test_cte_documentos import SPEC
from test_mdfe import provider  # noqa: F401  (fixture)

# Coeficientes inventados, só para conferir a conta (marcados como TESTE)
TESTE = {"resolucao": "TESTE - não oficial", "vigencia_inicio": "2026-01-01", "fator_retorno_vazio": 0.5, "teste": True,
         "coeficientes": [{"tabela": "A", "tipo_carga": 4, "eixos": 6, "ccd": 7.5, "cc": 600.0},
                          {"tabela": "A", "tipo_carga": 4, "eixos": 7, "ccd": 8.0, "cc": 650.0}]}
PARAMS = {"tabela": "A", "tipo_carga": 4, "eixos": 6, "distancia_km": 300}
COMPONENTES = [{"nome": "FRETE VALOR", "valor": 2800.0}, {"nome": "PEDAGIO", "valor": 120.0}, {"nome": "SEGURO", "valor": 73.94}]


def test_floor_formula_checked_by_hand():
    # 300 km × 7,5 + 600 = 2.850,00
    r = antt_piso.compute(TESTE, PARAMS)
    assert (r["ccd"], r["cc"], r["valor_ida"], r["valor_piso"]) == (7.5, 600.0, 2850.0, 2850.0)
    # Retorno vazio: + 300 km × 7,5 × 0,5 (fator da própria tabela) = 1.125,00
    r = antt_piso.compute(TESTE, {**PARAMS, "retorno_vazio": True})
    assert (r["valor_retorno"], r["valor_piso"]) == (1125.0, 3975.0)
    # Retorno com outra distância
    assert antt_piso.compute(TESTE, {**PARAMS, "retorno_vazio": True, "distancia_retorno_km": 100})["valor_piso"] == 3225.0
    # Sem coeficiente / sem eixos / sem distância / sem tabela: explica o motivo
    assert "não tem coeficiente" in antt_piso.compute(TESTE, {**PARAMS, "eixos": 5})["motivo"]
    assert "eixos" in antt_piso.compute(TESTE, {**PARAMS, "eixos": None})["motivo"]
    assert "distância" in antt_piso.compute(TESTE, {**PARAMS, "distancia_km": 0})["motivo"]
    assert "Nenhuma tabela" in antt_piso.compute(None, PARAMS)["motivo"]
    sem_fator = {**TESTE, "fator_retorno_vazio": None}
    assert "fator do retorno" in antt_piso.compute(sem_fator, {**PARAMS, "retorno_vazio": True})["motivo"]


def test_freight_compared_without_toll():
    assert antt_piso.freight_for_floor({"valor_total": 2993.94, "componentes": COMPONENTES}) == 2873.94


def test_spreadsheet_import_parsing():
    csv_ok = "Tabela;Tipo de carga;Eixos;CCD;CC\nA;4;6;7,5347;671,93\nA;4;9;9,1;700\n".encode()
    items, errors = antt_piso.parse_coefficients(csv_ok, "piso.csv")
    assert errors == [] and items[0] == {"tabela": "A", "tipo_carga": 4, "eixos": 6, "ccd": 7.5347, "cc": 671.93}
    bad = "tabela,tipo_carga,eixos,ccd,cc\nE,4,6,1,1\nA,13,8,0,-1\nA,4,6,1,1\nA,4,6,1,1\n".encode()
    items, errors = antt_piso.parse_coefficients(bad, "x.csv")
    assert len(errors) == 3 and "tabela deve ser A, B, C ou D" in errors[0] and "repetido" in errors[2]
    assert antt_piso.parse_coefficients(b"a,b\n1,2\n", "x.csv")[1][0].startswith("Colunas obrigatórias")


def test_dou_results_parsing():
    data = {"jsonArray": [
        {"title": "RESOLUÇÃO ANTT Nº 6.085, DE 14 DE AGOSTO DE 2026", "content": "Altera a política de pisos mínimos de frete",
         "pubDate": "17/08/2026", "urlTitle": "resolucao-antt-n-6.085", "hierarchyStr": "Ministério/Agência Nacional de Transportes Terrestres"},
        {"title": "<span>PORTARIA</span> SUROC Nº 6", "content": "regras operacionais", "pubDate": "24/04/2026",
         "urlTitle": "portaria-6", "hierarchyStr": "Agência Nacional de Transportes Terrestres"},  # sem "piso"
        {"title": "LEI Nº 15.485", "content": "pisos mínimos", "pubDate": "06/08/2026", "urlTitle": "lei",
         "hierarchyStr": "Atos do Poder Legislativo"},  # não é da ANTT
    ]}
    page = ('<script id="_br_com_seatecnologia_in_buscadou_BuscaDouPortlet_params" type="application/json">'
            + json.dumps(data) + "</script>")
    items = antt_piso.parse_dou_results(page)
    assert items == [{"id": "resolucao-antt-n-6.085", "titulo": "RESOLUÇÃO ANTT Nº 6.085, DE 14 DE AGOSTO DE 2026",
                      "data": "2026-08-17", "url": "https://www.in.gov.br/en/web/dou/-/resolucao-antt-n-6.085"}]
    try:
        antt_piso.parse_dou_results("<html>layout novo</html>")
        assert False, "deveria avisar que o layout mudou"
    except ValueError as exc:
        assert "mudou" in str(exc)


def test_containers_go_as_cargo_units_only_with_layout_tags():
    containers = [{"numero": "MSCU1234565", "lacre": "L1", "tara": 3800, "tipo": "HC", "tamanho": "40", "valor": 25000},
                  {"numero": "TGHU7654321", "lacre": "L2", "tara": 2200, "tipo": "REEFER", "tamanho": "20", "valor": 40000}]
    payload = fiscal_cte.build_payload(_full_body(containers=containers), _full_settings())
    units = payload["nfes"][0]["unidades_carga"]
    assert units == [{"tipo": "1", "identificacao": "MSCU1234565", "lacres": [{"numero_lacre": "L1"}]},
                     {"tipo": "1", "identificacao": "TGHU7654321", "lacres": [{"numero_lacre": "L2"}]}]
    assert not _check_fields(payload, SPEC)


def test_composition_matches_total_in_payload():
    body = _full_body(valor_total=2993.94, valor_receber=2993.94, componentes=COMPONENTES)
    assert fiscal_cte.validate(body, _full_settings()) == []
    payload = fiscal_cte.build_payload(body, _full_settings())
    assert payload["componentes_valor"] == [{"nome": "FRETE VALOR", "valor": "2800.00"}, {"nome": "PEDAGIO", "valor": "120.00"},
                                            {"nome": "SEGURO", "valor": "73.94"}]
    assert payload["valor_total"] == payload["valor_receber"] == "2993.94"
    wrong = _full_body(valor_total=3000, componentes=COMPONENTES)
    assert any("soma dos componentes" in e for e in fiscal_cte.validate(wrong, _full_settings()))


def test_block_mode_on_emission_rules():
    calc_below = {"valor_piso": 2850.0, "valor_frete": 2000.0, "abaixo_do_piso": True, "resolucao": "TESTE"}
    body = _full_body(frete_minimo=PARAMS, frete_minimo_calc=calc_below)
    # avisar (padrão) e desligado: não impede
    assert fiscal_cte.validate(body, _full_settings()) == []
    assert fiscal_cte.validate(body, _full_settings(piso_antt_modo="desligado")) == []
    blocked = fiscal_cte.validate(body, _full_settings(piso_antt_modo="bloquear"))
    assert any("abaixo do piso mínimo da ANTT de R$ 2.850,00" in e for e in blocked)
    no_params = fiscal_cte.validate(_full_body(), _full_settings(piso_antt_modo="bloquear"))
    assert any("preencha o Cálculo do Frete Mínimo" in e for e in no_params)
    no_table = _full_body(frete_minimo=PARAMS, frete_minimo_calc={"valor_piso": None, "motivo": "Nenhuma tabela"})
    assert any("não calculado: Nenhuma tabela" in e for e in fiscal_cte.validate(no_table, _full_settings(piso_antt_modo="bloquear")))


def test_api_tables_import_calculate_and_cte_snapshot(api, provider):  # noqa: F811
    old = api.post("/api/fiscal/pisos-antt", json={**TESTE, "resolucao": "TESTE antiga", "vigencia_inicio": "2025-01-01",
                                                    "coeficientes": [{"tabela": "A", "tipo_carga": 4, "eixos": 6, "ccd": 5.0, "cc": 500}]})
    assert old.status_code == 200, old.text
    new = api.post("/api/fiscal/pisos-antt", json={**TESTE, "coeficientes": []}).json()
    # Importação: com erro nada é gravado; sem erro substitui os coeficientes
    bad = api.post(f"/api/fiscal/pisos-antt/{new['id']}/importar",
                   files={"file": ("p.csv", b"tabela;tipo_carga;eixos;ccd;cc\nA;4;8;1;1\n", "text/csv")})
    assert bad.status_code == 400 and "eixos" in json.dumps(bad.json(), ensure_ascii=False)
    ok = api.post(f"/api/fiscal/pisos-antt/{new['id']}/importar",
                  files={"file": ("p.csv", b"tabela;tipo_carga;eixos;ccd;cc\nA;4;6;7,5;600\n", "text/csv")})
    assert ok.status_code == 200 and ok.json()["importados"] == 1
    listing = api.get("/api/fiscal/pisos-antt").json()
    assert [r["vigente"] for r in listing["items"]] == [True, False]
    # Prévia na tela: hoje usa a nova; em 2025 usa a antiga (histórico)
    calc = api.get("/api/fiscal/pisos-antt/calcular", params={**PARAMS}).json()
    assert calc["valor_piso"] == 2850.0 and calc["teste"] is True
    assert api.get("/api/fiscal/pisos-antt/calcular", params={**PARAMS, "data": "2025-06-01"}).json()["valor_piso"] == 2000.0
    # CT-e com frete abaixo do piso: cálculo gravado no CT-e
    body = _full_body(frete_minimo=PARAMS, valor_total=2120.0, componentes=[{"nome": "FRETE VALOR", "valor": 2000.0},
                                                                          {"nome": "PEDAGIO", "valor": 120.0}])
    cte = api.post("/api/ctes", json=body).json()
    snap = cte["frete_minimo_calc"]
    assert (snap["valor_piso"], snap["valor_frete"], snap["abaixo_do_piso"]) == (2850.0, 2000.0, True)
    # Apagar a tabela não muda o cálculo já gravado
    assert api.delete(f"/api/fiscal/pisos-antt/{new['id']}").status_code == 200
    assert api.get(f"/api/ctes/{cte['id']}").json()["frete_minimo_calc"]["valor_piso"] == 2850.0


def test_api_containers_saved_and_preview(api, provider):  # noqa: F811
    containers = [{"numero": "MSCU1234565", "lacre": "L1", "tara": 3800, "tipo": "HC", "tamanho": "40", "valor": 25000},
                  {"numero": "TGHU7654321", "tara": 2200, "tipo": "REEFER", "tamanho": "20"}]
    cte = api.post("/api/ctes", json=_full_body(containers=containers, valor_total=2993.94, componentes=COMPONENTES)).json()
    assert cte["containers"][0]["tipo"] == "HC" and cte["containers"][1]["tamanho"] == "20"
    assert api.post("/api/ctes", json=_full_body(containers=[{"numero": "X", "tipo": "GIGANTE"}])).status_code == 422
    text = " ".join(extract_text(io.BytesIO(api.get(f"/api/ctes/{cte['id']}/preview-pdf").content)).split())
    assert "MSCU1234565 40' HC tara 3.800 kg (lacre L1)" in text and "TGHU7654321 20' REEFER tara 2.200 kg" in text
    assert "FRETE VALOR" in text and "2.993,94" in text


def test_dou_alert_in_header(api, provider, monkeypatch):  # noqa: F811
    async def fake_fetch():
        return [{"id": "res-6085", "titulo": "RESOLUÇÃO ANTT Nº 6.085", "data": "2026-08-17", "url": None}]
    monkeypatch.setattr(antt_piso, "fetch_dou_publications", fake_fetch)
    api.post("/api/fiscal/pisos-antt", json={**TESTE, "vigencia_inicio": "2026-01-01"})
    assert api.post("/api/fiscal/pisos-antt/verificar").status_code == 200
    alerts = api.get("/api/alerts/summary").json()["financial"]
    assert any(a["key"] == "antt-nova-publicacao" and "6.085" in a["description"] for a in alerts)
    assert api.post("/api/fiscal/pisos-antt/publicacoes/res-6085/conferida").status_code == 200
    assert not any(a["key"] == "antt-nova-publicacao" for a in api.get("/api/alerts/summary").json()["financial"])


def test_publication_older_than_registered_table_is_not_alerted(api, provider, monkeypatch):  # noqa: F811
    async def fake_fetch():
        return [{"id": "antiga", "titulo": "RESOLUÇÃO ANTT Nº 6.076", "data": "2026-01-20", "url": None}]
    monkeypatch.setattr(antt_piso, "fetch_dou_publications", fake_fetch)
    api.post("/api/fiscal/pisos-antt", json={**TESTE, "vigencia_inicio": date(2026, 9, 30).isoformat()})
    api.post("/api/fiscal/pisos-antt/verificar")
    assert api.get("/api/fiscal/pisos-antt").json()["publicacoes"] == []


def test_container_details_from_gate():
    assert fiscal_cte.container_from_size_type("40HC") == {"tamanho": "40", "tipo": "HC"}
    assert fiscal_cte.container_from_size_type("20DC") == {"tamanho": "20", "tipo": "DRY"}
    assert fiscal_cte.container_from_size_type("40RF") == {"tamanho": "40", "tipo": "REEFER"}
    assert fiscal_cte.container_from_size_type("40DRY") == {"tamanho": "40", "tipo": "DRY"}
    assert fiscal_cte.container_from_size_type("XX") == {}
    assert fiscal_cte.tare_kg("3.800") == 3800 and fiscal_cte.tare_kg("2200 kg") == 2200 and fiscal_cte.tare_kg("") is None


def test_container_info_endpoint(api, provider):  # noqa: F811
    api.run(api.db.movements.insert_many([
        {"id": "m1", "container_number": "MSCU1234565", "size_type": "20DC", "tare": "2.200", "created_at": "2026-01-01T00:00:00+00:00"},
        {"id": "m2", "container_number": "MSCU1234565", "size_type": "40HC", "tare": "3.800", "created_at": "2026-05-01T00:00:00+00:00"},
    ]))
    assert api.get("/api/ctes/container-info/mscu1234565").json() == {"tamanho": "40", "tipo": "HC", "tara": 3800.0}
    assert api.get("/api/ctes/container-info/NAOEXISTE1").json() == {}


def _fake_geo(monkeypatch, calls, osrm_ok=True):
    """IBGE e OSRM simulados (sem internet): conta as chamadas."""
    import httpx
    import geo_distancia
    coords = {"2304400": (-3.7858, -38.528), "2312403": (-3.6006, -39.0606)}

    def handler(request):
        calls.append(request.url.host)
        if "ibge" in request.url.host:
            code = request.url.path.split("/")[-2]
            lat, lon = coords[code]
            return httpx.Response(200, json=[{"id": code, "centroide": {"latitude": lat, "longitude": lon}}])
        if not osrm_ok:
            return httpx.Response(503, text="indisponível")
        return httpx.Response(200, json={"code": "Ok", "routes": [{"distance": 75227.7}]})

    real = httpx.AsyncClient
    monkeypatch.setattr(geo_distancia.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))


def test_road_distance_suggestion_and_cache(api, provider, monkeypatch):  # noqa: F811
    calls = []
    _fake_geo(monkeypatch, calls)
    params = {"origem_cidade": "Fortaleza", "origem_uf": "CE", "destino_cidade": "São Gonçalo do Amarante", "destino_uf": "CE"}
    r = api.get("/api/fiscal/pisos-antt/distancia", params=params)
    assert r.status_code == 200, r.text
    assert r.json()["km"] == 75.2 and r.json()["cache"] is False and len(calls) == 3  # 2 IBGE + 1 OSRM
    # Segunda vez: vem do banco, sem chamar os serviços
    again = api.get("/api/fiscal/pisos-antt/distancia", params=params).json()
    assert again["km"] == 75.2 and again["cache"] is True and len(calls) == 3
    same = api.get("/api/fiscal/pisos-antt/distancia", params={**params, "destino_cidade": "Fortaleza"}).json()
    assert same["km"] == 0.0
    bad = api.get("/api/fiscal/pisos-antt/distancia", params={**params, "destino_cidade": "Cidade Inexistente"})
    assert bad.status_code == 400


def test_road_distance_service_down(api, provider, monkeypatch):  # noqa: F811
    _fake_geo(monkeypatch, [], osrm_ok=False)
    r = api.get("/api/fiscal/pisos-antt/distancia", params={"origem_codigo": "2304400", "destino_codigo": "2312403"})
    assert r.status_code == 503 and "informe a distância à mão" in r.json()["detail"]
