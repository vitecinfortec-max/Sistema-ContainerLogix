"""Grupo Terminal: regra do Estoque Atual (última movimentação = ENTRADA),
fotos do Registro Fotográfico enviadas em paralelo, filtro de período do Flex
Tank, trava de duplicidade na edição de EIR, segregação na edição e itens da
Auditoria."""
import asyncio
import io
from datetime import datetime, timedelta, timezone

import pytest

PNG = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde"
       b"\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82")


def _mov(i, container, op, days_ago, client="Cliente Alfa", status="VAZIO"):
    return {
        "id": f"m{i}", "transaction_id": i, "container_number": container, "operation_type": op,
        "status": status, "client_name": client, "size_type": "40HC", "shipping_line": "MSC",
        "created_at": (datetime(2026, 10, 15, 12, tzinfo=timezone.utc) - timedelta(days=days_ago)).isoformat(),
        "created_by": "admin-1", "user_name": "Admin Teste", "driver_name": "JOSE", "driver_cpf": "11144477735",
        "truck_plate": "AAA1A11", "trailer_plate_1": "BBB2B22", "transport_company": "T", "tare": "3800",
    }


@pytest.fixture
def stock_history(api):
    rows = [
        # entrada em dobro e depois saída: NÃO está no pátio (antes contava 2 > 1)
        _mov(1, "DUPU1111111", "ENTRADA", 30), _mov(2, "DUPU1111111", "ENTRADA", 29), _mov(3, "DUPU1111111", "SAIDA", 10),
        # saída em dobro e depois entrada: ESTÁ no pátio (antes contava 1 = 1... ou menos)
        _mov(4, "BACK2222222", "ENTRADA", 40), _mov(5, "BACK2222222", "SAIDA", 30), _mov(6, "BACK2222222", "SAIDA", 29),
        _mov(7, "BACK2222222", "ENTRADA", 5, status="CHEIO"),
        # caso normal
        _mov(8, "NORM3333333", "ENTRADA", 3),
    ]
    api.run(api.db.movements.insert_many([dict(r) for r in rows]))
    return rows


def test_stock_uses_last_movement_everywhere(api, stock_history):
    expected = {"BACK2222222", "NORM3333333"}
    rows = api.get("/api/movements", params={"operation_type": "ESTOQUE"}).json()
    assert {r["container_number"] for r in rows} == expected

    yard = api.get("/api/yard-control", params={"movement_type": "ESTOQUE"}).json()
    items = yard["containers"]
    assert {c["container_number"] for c in items if c.get("in_stock")} == expected

    dash = api.get("/api/dashboard").json()
    assert dash["current_stock"] == 2 and dash["stock_full"] == 1 and dash["stock_empty"] == 1

    from routers.movement_reports import _get_current_stock_movements
    report = api.run(_get_current_stock_movements())
    assert {m["container_number"] for m in report} == expected


def test_inspection_parallel_photo_uploads_all_kept(api):
    r = api.post("/api/container-inspections", json={"container_number": "MSCU1234565", "operation_type": "ENTRADA"})
    assert r.status_code == 200, r.text
    iid = r.json()["id"]

    async def send(kind):
        files = {"file": (f"{kind}.png", io.BytesIO(PNG), "image/png")}
        return await api._client.post(f"/api/container-inspections/{iid}/upload-photo", params={"type": kind},
                                      files=files, headers=api._headers["admin"])

    async def all_at_once():
        return await asyncio.gather(*(send(k) for k in ["front", "back", "left", "right", "internal"]))

    results = api.run(all_at_once())
    assert all(x.status_code == 200 for x in results), [x.text for x in results]
    doc = api.run(api.db.container_inspections.find_one({"id": iid}))
    assert len(doc["photos"]) == 5

    pid = doc["photos"][0]["id"]
    assert api.delete(f"/api/container-inspections/{iid}/photo/{pid}").status_code == 200
    assert len(api.run(api.db.container_inspections.find_one({"id": iid}))["photos"]) == 4


def test_flex_tank_period_filter(api):
    api.run(api.db.flex_tank_movements.insert_many([
        {"id": "f1", "movement_number": 1, "bag_number": "B1", "movement_type": "ENTRADA",
         "movement_date": "2026-10-10T00:00:00+00:00", "created_at": "2026-10-10T12:00:00+00:00"},  # legado: dia 10
        {"id": "f2", "movement_number": 2, "bag_number": "B2", "movement_type": "ENTRADA",
         "movement_date": "2026-10-14T03:00:00+00:00", "created_at": "2026-10-14T12:00:00+00:00"},  # dia 14 (BRT)
        {"id": "f3", "movement_number": 3, "bag_number": "B3", "movement_type": "SAIDA",
         "movement_date": "2026-10-20T03:00:00+00:00", "created_at": "2026-10-20T12:00:00+00:00"},
    ]))
    r = api.get("/api/flex-tank/movements", params={"start_date": "2026-10-10", "end_date": "2026-10-14"})
    assert r.status_code == 200, r.text
    assert sorted(m["bag_number"] for m in r.json()["items"]) == ["B1", "B2"]
    assert r.json()["total"] == 2
    assert api.get("/api/flex-tank/report/excel", params={"start_date": "2026-10-14", "end_date": "2026-10-14"}).status_code == 200


def test_edit_eir_cannot_create_consecutive_duplicates(api, stock_history):
    # m8 é ENTRADA do NORM3333333; trocar o container dela pro BACK2222222
    # (cuja última é uma ENTRADA anterior) deixaria duas Entradas seguidas
    body = {k: v for k, v in stock_history[7].items() if k not in ("id", "transaction_id", "created_at", "created_by", "user_name")}
    body["container_number"] = "BACK2222222"
    r = api.put("/api/movements/m8", json=body)
    assert r.status_code == 400 and "duas ENTRADAs seguidas" in r.json()["detail"]

    # trocar o tipo da m3 (SAIDA) para ENTRADA: ficaria ENTRADA, ENTRADA, ENTRADA
    body3 = {k: v for k, v in stock_history[2].items() if k not in ("id", "transaction_id", "created_at", "created_by", "user_name")}
    body3["operation_type"] = "ENTRADA"
    assert api.put("/api/movements/m3", json=body3).status_code == 400

    # editar sem trocar container/tipo continua livre
    body["container_number"] = "NORM3333333"
    body["seal"] = "LACRE9"
    assert api.put("/api/movements/m8", json=body).status_code == 200


def test_edit_segregation_blocks_container_reserved_elsewhere(api):
    c1 = api.post("/api/clients", json={"name": "Cliente Alfa"}).json()
    c2 = api.post("/api/clients", json={"name": "Cliente Beta"}).json()
    a = api.post("/api/unit-segregations", json={"client_id": c1["id"], "items": [{"container_number": "AAAU1111111", "shipping_line": "MSC"}]})
    b = api.post("/api/unit-segregations", json={"client_id": c2["id"], "items": [{"container_number": "BBBU2222222", "shipping_line": "MSC"}]})
    assert a.status_code == 200 and b.status_code == 200, (a.text, b.text)
    r = api.put(f"/api/unit-segregations/{b.json()['id']}",
                json={"items": [{"container_number": "BBBU2222222", "shipping_line": "MSC"}, {"container_number": "aaau1111111", "shipping_line": "MSC"}]})
    assert r.status_code == 400 and "Cliente Alfa" in r.json()["detail"]
    ok = api.put(f"/api/unit-segregations/{b.json()['id']}",
                 json={"items": [{"container_number": "BBBU2222222", "shipping_line": "MSC"}, {"container_number": "CCCU3333333", "shipping_line": "MSC"}]})
    assert ok.status_code == 200, ok.text


def _reserve(api, numbers):
    client = api.post("/api/clients", json={"name": "Cliente Alfa"}).json()
    r = api.post("/api/unit-segregations", json={"client_id": client["id"], "items": [
        {"container_number": n, "shipping_line": "MSC"} for n in numbers
    ]})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _retrieved(api, seg_id):
    doc = api.run(api.db.unit_segregations.find_one({"id": seg_id}))
    return {i["container_number"]: i.get("retrieved_transaction_id") for i in doc["items"]}


def test_exit_marks_each_container_of_a_multi_container_segregation(api):
    """Só o primeiro container da reserva recebia baixa: o $ne solto valia pra
    lista inteira e barrava os demais."""
    from routers.movements import _mark_segregation_retrieved
    seg_id = _reserve(api, ["AAAU111111-1", "BBBU222222-2", "CCCU333333-3"])
    api.run(_mark_segregation_retrieved("BBBU222222-2", 10))
    api.run(_mark_segregation_retrieved("AAAU111111-1", 11))
    assert _retrieved(api, seg_id) == {"AAAU111111-1": 11, "BBBU222222-2": 10, "CCCU333333-3": None}
    api.run(_mark_segregation_retrieved("CCCU333333-3", 12))
    assert api.get(f"/api/unit-segregations/{seg_id}").json()["retrieval_status"] == "CONCLUIDO"
    # Editar a EIR depois não troca a transação da baixa
    api.run(_mark_segregation_retrieved("AAAU111111-1", 99))
    assert _retrieved(api, seg_id)["AAAU111111-1"] == 11


def test_exit_matches_container_with_or_without_check_digit_dash(api):
    from routers.movements import _check_segregation_conflict, _mark_segregation_retrieved
    seg_id = _reserve(api, ["MSCU1234565"])
    assert "segregado" in api.run(_check_segregation_conflict("MSCU123456-5", "SAIDA", "Outro Cliente"))
    api.run(_mark_segregation_retrieved("MSCU123456-5", 20))
    assert _retrieved(api, seg_id) == {"MSCU1234565": 20}


def test_resync_marks_every_pending_container_but_ignores_exit_before_reservation(api):
    numbers = ["AAAU111111-1", "BBBU222222-2", "CCCU333333-3"]
    seg_id = _reserve(api, numbers)
    api.run(api.db.unit_segregations.update_one(
        {"id": seg_id}, {"$set": {"items.0.retrieved": True, "items.0.retrieved_transaction_id": 1}}
    ))
    after = "2099-01-01T00:00:00+00:00"
    api.run(api.db.movements.insert_many([
        {"id": "s1", "transaction_id": 2, "container_number": "BBBU222222-2", "operation_type": "SAIDA", "client_name": "cliente alfa", "created_at": after},
        {"id": "s2", "transaction_id": 3, "container_number": "CCCU333333-3", "operation_type": "SAIDA", "client_name": "Cliente Alfa", "created_at": "2020-01-01T00:00:00+00:00"},
    ]))
    r = api.post("/api/unit-segregations/resync-retrievals")
    assert r.status_code == 200 and r.json()["items_updated"] == 1, r.text
    assert _retrieved(api, seg_id) == {"AAAU111111-1": 1, "BBBU222222-2": 2, "CCCU333333-3": None}


@pytest.fixture
def segregation_photos(api, monkeypatch, tmp_path):
    from routers import container_audits, unit_segregation
    monkeypatch.setattr(unit_segregation, "UPLOADS_DIR", tmp_path)
    monkeypatch.setattr(container_audits, "UPLOADS_DIR", tmp_path)
    client = api.post("/api/clients", json={"name": "Cliente Alfa"}).json()
    seg = api.post("/api/unit-segregations", json={"client_id": client["id"], "items": [
        {"container_number": "AAAU1111111", "shipping_line": "MSC"},
        {"container_number": "BBBU2222222", "shipping_line": "MSC"},
    ]}).json()

    def upload(number="AAAU1111111"):
        return api.post(f"/api/unit-segregations/{seg['id']}/items/{number}/photos", files={"file": ("x.png", io.BytesIO(PNG), "image/png")})

    return seg, upload, tmp_path


def _seg_item(seg_json, number):
    return next(i for i in seg_json["items"] if i["container_number"] == number)


def _saved_file(tmp_path, photo):
    return tmp_path / photo["url"].split("/api/uploads/", 1)[1]


def test_segregation_photo_upload_and_remove(api, segregation_photos):
    seg, upload, tmp_path = segregation_photos
    r = upload()
    assert r.status_code == 200, r.text
    photo = _seg_item(r.json(), "AAAU1111111")["photos"][0]
    assert _saved_file(tmp_path, photo).is_file() and photo["uploaded_by_name"]
    assert _seg_item(r.json(), "BBBU2222222")["photos"] == []

    gone = api.delete(f"/api/unit-segregations/{seg['id']}/items/AAAU1111111/photos/{photo['id']}")
    assert gone.status_code == 200, gone.text
    assert _seg_item(gone.json(), "AAAU1111111")["photos"] == []
    assert not _saved_file(tmp_path, photo).exists()


def test_segregation_photo_limits(api, segregation_photos):
    seg, upload, _ = segregation_photos
    assert upload("ZZZU9999999").status_code == 404
    for _ in range(6):
        assert upload().status_code == 200
    r = upload()
    assert r.status_code == 400 and "6" in r.json()["detail"]
    assert api.post(f"/api/unit-segregations/{seg['id']}/release").status_code == 200
    assert upload("BBBU2222222").status_code == 400


def test_segregation_edit_keeps_photos_and_ignores_payload_photos(api, segregation_photos):
    seg, upload, tmp_path = segregation_photos
    kept = _seg_item(upload("AAAU1111111").json(), "AAAU1111111")["photos"][0]
    dropped = _seg_item(upload("BBBU2222222").json(), "BBBU2222222")["photos"][0]

    r = api.put(f"/api/unit-segregations/{seg['id']}", json={"items": [
        {"container_number": "AAAU1111111", "shipping_line": "MSC", "photos": [{"id": "x", "url": "/api/uploads/alheio.png"}]},
    ]})
    assert r.status_code == 200, r.text
    assert _seg_item(r.json(), "AAAU1111111")["photos"] == [kept]
    assert _saved_file(tmp_path, kept).is_file()
    assert not _saved_file(tmp_path, dropped).exists()  # o container saiu da reserva


def test_segregation_delete_removes_photos_and_pdf_includes_them(api, segregation_photos):
    seg, upload, tmp_path = segregation_photos
    without_photo = api.get(f"/api/unit-segregations/{seg['id']}/pdf")
    photo = _seg_item(upload().json(), "AAAU1111111")["photos"][0]
    with_photo = api.get(f"/api/unit-segregations/{seg['id']}/pdf")
    assert with_photo.status_code == 200 and len(with_photo.content) > len(without_photo.content)

    assert api.delete(f"/api/unit-segregations/{seg['id']}").status_code == 200
    assert not _saved_file(tmp_path, photo).exists()


def test_audit_item_updates_do_not_overwrite_each_other(api, stock_history):
    client = api.post("/api/clients", json={"name": "Cliente Alfa"}).json()
    audit = api.post("/api/container-audits", json={"client_id": client["id"]}).json()
    assert {i["container_number"] for i in audit["items"]} == {"BACK2222222", "NORM3333333"}
    aid = audit["id"]

    async def both():
        files = {"file": ("x.png", io.BytesIO(PNG), "image/png")}
        return await asyncio.gather(
            api._client.put(f"/api/container-audits/{aid}/items", json={"container_number": "NORM3333333", "status": "CONFIRMADO", "observations": "ok"},
                            headers=api._headers["admin"]),
            api._client.post(f"/api/container-audits/{aid}/items/NORM3333333/photo", files=files, headers=api._headers["admin"]),
        )

    res = api.run(both())
    assert all(x.status_code == 200 for x in res), [x.text for x in res]
    item = next(i for i in api.run(api.db.container_audits.find_one({"id": aid}))["items"] if i["container_number"] == "NORM3333333")
    assert item["status"] == "CONFIRMADO" and item["observations"] == "ok" and item["photo"]

    r = api.put(f"/api/container-audits/{aid}/items", json={"container_number": "EXTR4444444", "status": "CONFIRMADO"})
    assert r.status_code == 200
    # O servidor padroniza o número (XXXX999999-9) e, fora da lista, grava como Não Esperado
    extra = [i for i in r.json()["items"] if i["container_number"].startswith("EXTR444444-")]
    assert len(extra) == 1 and extra[0]["expected"] is False and extra[0]["status"] == "NAO_ESPERADO"
