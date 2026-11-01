import asyncio
import io

from PIL import Image

from branding import DEFAULT_ACCENT, accent, contrast_on_white, email_layout, readable_accent, set_accent, suggest_accent
from reports import _pdf_section_title


def _logo(*colors):
    image = Image.new("RGBA", (100, 100), (255, 255, 255, 0))
    for i, color in enumerate(colors):
        image.paste(color, (i * 20, 0, i * 20 + 20, 100))
    out = io.BytesIO()
    image.save(out, format="PNG")
    out.seek(0)
    return out


def test_light_color_is_darkened_until_readable():
    color = readable_accent("#FACC15")
    assert contrast_on_white(color) >= 4.5
    assert readable_accent(DEFAULT_ACCENT) == DEFAULT_ACCENT


def test_suggestion_uses_the_dominant_color_of_the_logo():
    out = suggest_accent(_logo((0, 70, 160, 255), (0, 70, 160, 255), (255, 255, 255, 255), (0, 0, 0, 255)))
    assert out["color"] == "#0046A0" and out["adjusted"] is False and out["red_hue"] is False


def test_neutral_logo_has_no_suggestion():
    assert suggest_accent(_logo((0, 0, 0, 255), (255, 255, 255, 255), (120, 120, 120, 255))) is None


def test_yellow_logo_is_adjusted_and_red_logo_is_flagged():
    assert suggest_accent(_logo((250, 204, 21, 255)))["adjusted"] is True
    assert suggest_accent(_logo((200, 16, 30, 255)))["red_hue"] is True


def test_accent_set_in_a_task_does_not_reach_other_tasks():
    async def tenant(color):
        set_accent(color)
        await asyncio.sleep(0)
        return accent()

    async def main():
        return await asyncio.gather(tenant("#112233"), tenant(None))

    assert asyncio.run(main()) == ["112233", DEFAULT_ACCENT]


def test_company_accent_reaches_documents_and_is_validated(api):
    assert api.put("/api/company-settings", json={"accent_color": "azul"}).status_code == 400
    saved = api.put("/api/company-settings", json={"accent_color": "#facc15"}).json()
    assert saved["accent_color"].startswith("#") and contrast_on_white(saved["accent_color"]) >= 4.5
    set_accent(saved["accent_color"])
    style = _pdf_section_title("Seção", 500)[1]._cellvalues[0][0].style
    assert style.textColor.hexval().upper().endswith(saved["accent_color"][1:])
    assert api.put("/api/company-settings", json={"accent_color": ""}).json().get("accent_color") is None
    set_accent(None)


def test_email_escapes_company_name_and_uses_the_accent():
    set_accent("#112233")
    html = email_layout("A&B <Log>", "Título", "<p>corpo</p>", "Rodapé")
    set_accent(None)
    assert "A&amp;B &lt;Log&gt;" in html and "#112233" in html and "<p>corpo</p>" in html
