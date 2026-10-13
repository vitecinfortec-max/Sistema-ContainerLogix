"""
Testes do PDF da Vistoria de Container e do Registro Fotográfico (download em
lote das listas), contra o app inteiro com banco em memória e a pasta de
uploads trocada por uma pasta temporária.
"""
import io
import re

import pytest
from PIL import Image

from reports import photo_document_filename
from routers import container_inspections, container_vistorias


def jpeg(width=600, height=800):
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (40, 120, 200)).save(buffer, "JPEG")
    return buffer.getvalue()


def page_count(pdf: bytes) -> int:
    return len(re.findall(rb"/Type\s*/Page[^s]", pdf))


@pytest.fixture
def docs(api, tmp_path, monkeypatch):
    monkeypatch.setattr(container_vistorias, "UPLOADS_DIR", tmp_path)
    monkeypatch.setattr(container_inspections, "UPLOADS_DIR", tmp_path)
    return api


def create(api, path, photos=0, **fields):
    response = api.post(f"/api/{path}", json={"container_number": "TCLU7834740", **fields})
    assert response.status_code == 200, response.text
    record = response.json()
    for _ in range(photos):
        uploaded = api.post(
            f"/api/{path}/{record['id']}/upload-photo", params={"type": "front"},
            files={"file": ("foto.jpg", jpeg(), "image/jpeg")},
        )
        assert uploaded.status_code == 200, uploaded.text
    return record


class TestFilename:
    def test_document_container_and_number(self):
        assert photo_document_filename("Vistoria", "TCLU7834740", 4) == "Vistoria-TCLU7834740-4.pdf"

    def test_container_is_cleaned_up(self):
        assert photo_document_filename("EIR", " tclu 783474-0 ", 12) == "EIR-TCLU7834740-12.pdf"

    def test_missing_container(self):
        assert photo_document_filename("Vistoria", None, 1) == "Vistoria-SEM-CONTAINER-1.pdf"


class TestVistoriaPdf:
    def test_pdf_named_after_the_document(self, docs):
        vistoria = create(docs, "container-vistorias", photos=2, client_name="Cliente <Um> & Cia", observations="Linha 1\nLinha 2")
        response = docs.get(f"/api/container-vistorias/{vistoria['id']}/pdf")
        assert response.status_code == 200, response.text
        assert response.headers["content-type"] == "application/pdf"
        assert f"Vistoria-TCLU7834740-{vistoria['vistoria_number']}.pdf" in response.headers["content-disposition"]
        assert response.content.startswith(b"%PDF")

    def test_six_photos_fit_on_one_page_and_twelve_on_two(self, docs):
        six = create(docs, "container-vistorias", photos=6)
        twelve = create(docs, "container-vistorias", photos=12)
        assert page_count(docs.get(f"/api/container-vistorias/{six['id']}/pdf").content) == 1
        assert page_count(docs.get(f"/api/container-vistorias/{twelve['id']}/pdf").content) == 2

    def test_photo_missing_from_disk_does_not_break_the_document(self, docs, tmp_path):
        vistoria = create(docs, "container-vistorias", photos=1)
        for photo in (tmp_path / "container_vistorias" / vistoria["id"]).iterdir():
            photo.unlink()
        response = docs.get(f"/api/container-vistorias/{vistoria['id']}/pdf")
        assert response.status_code == 200
        assert response.content.startswith(b"%PDF")

    def test_without_photos(self, docs):
        vistoria = create(docs, "container-vistorias")
        assert docs.get(f"/api/container-vistorias/{vistoria['id']}/pdf").status_code == 200

    def test_unknown_vistoria(self, docs):
        assert docs.get("/api/container-vistorias/nao-existe/pdf").status_code == 404

    def test_requires_login(self, docs):
        vistoria = create(docs, "container-vistorias")
        assert docs.get(f"/api/container-vistorias/{vistoria['id']}/pdf", as_user=None).status_code in (401, 403)


class TestInspectionPdf:
    def test_pdf_named_after_the_document(self, docs):
        inspection = create(docs, "container-inspections", photos=3, booking="BK123")
        response = docs.get(f"/api/container-inspections/{inspection['id']}/pdf")
        assert response.status_code == 200, response.text
        assert response.headers["content-type"] == "application/pdf"
        assert f"RegistroFotografico-TCLU7834740-{inspection['inspection_number']}.pdf" in response.headers["content-disposition"]
        assert response.content.startswith(b"%PDF")

    def test_full_record_fits_on_one_page(self, docs):
        inspection = create(docs, "container-inspections", photos=8)
        assert page_count(docs.get(f"/api/container-inspections/{inspection['id']}/pdf").content) == 1

    def test_unknown_inspection(self, docs):
        assert docs.get("/api/container-inspections/nao-existe/pdf").status_code == 404
