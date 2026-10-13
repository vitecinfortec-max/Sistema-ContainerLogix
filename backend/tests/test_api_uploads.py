"""
Testes de API dos anexos (/api/uploads e /api/upload), contra o app inteiro
com banco em memória e a pasta de uploads trocada por uma pasta temporária.
"""
import pytest

import server
import shared
from routers import cadastros

PNG = bytes.fromhex("89504e470d0a1a0a") + b"x" * 32


@pytest.fixture
def uploads(api, tmp_path, monkeypatch):
    for module in (server, shared, cadastros):
        monkeypatch.setattr(module, "UPLOADS_DIR", tmp_path)
    (tmp_path / "foto.png").write_bytes(PNG)
    (tmp_path / "expense_reports" / "rel-1").mkdir(parents=True)
    (tmp_path / "expense_reports" / "rel-1" / "recibo.png").write_bytes(PNG)
    (tmp_path.parent / "fora-da-pasta.txt").write_text("segredo")
    api.tmp_path = tmp_path
    return api


def file_token(api, as_user="admin"):
    return api.get("/api/auth/file-token", as_user=as_user).json()["file_token"]


RECEIPT = "/api/uploads/expense_reports/rel-1/recibo.png"


class TestServeUploads:
    def test_ordinary_file_stays_public_by_default(self, uploads):
        response = uploads.get("/api/uploads/foto.png", as_user=None)
        assert response.status_code == 200
        assert response.content == PNG

    def test_missing_file(self, uploads):
        assert uploads.get("/api/uploads/nao-existe.png", as_user=None).status_code == 404

    def test_path_traversal_is_refused(self, uploads):
        assert uploads.get("/api/uploads/..%2Ffora-da-pasta.txt", as_user=None).status_code == 404
        assert uploads.get("/api/uploads/%2e%2e/fora-da-pasta.txt", as_user=None).status_code == 404

    def test_receipt_requires_login(self, uploads):
        assert uploads.get(RECEIPT, as_user=None).status_code == 401
        assert uploads.get(RECEIPT, as_user=None, params={"token": "lixo"}).status_code == 401

    def test_receipt_with_file_token_in_the_url(self, uploads):
        response = uploads.get(RECEIPT, as_user=None, params={"token": file_token(uploads)})
        assert response.status_code == 200
        assert response.content == PNG

    def test_receipt_with_session_header(self, uploads):
        assert uploads.get(RECEIPT).status_code == 200

    def test_receipt_is_admin_only(self, uploads):
        token = file_token(uploads, as_user="operator")
        assert uploads.get(RECEIPT, as_user=None, params={"token": token}).status_code == 403

    def test_receipt_refused_after_account_is_deactivated(self, uploads):
        token = file_token(uploads)
        uploads.run(uploads.db.users.update_one({"id": "admin-1"}, {"$set": {"active": False}}))
        assert uploads.get(RECEIPT, as_user=None, params={"token": token}).status_code == 401

    def test_everything_requires_login_when_the_switch_is_on(self, uploads, monkeypatch):
        monkeypatch.setattr(server, "_UPLOADS_REQUIRE_AUTH", True)
        assert uploads.get("/api/uploads/foto.png", as_user=None).status_code == 401
        token = file_token(uploads, as_user="operator")
        assert uploads.get("/api/uploads/foto.png", as_user=None, params={"token": token}).status_code == 200


class TestFileToken:
    def test_file_token_does_not_open_the_api(self, uploads):
        headers = {"Authorization": f"Bearer {file_token(uploads)}"}
        assert uploads.get("/api/movements", as_user=None, headers=headers).status_code == 401
        assert uploads.get("/api/auth/me", as_user=None, headers=headers).status_code == 401

    def test_file_token_requires_login(self, uploads):
        assert uploads.get("/api/auth/file-token", as_user=None).status_code in (401, 403)


class TestGenericUpload:
    def test_upload_then_fetch(self, uploads):
        response = uploads.post("/api/upload", files={"file": ("foto.png", PNG, "image/png")}, as_user="operator")
        assert response.status_code == 200, response.text
        assert uploads.get(response.json()["url"], as_user=None).content == PNG

    def test_upload_rejects_disguised_content(self, uploads):
        response = uploads.post("/api/upload", files={"file": ("foto.png", b"<html></html>", "image/png")})
        assert response.status_code == 400

    def test_delete_is_admin_only(self, uploads):
        assert uploads.delete("/api/upload/foto.png", as_user="operator").status_code == 403
        assert (uploads.tmp_path / "foto.png").exists()
        assert uploads.delete("/api/upload/foto.png").status_code == 200
        assert not (uploads.tmp_path / "foto.png").exists()
