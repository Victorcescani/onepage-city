from __future__ import annotations

import argparse
import logging
import os
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Iterable

import pandas as pd
import requests
from dateutil.relativedelta import relativedelta
from pyreaddbc import read_dbc

DATASUS_SIA_BASE = "https://ftp.datasus.gov.br/dissemin/publicos/SIASUS/200801_/Dados"
DATASUS_SIH_BASE = "https://ftp.datasus.gov.br/dissemin/publicos/SIHSUS/200801_/Dados"
ANS_BENEFICIARIOS_BASE = "https://dadosabertos.ans.gov.br/FTP/Base_de_dados/Microdados/dados_dbc/beneficiarios/municipios"

TARGET_MUNICIPALITIES = {"4316808", "4314902", "4305108"}
UF = "RS"


@dataclass(frozen=True)
class DownloadSpec:
    source: str
    competence: date
    url: str
    destination: Path


def month_start(value: str) -> date:
    if not re.fullmatch(r"\d{4}-\d{2}", value):
        raise argparse.ArgumentTypeError("competência deve usar AAAA-MM")
    return date.fromisoformat(value + "-01")


def latest_closed_month(lag_months: int = 4) -> date:
    return date.today().replace(day=1) - relativedelta(months=lag_months)


def download(spec: DownloadSpec, timeout: int = 180) -> Path:
    spec.destination.parent.mkdir(parents=True, exist_ok=True)
    if spec.destination.exists() and spec.destination.stat().st_size > 0:
        logging.info("Arquivo já disponível: %s", spec.destination)
        return spec.destination

    logging.info("Baixando %s", spec.url)
    with requests.get(spec.url, stream=True, timeout=timeout) as response:
        if response.status_code == 404:
            raise FileNotFoundError(f"arquivo ainda não publicado: {spec.url}")
        response.raise_for_status()
        temporary = spec.destination.with_suffix(spec.destination.suffix + ".part")
        with temporary.open("wb") as output:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    output.write(chunk)
        temporary.replace(spec.destination)
    return spec.destination


def read_frame(path: Path) -> pd.DataFrame:
    frame = read_dbc(str(path), encoding="iso-8859-1")
    frame.columns = [str(column).strip().upper() for column in frame.columns]
    return frame


def first_existing(frame: pd.DataFrame, candidates: Iterable[str], default: object = "") -> pd.Series:
    for name in candidates:
        if name in frame.columns:
            return frame[name]
    return pd.Series([default] * len(frame), index=frame.index)


def normalize_code(series: pd.Series, width: int) -> pd.Series:
    return series.fillna("").astype(str).str.replace(r"\.0$", "", regex=True).str.strip().str.zfill(width)


def normalize_sia(frame: pd.DataFrame, competence: date) -> pd.DataFrame:
    municipality = normalize_code(first_existing(frame, ["PA_UFMUN", "PA_MUNPCN"]), 6)
    result = pd.DataFrame({
        "competencia": competence.isoformat(),
        "codigo_municipio_residencia": normalize_code(first_existing(frame, ["PA_MUNPCN", "PA_MUNRES"]), 6),
        "codigo_municipio_atendimento": municipality,
        "cnes": normalize_code(first_existing(frame, ["PA_CODUNI"]), 7),
        "codigo_sigtap": normalize_code(first_existing(frame, ["PA_PROC_ID"]), 10),
        "quantidade_aprovada": pd.to_numeric(first_existing(frame, ["PA_QTDAPR"], 0), errors="coerce").fillna(0),
        "valor_aprovado": pd.to_numeric(first_existing(frame, ["PA_VALAPR", "PA_VALPRO"], 0), errors="coerce").fillna(0),
        "tipo_atendimento": "AMBULATORIAL",
    })
    return filter_target_municipalities(result)


def normalize_sih(frame: pd.DataFrame, competence: date) -> pd.DataFrame:
    result = pd.DataFrame({
        "competencia": competence.isoformat(),
        "codigo_municipio_residencia": normalize_code(first_existing(frame, ["MUNIC_RES"]), 6),
        "codigo_municipio_atendimento": normalize_code(first_existing(frame, ["MUNIC_MOV"]), 6),
        "cnes": normalize_code(first_existing(frame, ["CNES"]), 7),
        "codigo_sigtap": normalize_code(first_existing(frame, ["PROC_REA", "PROC_SOLIC"]), 10),
        "quantidade_aprovada": 1,
        "valor_aprovado": pd.to_numeric(first_existing(frame, ["VAL_TOT", "VAL_SH"], 0), errors="coerce").fillna(0),
        "tipo_atendimento": "HOSPITALAR",
    })
    return filter_target_municipalities(result)


def filter_target_municipalities(frame: pd.DataFrame) -> pd.DataFrame:
    # Arquivos DATASUS usam frequentemente código IBGE de 6 dígitos sem o verificador.
    targets6 = {code[:6] for code in TARGET_MUNICIPALITIES}
    return frame[frame["codigo_municipio_atendimento"].isin(targets6)].copy()


def normalize_ans(frame: pd.DataFrame, competence: date) -> pd.DataFrame:
    municipality = normalize_code(first_existing(frame, ["CD_MUNICIPIO", "CO_MUNICIPIO", "CD_MUN"]), 6)
    quantity = pd.to_numeric(first_existing(frame, ["QT_BENEFICIARIO_ATIVO", "QT_BENEFICIARIOS", "QT_VINCULOS"], 0), errors="coerce").fillna(0)
    result = pd.DataFrame({
        "competencia": competence.isoformat(),
        "codigo_ibge": municipality,
        "tipo_contratacao": first_existing(frame, ["DE_CONTRATACAO_PLANO", "NM_CONTRATACAO", "MODALIDADE_CONTRATACAO"], "NÃO INFORMADO").fillna("NÃO INFORMADO"),
        "faixa_etaria": first_existing(frame, ["DE_FAIXA_ETARIA", "NM_FAIXA_ETARIA"], "").fillna(""),
        "sexo": first_existing(frame, ["SG_SEXO", "SEXO"], "").fillna(""),
        "quantidade": quantity.astype(int),
    })
    targets6 = {code[:6] for code in TARGET_MUNICIPALITIES}
    return result[result["codigo_ibge"].isin(targets6)].copy()


def build_spec(source: str, competence: date, workdir: Path) -> DownloadSpec:
    yy = str(competence.year)[2:]
    mm = f"{competence.month:02d}"
    if source == "SIA":
        filename = f"PARS{yy}{mm}.dbc"
        url = f"{DATASUS_SIA_BASE}/{filename}"
    elif source == "SIH":
        filename = f"RDRS{yy}{mm}.dbc"
        url = f"{DATASUS_SIH_BASE}/{filename}"
    elif source == "ANS":
        filename = f"tb_bb_{competence.year}-{mm}.dbc"
        url = f"{ANS_BENEFICIARIOS_BASE}/{filename}"
    else:
        raise ValueError(source)
    return DownloadSpec(source, competence, url, workdir / "raw" / source.lower() / filename)


def collect(source: str, competence: date, workdir: Path) -> Path:
    spec = build_spec(source, competence, workdir)
    path = download(spec)
    frame = read_frame(path)
    if source == "SIA":
        normalized = normalize_sia(frame, competence)
    elif source == "SIH":
        normalized = normalize_sih(frame, competence)
    else:
        normalized = normalize_ans(frame, competence)

    destination = workdir / "normalized" / source.lower() / f"{source.lower()}_{competence:%Y%m}.csv.gz"
    destination.parent.mkdir(parents=True, exist_ok=True)
    normalized.to_csv(destination, index=False, compression="gzip")
    logging.info("%s: %s registros gravados em %s", source, len(normalized), destination)
    return destination


def main() -> None:
    parser = argparse.ArgumentParser(description="Coleta fontes oficiais para o Radar de Mercado Hospitalar")
    parser.add_argument("--source", choices=["SIA", "SIH", "ANS", "ALL"], default="ALL")
    parser.add_argument("--competence", type=month_start, default=None)
    parser.add_argument("--workdir", type=Path, default=Path("data/hospital-market"))
    args = parser.parse_args()

    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
    competence = args.competence or latest_closed_month()
    sources = ["SIA", "SIH", "ANS"] if args.source == "ALL" else [args.source]
    failures: list[str] = []
    for source in sources:
        try:
            collect(source, competence, args.workdir)
        except FileNotFoundError as exc:
            logging.warning("%s", exc)
            failures.append(source)
    if len(failures) == len(sources):
        raise RuntimeError(f"nenhuma fonte publicada para {competence:%Y-%m}: {failures}")


if __name__ == "__main__":
    main()
