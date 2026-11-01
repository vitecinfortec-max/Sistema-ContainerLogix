"""Identidade visual dos documentos: paleta neutra (grafite) comum a todas as
empresas e uma única cor de destaque, escolhida em "Dados da Empresa".

A cor de destaque vale para a empresa da requisição: get_company_settings()
guarda o valor num ContextVar (o mesmo mecanismo do tenant atual), então os
geradores de PDF/Excel leem accent() sem precisar receber a cor por parâmetro.
As cores de status (PDF_TONES em reports.py) não mudam por empresa: "cancelado"
e "pago" têm o mesmo significado em qualquer uma.
"""
import colorsys
from contextvars import ContextVar
from html import escape
from typing import Optional

BRAND_DARK = "0F172A"    # nome da empresa, valores de destaque
BRAND_BAR = "1E293B"     # faixas de tabela e barras (texto branco por cima)
BRAND_TEXT = "334155"    # texto das tabelas
BRAND_MUTED = "475569"   # textos secundários (CNPJ, rótulos, rodapé)
BRAND_LINE = "E2E8F0"    # linhas finas entre as linhas das tabelas
BRAND_SOFT = "F1F5F9"    # fundo de indicadores e totais
BRAND_ZEBRA = "F8FAFC"   # fundo das linhas alternadas

DEFAULT_ACCENT = "0F766E"
MIN_CONTRAST = 4.5  # WCAG AA para texto sobre branco

_accent: ContextVar = ContextVar("brand_accent", default=None)


def set_accent(color: Optional[str]) -> None:
    _accent.set(color.lstrip("#").upper() if color else None)


def accent() -> str:
    """Cor de destaque da empresa atual (RRGGBB): só a linha do cabeçalho e os títulos de seção."""
    return _accent.get() or DEFAULT_ACCENT


def _rgb(color: str) -> tuple:
    color = color.lstrip("#")
    return tuple(int(color[i:i + 2], 16) / 255 for i in (0, 2, 4))


def _hex_color(rgb) -> str:
    return "".join(f"{round(c * 255):02X}" for c in rgb)


def contrast_on_white(color: str) -> float:
    def channel(c):
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (channel(c) for c in _rgb(color))
    return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05)


def readable_accent(color: str) -> str:
    """Escurece a cor, mantendo o matiz, até ser legível como texto sobre branco."""
    color = color.lstrip("#").upper()
    h, l, s = colorsys.rgb_to_hls(*_rgb(color))
    while contrast_on_white(color) < MIN_CONTRAST and l > 0:
        l = max(l - 0.01, 0)
        color = _hex_color(colorsys.hls_to_rgb(h, l, s))
    return color


def is_red_hue(color: str) -> bool:
    """Vermelho é a cor de erro/cancelado nos documentos: vale avisar quem escolhe."""
    h, _, s = colorsys.rgb_to_hls(*_rgb(color))
    return s > 0.25 and (h < 0.03 or h > 0.96)


def suggest_accent(image_file) -> Optional[dict]:
    """Cor predominante da logo, ignorando fundo, branco, preto e cinzas. None
    quando a logo é neutra (só preto, branco ou cinza)."""
    from PIL import Image

    with Image.open(image_file) as source:
        image = source.convert("RGBA")
    image.thumbnail((160, 160))
    buckets, opaque = {}, 0
    for r, g, b, alpha in image.getdata():
        if alpha < 128:
            continue
        opaque += 1
        h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
        if s < 0.25 or l < 0.12 or l > 0.92:
            continue
        bucket = buckets.setdefault(int(h * 24) % 24, {"score": 0.0, "weight": 0.0, "rgb": [0.0, 0.0, 0.0]})
        bucket["score"] += s
        bucket["weight"] += 1
        for i, value in enumerate((r, g, b)):
            bucket["rgb"][i] += value / 255
    colored = sum(b["weight"] for b in buckets.values())
    if not opaque or colored / opaque < 0.01:  # só o serrilhado das bordas de uma logo preta
        return None
    best = max(buckets.values(), key=lambda b: b["score"])
    original = _hex_color(c / best["weight"] for c in best["rgb"])
    color = readable_accent(original)
    return {"color": f"#{color}", "original": f"#{original}", "adjusted": color != original, "red_hue": is_red_hue(color)}


def email_layout(company_name: str, heading: str, body_html: str, footer: str) -> str:
    """Modelo único dos e-mails. `body_html` já vem pronto: quem monta escapa os dados."""
    return f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #{BRAND_TEXT};">
        <div style="font-size: 20px; font-weight: bold; color: #{BRAND_DARK}; padding-bottom: 12px; border-bottom: 3px solid #{accent()};">
            {escape(company_name)}
        </div>
        <div style="background-color: #{BRAND_ZEBRA}; border: 1px solid #{BRAND_LINE}; border-radius: 6px; padding: 20px; margin-top: 20px;">
            <h3 style="color: #{BRAND_DARK}; margin-top: 0;">{escape(heading)}</h3>
            {body_html}
        </div>
        <p style="color: #{BRAND_MUTED}; font-size: 12px; margin-top: 24px; text-align: center;">{escape(footer)}</p>
    </div>
    """
