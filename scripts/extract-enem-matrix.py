"""Rebuild the curriculum reference from the locally saved official INEP PDF.

Requires pypdf. This is a maintenance script, not a runtime dependency.
"""
import hashlib
import json
import re
from pathlib import Path
from pypdf import PdfReader

root = Path(__file__).resolve().parents[1]
source = root / "data/reference/enem-matriz-de-referencia.pdf"
reader = PdfReader(source)
areas = {}
for area, title, start, end in [
    ("matematica", "Matemática e suas Tecnologias", 14, 18),
    ("ciencias-natureza", "Ciências da Natureza e suas Tecnologias", 18, 23),
]:
    competencies = []
    for page_index in range(start, end):
        text = reader.pages[page_index].extract_text()
        text = re.sub(r"MATRIZES DE REFERÊNCIA\s+ENEM\s+VOL TAR PARA\s+O SUMÁRIO \d+", "", text)
        text = re.sub(r"MATEMÁTICA E SUAS\s+TECNOLOGIAS|CIÊNCIAS DA NATUREZA\s+E SUAS TECNOLOGIAS", "", text)
        text = text.replace("matérias-\nprimas", "matérias-primas")
        text = re.sub(r"(?<=[a-záéíóúâêôãõç])-\n(?=[a-záéíóúâêôãõç])", "", text)
        parts = re.split(r"Competência de área (\d+)\s*", text)
        for offset in range(1, len(parts), 2):
            number, body = int(parts[offset]), parts[offset + 1]
            pieces = re.split(r"H(\d+)\s*[–−-]\s*", body)
            clean = lambda value: re.sub(r"\s+", " ", value).strip()
            skills = [{"number": int(pieces[i]), "description": clean(pieces[i + 1])} for i in range(1, len(pieces), 2)]
            competencies.append({"number": number, "description": clean(pieces[0]), "page": page_index - 1, "skills": skills})
    assert len(competencies) == (7 if area == "matematica" else 8)
    assert [s["number"] for c in competencies for s in c["skills"]] == list(range(1, 31))
    areas[area] = {"title": title, "competencies": competencies}
payload = {
    "source": "https://download.inep.gov.br/enem/outros_documentos/enem_matriz_de_referencia_v1.pdf",
    "retrievedAt": "2026-10-12",
    "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
    "note": "Descrições transcritas do documento do INEP. A associação das questões às habilidades é editorial do Fisio, não uma classificação oficial do INEP.",
    "areas": areas,
}
(root / "data/reference/matrix.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
print("Matriz extraída: 15 competências e 60 habilidades.")
