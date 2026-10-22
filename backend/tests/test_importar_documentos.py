"""Importação de documentos nos cadastros: leitura da CNH, RG e CRLV (a
chamada ao Claude é trocada por uma resposta pronta), conferência dos dígitos
do CPF/RENAVAM, arquivo guardado só quando o documento foi lido, e a edição
do Motorista mantendo os campos que o formulário não envia."""
import io

import pytest

import document_ocr
import shared

PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"

CNH = {
    "document_found": True, "full_name": "jose  da silva", "cpf": "529.982.247-25",
    "rg_number": "12.345.678-9", "rg_issuer": "SSP", "rg_uf": "sp", "birth_date": "05/03/1980",
    "cnh_registration_number": "01234567890", "cnh_category": "A E", "cnh_expiry": "10/12/2099",
}
CRLV = {
    "document_found": True, "plate": "abc-1d23", "renavam": "", "chassis": "9BV ABC12345678901",
    "brand_model": "I/VOLVO/FH 540 6X4T", "manufacture_year": "2021", "model_year": "2022",
    "color": "branca", "fuel": "DIESEL", "species_type": "CARGA / CAMINHÃO TRATOR",
    "body_type": "NAO APLICAVEL", "power_displacement": "540CV/12800", "gross_weight": "23,00",
    "axles": "3", "load_capacity": "", "crv_number": "123456789012", "licensing_year": "2026",
    "owner_name": "Transportes Alfa", "owner_document": "12.345.678/0001-90",
}


def _valid_renavam(base10):
    total = sum(int(d) * w for d, w in zip(base10, (3, 2, 9, 8, 7, 6, 5, 4, 3, 2)))
    check = (total * 10) % 11
    return base10 + str(0 if check == 10 else check)


@pytest.fixture
def fake_reader(monkeypatch):
    calls = {}

    def use(answer):
        async def read_structured(content, file_ext, prompt, schema, **kwargs):
            calls.update(file_ext=file_ext, schema=schema, **kwargs)
            return answer
        monkeypatch.setattr(document_ocr, "read_structured", read_structured)
        return calls
    return use


def _upload(api, kind, content=PDF, name="doc.pdf"):
    return api.post("/api/documents/read", params={"kind": kind},
                    files={"file": (name, io.BytesIO(content), "application/pdf")})


def _remove(url):
    if url:
        (shared.UPLOADS_DIR / url.rsplit("/", 1)[-1]).unlink(missing_ok=True)


def test_cnh_fields_are_normalized_and_file_is_kept(api, fake_reader):
    calls = fake_reader(CNH)
    r = _upload(api, "cnh")
    assert r.status_code == 200, r.text
    body = r.json()
    try:
        assert calls["file_ext"] == ".pdf" and calls["model_env"] == "DOCUMENT_OCR_MODEL"
        assert body["found"] is True and body["warnings"] == []
        assert body["fields"] == {
            "name": "JOSE DA SILVA", "cpf": "529.982.247-25", "rg": "12.345.678-9", "rg_issuer": "SSP",
            "rg_uf": "SP", "birth_date": "1980-03-05", "cnh_number": "01234567890", "cnh_category": "AE",
            "cnh_expiry": "2099-12-10",
        }
        assert body["file_url"].startswith("/api/uploads/") and body["file_url"].endswith(".pdf")
        assert (shared.UPLOADS_DIR / body["file_url"].rsplit("/", 1)[-1]).read_bytes() == PDF
    finally:
        _remove(body.get("file_url"))


def test_wrong_cpf_and_expired_cnh_are_warned(api, fake_reader):
    fake_reader({**CNH, "cpf": "529.982.247-26", "cnh_expiry": "01/01/2020"})
    body = _upload(api, "cnh").json()
    _remove(body["file_url"])
    assert any("CPF lido (529.982.247-26)" in w for w in body["warnings"])
    assert any("CNH vencida em 01/01/2020" in w for w in body["warnings"])


def test_unreadable_document_saves_no_file(api, fake_reader):
    fake_reader({key: (False if key == "document_found" else "") for key in CNH})
    before = set(shared.UPLOADS_DIR.iterdir())
    body = _upload(api, "rg").json()
    assert body["found"] is False and body["file_url"] is None
    assert set(shared.UPLOADS_DIR.iterdir()) == before


def test_invalid_kind_and_extension_are_refused(api, fake_reader):
    fake_reader(CNH)
    assert _upload(api, "passaporte").status_code == 400
    assert _upload(api, "cnh", content=b"texto", name="doc.txt").status_code == 400


def test_crlv_maps_to_vehicle_fields(api, fake_reader):
    renavam = _valid_renavam("0012345678")
    fake_reader({**CRLV, "renavam": renavam})
    body = _upload(api, "crlv").json()
    _remove(body["file_url"])
    assert body["warnings"] == []
    assert body["fields"] == {
        "plate": "ABC1D23", "renavam": renavam, "chassis": "9BVABC12345678901", "brand": "VOLVO",
        "model": "FH 540 6X4T", "year": 2021, "model_year": 2022, "color": "BRANCA", "fuel_type": "DIESEL",
        "vehicle_type": "CAVALO", "category": "TRACAO", "engine_power": "540CV/12800", "gross_weight": "23,00",
        "axle_count": 3, "crlv_number": "123456789012",
    }
    assert body["info"] == {"licensing_year": 2026, "owner_name": "TRANSPORTES ALFA", "owner_document": "12.345.678/0001-90"}


def test_crlv_bad_renavam_plate_and_chassis_are_warned(api, fake_reader):
    fake_reader({**CRLV, "renavam": "12345678901", "plate": "AB12345", "chassis": "9BVOO1"})
    body = _upload(api, "crlv").json()
    _remove(body["file_url"])
    text = " | ".join(body["warnings"])
    assert "RENAVAM lido" in text and "placa lida (AB12345)" in text and "chassi lido (9BVOO1)" in text


def test_species_type_mapping():
    assert document_ocr._vehicle_type("CARGA / SEMI-REBOQUE") == ("CARRETA", "CARGA")
    assert document_ocr._vehicle_type("CARGA/CAMINHAO") == ("CAMINHÃO", "CARGA")
    assert document_ocr._vehicle_type("PASSAGEIRO/AUTOMOVEL") == (None, None)
    assert document_ocr._fuel("ALCOOL/GASOLINA") == "GASOLINA"
    assert document_ocr._fuel("NAO SE APLICA") is None


def test_driver_edit_keeps_fields_the_form_does_not_send(api):
    r = api.post("/api/drivers", json={
        "name": "Zé", "cpf": "529.982.247-25", "photo_url": "/api/uploads/foto.jpg",
        "document_attachments": ["/api/uploads/cnh.pdf"],
    })
    assert r.status_code == 200, r.text
    driver_id = r.json()["id"]
    r = api.put(f"/api/drivers/{driver_id}", json={"name": "Zé Silva", "cpf": "529.982.247-25"})
    assert r.status_code == 200, r.text
    doc = api.run(api.db.drivers.find_one({"id": driver_id}))
    assert doc["name"] == "Zé Silva" and doc["photo_url"] == "/api/uploads/foto.jpg"
    assert doc["document_attachments"] == ["/api/uploads/cnh.pdf"]
    # enviado vazio, apaga
    api.put(f"/api/drivers/{driver_id}", json={"name": "Zé Silva", "cpf": "529.982.247-25", "document_attachments": []})
    assert api.run(api.db.drivers.find_one({"id": driver_id}))["document_attachments"] == []
