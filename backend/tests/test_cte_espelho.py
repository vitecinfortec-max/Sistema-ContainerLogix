"""CT-e (27/10/2026): espelho em PDF para conferência antes de transmitir,
marcado "SEM VALOR FISCAL", em qualquer situação (inclusive rascunho)."""
import io

from pdfminer.high_level import extract_text

from test_cte import _full_body
from test_cte_viagem import TRIP
from test_mdfe import provider  # noqa: F401  (fixture)


def test_preview_pdf_of_draft(api, provider):  # noqa: F811
    cte = api.post("/api/ctes", json=_full_body(**TRIP)).json()
    assert cte["status"] == "RASCUNHO"
    r = api.get(f"/api/ctes/{cte['id']}/preview-pdf")
    assert r.status_code == 200, r.text
    assert r.content.startswith(b"%PDF")
    assert "SEM_VALOR_FISCAL" in r.headers["content-disposition"]
    text = " ".join(extract_text(io.BytesIO(r.content)).split())
    assert "SEM VALOR FISCAL - ESPELHO PARA CONFERÊNCIA" in text
    assert "Rascunho (não transmitido)" in text
    assert "MARIA SOUZA" in text and "ABC1D23 / XYZ9A99 / QWE1R23" in text
    assert "Vale-pedágio nº 998877" in text  # observações como vão no CT-e


def test_preview_pdf_unknown_cte(api, provider):  # noqa: F811
    assert api.get("/api/ctes/nao-existe/preview-pdf").status_code == 404
