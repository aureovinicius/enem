#!/usr/bin/env python3
"""Read only official ENEM item tables/dictionaries from remote ZIPs via HTTP Range.

This importer never downloads or opens candidate-level response tables. Run with
--fetch to refresh the small source files; without it, reuse the audited cache.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import collections
import csv
import datetime
import hashlib
import io
import json
import math
import re
import subprocess
import tempfile
import unicodedata
import urllib.parse
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data/reference/tri-source"
INDEX_URL = "https://www.gov.br/inep/pt-br/acesso-a-informacao/dados-abertos/microdados/enem"
MAX_RANGE = 12_000_000
METHOD_URL = "https://download.inep.gov.br/publicacoes/institucionais/avaliacoes_e_exames_da_educacao_basica/enem_procedimentos_de_analise.pdf"
NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def fetch_range(url, value):
    with tempfile.NamedTemporaryFile() as headers:
        result = subprocess.run([
            "curl", "--fail", "--silent", "--show-error", "--location",
            "--max-time", "90", "--retry", "2", "--max-filesize", str(MAX_RANGE), "--range", value,
            "--dump-header", headers.name, url,
        ], check=True, capture_output=True)
        raw_headers = Path(headers.name).read_text()
    ranges = re.findall(r"(?im)^Content-Range:\s*bytes\s+(\d+)-(\d+)/(\d+)", raw_headers)
    if not ranges:
        raise ValueError("Server did not honor the Range request; full downloads are forbidden")
    start, end, size = map(int, ranges[-1])
    if len(result.stdout) != end - start + 1 or len(result.stdout) > MAX_RANGE:
        raise ValueError("Unexpected or excessive Range response")
    metadata = {"size": size, "lastModified": None, "etag": None}
    for header, key in [("Last-Modified", "lastModified"), ("ETag", "etag")]:
        found = re.findall(rf"(?im)^{header}:\s*(.+)$", raw_headers)
        if found:
            metadata[key] = found[-1].strip()
    return result.stdout, start, metadata


class RangeZip(io.RawIOBase):
    def __init__(self, url):
        self.url = url
        self.tail, self.tail_start, self.metadata = fetch_range(url, "-65536")
        self.size = self.metadata["size"]
        self.position = 0
        self.downloaded = len(self.tail)

    def seekable(self):
        return True

    def tell(self):
        return self.position

    def seek(self, offset, whence=0):
        self.position = offset + (0 if whence == 0 else self.position if whence == 1 else self.size)
        return self.position

    def read(self, length=-1):
        length = self.size - self.position if length < 0 else length
        length = min(length, self.size - self.position)
        if length <= 0:
            return b""
        if length > MAX_RANGE:
            raise ValueError("Refusing a large ZIP range")
        start = self.position
        self.position += length
        if start >= self.tail_start:
            return self.tail[start - self.tail_start:start - self.tail_start + length]
        data, actual_start, _ = fetch_range(self.url, f"{start}-{start + length - 1}")
        if actual_start != start:
            raise ValueError("Range offset mismatch")
        self.downloaded += len(data)
        return data


def fetch_year(year):
    url = f"https://download.inep.gov.br/microdados/microdados_enem_{year}.zip"
    target = CACHE / str(year)
    target.mkdir(parents=True, exist_ok=True)
    remote = RangeZip(url)
    manifest = {"year": year, "sourceUrl": url, "indexUrl": INDEX_URL,
                "archive": remote.metadata, "members": [], "excludedCandidateData": True}
    with zipfile.ZipFile(remote) as archive:
        for info in archive.infolist():
            name = info.filename
            upper = Path(name).name.upper()
            # Explicit allowlist: item data, dictionary and explanatory README.
            wanted = ("ITENS_PROVA" in upper or "DICION" in upper or "LEIA" in upper)
            if not wanted or upper.startswith("~$") or info.is_dir() or not upper.endswith((".CSV", ".XLSX", ".XLS", ".PDF", ".TXT")):
                continue
            if info.file_size > MAX_RANGE or info.compress_size > MAX_RANGE:
                raise ValueError(f"Unexpected large metadata member: {name}")
            data = archive.read(info)
            destination = target / Path(name).name
            destination.write_bytes(data)
            manifest["members"].append({"name": name, "file": str(destination.relative_to(ROOT)),
                                        "size": len(data), "sha256": hashlib.sha256(data).hexdigest()})
    manifest["bytesTransferred"] = remote.downloaded
    (target / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"year": year, "transferred": remote.downloaded,
                      "files": [Path(m["file"]).name for m in manifest["members"]]}, ensure_ascii=False), flush=True)
    return manifest


def spreadsheet_rows(path, sheet=1):
    """Read the simple official XLSX dictionary without third-party libraries."""
    with zipfile.ZipFile(path) as archive:
        strings = []
        if "xl/sharedStrings.xml" in archive.namelist():
            for item in ET.fromstring(archive.read("xl/sharedStrings.xml")).findall("s:si", NS):
                strings.append("".join(t.text or "" for t in item.findall(".//s:t", NS)))
        for row in ET.fromstring(archive.read(f"xl/worksheets/sheet{sheet}.xml")).findall(".//s:row", NS):
            values = {}
            for cell in row.findall("s:c", NS):
                value = cell.find("s:v", NS)
                text = value.text if value is not None else ""
                if cell.get("t") == "s":
                    text = strings[int(text)]
                if cell.get("t") == "inlineStr":
                    text = "".join(t.text or "" for t in cell.findall(".//s:t", NS))
                values[re.sub(r"\d", "", cell.get("r"))] = text
            yield values


def official_regular_codes(year):
    path = next(p for p in (CACHE / str(year)).glob("*.xlsx") if not p.name.startswith("~$"))
    current, codes = "", {}
    for row in spreadsheet_rows(path):
        if row.get("A"):
            current = row["A"]
        if current.startswith("CO_PROVA_") and row.get("D", "").strip().upper() == "AZUL":
            area = current.removeprefix("CO_PROVA_")
            if area in codes:
                raise ValueError(f"Ambiguous regular blue code: {year} {area}")
            codes[area] = int(row["C"])
    if set(codes) != {"CN", "CH", "LC", "MT"}:
        raise ValueError(f"Incomplete official code dictionary for {year}: {codes}")
    return codes, str(path.relative_to(ROOT))


def official_area(year, number):
    # The API's discipline labels are not used as proof of official test area.
    order = ["CN", "CH", "LC", "MT"] if year == 2009 else (
        ["CH", "CN", "LC", "MT"] if year <= 2016 else ["LC", "CH", "CN", "MT"])
    return order[(number - 1) // 45]


def printed_number(year, row):
    """Documented position conventions, checked against complete answer sequences."""
    position, area = int(row["CO_POSICAO"]), row["SG_AREA"]
    if year == 2016:
        return position + {"CH": -45, "CN": -45, "LC": 90, "MT": 0}[area]
    if year == 2017:
        if area == "LC":
            return position if position <= 5 else position - 5
        return position + {"CH": 45, "CN": 90, "MT": 135}[area]
    return position


def source_key(question):
    key = f"{question['year']}-{question['index']}"
    return key + (f"-{question['language']}" if question.get("language") else "")


def normalized_text(value):
    """Compare audited text anchors despite PDF whitespace and accent encoding."""
    return re.sub(r"[^a-z0-9]", "", unicodedata.normalize("NFD", value.lower()))


def official_language(year, row):
    number = printed_number(year, row)
    foreign = year >= 2010 and row["SG_AREA"] == "LC" and number in (
        range(91, 96) if year <= 2016 else range(1, 6))
    if not foreign:
        return None
    return {"0": "ingles", "1": "espanhol"}.get(row.get("TP_LINGUA"))


def import_cached(years):
    source_path = ROOT / "data/enem/all-questions.json"
    api = json.loads(source_path.read_text())
    local = {source_key(q): q for q in api["questions"]}
    if len(local) != len(api["questions"]):
        raise ValueError("Ambiguous duplicate API keys")
    evidence = {}
    for path in sorted((ROOT / "data/reference").glob("tri-booklet-evidence-*.json")):
        content = json.loads(path.read_text())
        for entry in content if isinstance(content, list) else content.get("evidence", []):
            key = (entry["year"], entry["area"])
            if key in evidence:
                raise ValueError(f"Duplicate booklet evidence for {key}")
            evidence[key] = entry
    output = {
        "schemaVersion": 1,
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "source": "INEP — Microdados do ENEM / ITENS_PROVA",
        "sourceIndexUrl": INDEX_URL,
        "sourceApiCommit": api.get("sourceCommit"),
        "sourceApiSha256": hashlib.sha256(source_path.read_bytes()).hexdigest(),
        "scale": {
            "sourceScale": "0,1", "scoreScale": "500,100",
            "difficultyFormula": "500 + 100 * b",
            "methodologyUrl": METHOD_URL, "methodologyPrintedPages": [20, 21],
            "aAndBAreRaw": True,
            "note": "a, b e c preservam os parâmetros oficiais. difficultyScore é b convertido pela fórmula do INEP; não é peso, nota da questão ou nota prevista do estudante. As quatro áreas têm escalas próprias."
        },
        "limitations": [
            "O parâmetro b expressa dificuldade, não o peso ou a pontuação individual da questão; este arquivo não calcula a nota TRI de estudantes.",
            "As quatro áreas do ENEM possuem escalas próprias; comparações de dificuldade devem considerar a área oficial.",
            "A API não informa cor ou aplicação. O vínculo usa os códigos regulares azuis do dicionário oficial, todas as respostas disponíveis do caderno e a letra de cada item; evidências de conteúdo em PDF são registradas por área quando auditadas.",
            "Itens abandonados pelo INEP, respostas divergentes e idiomas não identificados com segurança ficam em unavailable, sem parâmetros estimados.",
            "CO_POSICAO muda de convenção em 2016 e 2017. As transformações explícitas estão no importador e são verificadas pelas sequências de gabarito.",
            "Os valores de b não são limitados ao intervalo de notas usuais: não são truncados nem classificados em faixas supostamente oficiais.",
            "O retrato usa os arquivos oficiais disponíveis na data da importação. URLs, ETags, datas e hashes permitem auditar futuras revisões pelo INEP."
        ],
        "questions": {}, "unavailable": {}, "years": [],
    }
    for year in years:
        codes, dictionary_file = official_regular_codes(year)
        item_file = next(p for p in (CACHE / str(year)).glob("*.csv") if "ITENS_PROVA" in p.name.upper())
        rows = list(csv.DictReader(item_file.read_text(encoding="cp1252").splitlines(), delimiter=";"))
        manifest = json.loads((CACHE / str(year) / "manifest.json").read_text())
        for member in manifest["members"]:
            source_file = ROOT / member["file"]
            if hashlib.sha256(source_file.read_bytes()).hexdigest() != member["sha256"]:
                raise ValueError(f"Cached official source hash mismatch: {source_file}")
        selected = [r for r in rows if int(r["CO_PROVA"]) == codes[r["SG_AREA"]]]
        item_lookup = collections.defaultdict(list)
        for row in selected:
            number = printed_number(year, row)
            language = official_language(year, row)
            key = f"{year}-{number}" + (f"-{language}" if language else "")
            item_lookup[key].append(row)
        year_report = {"year": year, "sourceUrl": manifest["sourceUrl"],
                       "dictionaryFile": dictionary_file, "itemFile": str(item_file.relative_to(ROOT)),
                       "sourceSha256": hashlib.sha256(item_file.read_bytes()).hexdigest(),
                       "regularBlueExamCodes": codes, "areas": {}, "matched": 0, "unavailable": 0}
        for area, code in codes.items():
            pairs = [(q, item_lookup.get(key, [])) for key, q in local.items()
                     if q["year"] == year and official_area(year, q["index"]) == area]
            comparable = [(q, r[0]) for q, r in pairs if len(r) == 1]
            matching = sum(q["correctAlternative"] == r["TX_GABARITO"] for q, r in comparable)
            content_evidence = evidence.get((year, area))
            if content_evidence:
                if (content_evidence["examCode"] != code
                        or content_evidence.get("application") != "regular"
                        or content_evidence.get("color", "").lower() != "azul"
                        or len(content_evidence.get("selections", [])) < 2):
                    raise ValueError(f"Invalid booklet evidence for {year} {area}")
                seen_numbers = set()
                for selection in content_evidence["selections"]:
                    number = selection["questionNumber"]
                    question = local.get(f"{year}-{number}")
                    source_url = urllib.parse.urlparse(selection["sourceUrl"])
                    anchor = normalized_text(selection.get("matchingText", ""))
                    if (number in seen_numbers or not question
                            or official_area(year, number) != area
                            or source_url.scheme != "https"
                            or source_url.hostname != "download.inep.gov.br"
                            or not source_url.path.lower().endswith(".pdf")
                            or not isinstance(selection.get("pdfPage"), int)
                            or selection["pdfPage"] < 1
                            or len(anchor) < 30
                            or anchor not in normalized_text(question.get("context") or "")):
                        raise ValueError(f"Invalid content anchor for {year} {area} {number}")
                    seen_numbers.add(number)
            # A color/code is never selected from a single answer or question number.
            sequence_ok = len(comparable) >= 30 and matching / len(comparable) >= 0.85
            year_report["areas"][area] = {
                "examCode": code, "color": "AZUL", "application": "regular",
                "comparableAnswers": len(comparable), "matchingAnswers": matching,
                "sequenceValidated": sequence_ok, "bookletContentEvidence": content_evidence,
            }
        for key, question in local.items():
            if question["year"] != year:
                continue
            area = official_area(year, question["index"])
            candidates = item_lookup.get(key, [])
            report = year_report["areas"][area]
            reason = None
            if not report["sequenceValidated"]:
                reason = "booklet_answer_sequence_not_confirmed"
            elif area in {"CN", "MT"} and not report["bookletContentEvidence"]:
                reason = "booklet_content_not_confirmed"
            elif len(candidates) != 1:
                reason = "ambiguous_or_missing_official_item"
            else:
                row = candidates[0]
                if row["IN_ITEM_ABAN"] != "0":
                    reason = "official_item_abandoned"
                elif row["TX_GABARITO"] != question["correctAlternative"]:
                    reason = "api_official_answer_mismatch"
                elif not all(row.get(f"NU_PARAM_{x}") for x in "ABC"):
                    reason = "official_parameters_missing"
                else:
                    a, b, c = [float(row[f"NU_PARAM_{x}"]) for x in "ABC"]
                    if not all(math.isfinite(v) for v in (a, b, c)) or a <= 0 or not 0 <= c < 1:
                        reason = "invalid_official_parameters"
            if reason:
                missing = {"year": year, "reason": reason, "area": area}
                if len(candidates) == 1:
                    missing.update({"examCode": int(candidates[0]["CO_PROVA"]),
                                    "itemCode": int(candidates[0]["CO_ITEM"]),
                                    "apiAnswer": question["correctAlternative"],
                                    "officialAnswer": candidates[0]["TX_GABARITO"],
                                    "officialAbandonmentReason": candidates[0].get("TX_MOTIVO_ABAN") or None})
                output["unavailable"][key] = missing
                year_report["unavailable"] += 1
                continue
            output["questions"][key] = {
                "a": a, "b": b, "c": c, "difficultyScore": round(500 + 100 * b, 6),
                "sourceScale": "0,1", "scoreScale": "500,100",
                "sourceUrl": manifest["sourceUrl"], "year": year, "area": area,
                "itemCode": int(row["CO_ITEM"]), "examCode": int(row["CO_PROVA"]),
                "officialPosition": int(row["CO_POSICAO"]), "questionNumber": question["index"],
                "officialAnswer": row["TX_GABARITO"], "color": "AZUL", "application": "regular",
                "language": official_language(year, row),
                "matchMethod": "official_exam_dictionary+all_available_answer_keys+individual_answer"
                    + ("+booklet_content" if report["bookletContentEvidence"] else ""),
            }
            year_report["matched"] += 1
        output["years"].append(year_report)
    output["coverage"] = {"apiQuestions": len(local), "matched": len(output["questions"]),
                          "unavailable": len(output["unavailable"]),
                          "unavailableReasons": dict(collections.Counter(x["reason"] for x in output["unavailable"].values()))}
    output["coverage"]["bookletContentVerified"] = sum("+booklet_content" in q["matchMethod"] for q in output["questions"].values())
    destination = ROOT / "data/reference/tri-parameters.json"
    temporary = destination.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(destination)
    print(json.dumps(output["coverage"], ensure_ascii=False))
    for year in output["years"]:
        print(year["year"], year["matched"], year["unavailable"], year["regularBlueExamCodes"])
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fetch", action="store_true")
    parser.add_argument("--years", nargs="*", type=int, choices=range(2009, 2024), default=list(range(2009, 2024)))
    parser.add_argument("--import-cached", action="store_true")
    args = parser.parse_args()
    if args.fetch:
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(fetch_year, args.years))
    if args.import_cached:
        import_cached(args.years)


if __name__ == "__main__":
    main()
