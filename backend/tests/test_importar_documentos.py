"""Importação de documentos nos cadastros: leitura da CNH, RG e CRLV (a
chamada ao Claude é trocada por uma resposta pronta), CRLV-e lido pelo texto
do PDF e CNH-e pelo OCR local, sem chave, conferência dos dígitos do CPF/RENAVAM, arquivo guardado
só quando o documento foi lido, e a edição do Motorista mantendo os campos
que o formulário não envia."""
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
    monkeypatch.setenv("ANTHROPIC_API_KEY", "chave-de-teste")

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


def test_cnh_fields_are_normalized_and_file_is_not_kept(api, fake_reader):
    calls = fake_reader(CNH)
    before = set(shared.UPLOADS_DIR.iterdir())
    r = _upload(api, "cnh")
    assert r.status_code == 200, r.text
    body = r.json()
    assert calls["file_ext"] == ".pdf" and calls["model_env"] == "DOCUMENT_OCR_MODEL"
    assert body["found"] is True and body["warnings"] == []
    assert body["fields"] == {
        "name": "JOSE DA SILVA", "cpf": "529.982.247-25", "rg": "12.345.678-9", "rg_issuer": "SSP",
        "rg_uf": "SP", "birth_date": "1980-03-05", "cnh_number": "01234567890", "cnh_category": "AE",
        "cnh_expiry": "2099-12-10",
    }
    # da CNH só os dados vão para o cadastro
    assert body["file_url"] is None and set(shared.UPLOADS_DIR.iterdir()) == before


def test_rg_file_is_kept(api, fake_reader):
    fake_reader({k: v for k, v in CNH.items() if k in document_ocr._PERSON_FIELDS})
    body = _upload(api, "rg").json()
    try:
        assert body["found"] is True
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


def _crlv_e_pdf(values):
    """PDF com o layout do CRLV-e: rótulo em fonte 5,8 e o valor em fonte 10
    logo abaixo, na mesma coluna (posições do documento real)."""
    from reportlab.pdfgen import canvas
    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=(595, 842))
    pdf.setFont("Helvetica", 6.4)
    pdf.drawString(31, 842 - 70, "CERTIFICADO DE REGISTRO E LICENCIAMENTO DE VEÍCULO - DIGITAL")
    for label, x, top, gap, value in values:
        pdf.setFont("Helvetica", 5.8)
        pdf.drawString(x, 842 - top - 5, label)
        pdf.setFont("Helvetica", 10)
        pdf.drawString(x, 842 - top - gap - 8, value)
    pdf.save()
    return buffer.getvalue()


def test_crlv_e_pdf_is_read_from_text_without_api_key(api, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    renavam = _valid_renavam("0012345678")
    content = _crlv_e_pdf([
        ("CÓDIGO RENAVAM", 31, 91, 10, renavam), ("PLACA", 31, 117, 10, "ABC1D23"),
        ("EXERCÍCIO", 103, 117, 10, "2026"), ("POTÊNCIA/CILINDRADA", 317, 103, 10, "540CV/****"),
        ("PESO BRUTO TOTAL", 510, 103, 10, "23.00"), ("CAPACIDADE", 510, 65, 22, "*.*"),
        ("EIXOS", 504, 130, 10, "3"), ("ANO FABRICAÇÃO", 31, 144, 10, "2021"), ("ANO MODELO", 103, 144, 10, "2022"),
        ("NÚMERO DO CRV", 31, 170, 10, "***"), ("MARCA / MODELO / VERSÃO", 31, 274, 19, "VOLVO/FH 540 6X4T"),
        ("ESPÉCIE / TIPO", 31, 309, 19, "CARGA/CAMINHAO TRATOR"), ("CHASSI", 130, 344, 19, "9BVABC12345678901"),
        ("COR PREDOMINANTE", 31, 379, 19, "BRANCA"), ("COMBUSTÍVEL", 102, 379, 19, "DIESEL"),
        ("NOME", 317, 182, 8, "TRANSPORTES ALFA"),
    ])
    r = _upload(api, "crlv", content=content)
    assert r.status_code == 200, r.text
    body = r.json()
    _remove(body["file_url"])
    assert body["found"] is True and body["warnings"] == [] and body["file_url"]
    assert body["fields"] == {
        "plate": "ABC1D23", "renavam": renavam, "chassis": "9BVABC12345678901", "brand": "VOLVO",
        "model": "FH 540 6X4T", "year": 2021, "model_year": 2022, "color": "BRANCA", "fuel_type": "DIESEL",
        "vehicle_type": "CAVALO", "category": "TRACAO", "engine_power": "540CV", "gross_weight": "23.00",
        "axle_count": 3,
    }
    assert body["info"] == {"licensing_year": 2026, "owner_name": "TRANSPORTES ALFA"}


def test_without_api_key_photos_and_cnh_explain_what_is_missing(api, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    r = _upload(api, "cnh")
    assert r.status_code == 503 and "ANTHROPIC_API_KEY" in r.json()["detail"]
    r = _upload(api, "crlv")  # PDF sem texto (escaneado)
    assert r.status_code == 503 and "CRLV-e em PDF" in r.json()["detail"]


def test_brand_without_slash_and_trailer_prefix():
    warnings = []
    fields = document_ocr._crlv_fields({**CRLV, "brand_model": "SR/RANDON SR CS 3E", "power_displacement": "0CV/****"}, warnings)
    assert fields["brand"] == "RANDON" and fields["model"] == "SR CS 3E" and fields["engine_power"] is None


# Trechos como o OCR devolve a frente da CNH-e: [esquerda, topo, altura, texto, confiança]
CNH_OCR = [
    [192, 34, 28, "REPÚBLICA FEDERATIVA DO BRASIL", 0.99],
    [218, 102, 21, "CARTEIRA NACIONAL DE HABILITAÇÃO", 0.98],
    [163, 151, 23, "NOME", 1.0], [159, 183, 23, "JOSE DA SILVA", 1.0],
    [490, 217, 24, "DOC. IDENTIDADE/ORG EMISSOR/UF", 1.0], [484, 245, 25, "12345678 SSP SP", 0.98],
    [490, 285, 22, "CPF", 1.0], [742, 286, 22, "DATA NASCIMENTO", 1.0],
    [483, 311, 25, "529.982.247-25", 1.0], [737, 311, 25, "05/03/1980", 1.0],
    [488, 351, 25, "FILIAÇÃO", 0.95], [484, 379, 24, "JOAO DA SILVA", 0.96],
    [816, 526, 22, "CAT. HAB.", 0.98], [806, 552, 25, "AE", 1.0],
    [161, 595, 20, "- Nº REGISTRO", 0.93], [489, 596, 19, "VALIDADE", 1.0], [699, 594, 25, "1ª HABILITAÇÃO", 0.99],
    [482, 619, 25, "10/12/2099", 1.0], [158, 620, 24, "01234567890", 1.0], [694, 620, 25, "01/02/2005", 1.0],
]


def test_cnh_e_fields_by_position():
    data = document_ocr.cnh_from_ocr_lines(CNH_OCR)
    assert data["full_name"] == "JOSE DA SILVA" and data["cpf"] == "529.982.247-25"
    assert (data["rg_number"], data["rg_issuer"], data["rg_uf"]) == ("12345678", "SSP", "SP")
    assert data["birth_date"] == "05/03/1980" and data["cnh_category"] == "AE"
    assert data["cnh_registration_number"] == "01234567890" and data["cnh_expiry"] == "10/12/2099"
    assert document_ocr._split_rg("12345678SSPCE") == ("12345678", "SSP", "CE")
    # verso da CNH ou outro documento: não é a frente da CNH
    assert document_ocr.cnh_from_ocr_lines([[10, 10, 20, "OBSERVAÇÕES", 1.0]]) is None


def test_cnh_e_pdf_is_read_without_api_key_and_file_is_not_kept(api, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(document_ocr, "_pdf_card_images", lambda content: [b"verso", b"frente"])

    async def fake_ocr(image):
        return CNH_OCR if image == b"frente" else [[165, 16, 20, "OBSERVAÇÕES", 0.99]]
    monkeypatch.setattr(document_ocr, "_ocr_lines", fake_ocr)
    before = set(shared.UPLOADS_DIR.iterdir())
    r = _upload(api, "cnh")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["found"] is True and body["warnings"] == [] and body["file_url"] is None
    assert body["fields"]["cnh_number"] == "01234567890" and body["fields"]["rg_uf"] == "SP"
    assert set(shared.UPLOADS_DIR.iterdir()) == before


def test_cnh_e_falls_back_when_local_ocr_is_unavailable(api, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(document_ocr, "_pdf_card_images", lambda content: [b"frente"])

    async def no_ocr(image):
        return None
    monkeypatch.setattr(document_ocr, "_ocr_lines", no_ocr)
    r = _upload(api, "cnh")
    assert r.status_code == 503 and "CNH-e em PDF" in r.json()["detail"]


def test_ocr_worker_reads_an_image(api):
    """O processo de OCR de verdade (pulado onde o RapidOCR não está instalado)."""
    pytest.importorskip("rapidocr")
    from PIL import Image, ImageDraw, ImageFont
    image = Image.new("RGB", (963, 680), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=26)
    for x, y, text in [(160, 100, "CARTEIRA NACIONAL DE HABILITACAO"), (490, 285, "CPF"), (484, 320, "529.982.247-25")]:
        draw.text((x, y), text, fill="black", font=font)
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG")
    lines = api.run(document_ocr._ocr_lines(buffer.getvalue()))
    assert lines is not None
    texts = [line[3] for line in lines]
    assert "529.982.247-25" in texts and "CPF" in texts
