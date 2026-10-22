"""OCR de uma imagem (bytes pela entrada padrão), rodado num processo à parte
por document_ocr.py: o OCR soma uns 230 MB de memória, que assim voltam ao
sistema quando a leitura termina (o plano do servidor tem 512 MB), e uma
falha dele não derruba o servidor.

Saída: JSON com a lista de trechos lidos, cada um
[esquerda, topo, altura, texto, confiança] em pixels da imagem.
"""
import json
import sys


def main():
    from rapidocr import RapidOCR

    image = sys.stdin.buffer.read()
    engine = RapidOCR(params={"Global.log_level": "critical"})
    result = engine(image)
    items = []
    for box, text, score in zip(result.boxes if result.boxes is not None else [], result.txts or [], result.scores or []):
        left = float(min(p[0] for p in box))
        top = float(min(p[1] for p in box))
        height = float(max(p[1] for p in box)) - top
        items.append([left, top, height, text, float(score)])
    sys.stdout.write(json.dumps(items))


if __name__ == "__main__":
    main()
