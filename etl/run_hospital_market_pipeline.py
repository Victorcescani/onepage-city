from __future__ import annotations

import argparse
import hashlib
import logging
import os
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Iterable

import pandas as pd
import psycopg

PIPELINE_VERSION = "0.2.0"
MUNICIPALITY_MAP = {
    "431680": "4316808",
    "431490": "4314902",
    "430510": "4305108",
}
TARGET_MUNICIPALITIES = set(MUNICIPALITY_MAP.values())


@dataclass(frozen=True)
class LoadResult:
    source: str
    competence: date | None
    file_name: str
    rows: int
    sha256: str


def configure_logging() -> None:
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def connect() -> psycopg.Connection:
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL não configurada")
    return psycopg.connect(database_url)


def read_csv(path: Path) -> pd.DataFrame:
    return pd.read_csv(path, dtype=str, compression="infer")


def municipality_7(value: object) -> str:
    text = str(value or "").replace(".0", "").strip()
    if len(text) == 6:
        return MUNICIPALITY_MAP.get(text, text)
    return text.zfill(7)


def register_load(conn: psycopg.Connection, result: LoadResult, status: str, error: str | None = None) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO controle_cargas (
              fonte, competencia, arquivo, hash_arquivo, data_download,
              quantidade_registros, status, mensagem_erro, versao_pipeline
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (fonte, competencia, (COALESCE(arquivo, '')))
            DO UPDATE SET hash_arquivo=EXCLUDED.hash_arquivo,
              data_download=EXCLUDED.data_download, data_processamento=NOW(),
              quantidade_registros=EXCLUDED.quantidade_registros,
              status=EXCLUDED.status, mensagem_erro=EXCLUDED.mensagem_erro,
              versao_pipeline=EXCLUDED.versao_pipeline
            """,
            (result.source, result.competence, result.file_name, result.sha256,
             datetime.now(timezone.utc), result.rows, status, error, PIPELINE_VERSION),
        )
    conn.commit()


def ensure_text(frame: pd.DataFrame, column: str, default: str = "") -> pd.Series:
    if column not in frame.columns:
        return pd.Series(default, index=frame.index, dtype="string")
    return frame[column].fillna(default).astype("string")


def normalize_production(frame: pd.DataFrame, source: str) -> pd.DataFrame:
    required = {"competencia", "codigo_municipio_atendimento", "codigo_sigtap", "quantidade_aprovada"}
    missing = required.difference(frame.columns)
    if missing:
        raise ValueError(f"Colunas obrigatórias ausentes: {sorted(missing)}")
    result = frame.copy()
    result["fonte"] = source
    result["competencia"] = pd.to_datetime(result["competencia"], errors="raise").dt.date
    result["codigo_municipio_atendimento"] = result["codigo_municipio_atendimento"].map(municipality_7)
    result["codigo_municipio_residencia"] = ensure_text(result, "codigo_municipio_residencia").map(municipality_7)
    result["codigo_sigtap"] = result["codigo_sigtap"].str.replace(r"\.0$", "", regex=True).str.zfill(10)
    result["cnes"] = ensure_text(result, "cnes").str.replace(r"\.0$", "", regex=True).str.zfill(7)
    result["quantidade_aprovada"] = pd.to_numeric(result["quantidade_aprovada"], errors="coerce").fillna(0)
    result["valor_aprovado"] = pd.to_numeric(ensure_text(result, "valor_aprovado", "0"), errors="coerce").fillna(0)
    result["tipo_atendimento"] = ensure_text(result, "tipo_atendimento")
    result = result[result["codigo_municipio_atendimento"].isin(TARGET_MUNICIPALITIES)]
    return result[["competencia", "fonte", "codigo_municipio_residencia", "codigo_municipio_atendimento", "cnes", "codigo_sigtap", "quantidade_aprovada", "valor_aprovado", "tipo_atendimento"]]


def normalize_ans(frame: pd.DataFrame) -> pd.DataFrame:
    required = {"competencia", "codigo_ibge", "tipo_contratacao", "quantidade"}
    missing = required.difference(frame.columns)
    if missing:
        raise ValueError(f"Colunas obrigatórias ausentes: {sorted(missing)}")
    result = frame.copy()
    result["competencia"] = pd.to_datetime(result["competencia"], errors="raise").dt.date
    result["codigo_ibge"] = result["codigo_ibge"].map(municipality_7)
    result["tipo_contratacao"] = ensure_text(result, "tipo_contratacao", "NÃO INFORMADO")
    result["faixa_etaria"] = ensure_text(result, "faixa_etaria")
    result["sexo"] = ensure_text(result, "sexo")
    result["quantidade"] = pd.to_numeric(result["quantidade"], errors="coerce").fillna(0).astype(int)
    return result[result["codigo_ibge"].isin(TARGET_MUNICIPALITIES)][["competencia", "codigo_ibge", "tipo_contratacao", "faixa_etaria", "sexo", "quantidade"]]


def load_production(conn: psycopg.Connection | None, path: Path, source: str, dry_run: bool) -> LoadResult:
    normalized = normalize_production(read_csv(path), source)
    competence = normalized["competencia"].min() if not normalized.empty else None
    result = LoadResult(source, competence, path.name, len(normalized), sha256_file(path))
    if dry_run:
        return result
    if conn is None or competence is None:
        raise RuntimeError("conexão ou competência ausente")
    rows: Iterable[tuple] = normalized.itertuples(index=False, name=None)
    with conn.cursor() as cur:
        cur.execute("DELETE FROM fact_producao WHERE fonte=%s AND competencia=%s", (source, competence))
        cur.executemany("""
            INSERT INTO fact_producao (competencia, fonte, codigo_municipio_residencia,
              codigo_municipio_atendimento, cnes, codigo_sigtap,
              quantidade_aprovada, valor_aprovado, tipo_atendimento)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """, rows)
        cur.execute("REFRESH MATERIALIZED VIEW mv_producao_municipal_mensal")
    conn.commit()
    return result


def load_ans(conn: psycopg.Connection | None, path: Path, dry_run: bool) -> LoadResult:
    normalized = normalize_ans(read_csv(path))
    competence = normalized["competencia"].min() if not normalized.empty else None
    result = LoadResult("ANS", competence, path.name, len(normalized), sha256_file(path))
    if dry_run:
        return result
    if conn is None or competence is None:
        raise RuntimeError("conexão ou competência ausente")
    with conn.cursor() as cur:
        cur.execute("DELETE FROM fact_beneficiarios WHERE competencia=%s", (competence,))
        cur.executemany("""
            INSERT INTO fact_beneficiarios
              (competencia, codigo_ibge, tipo_contratacao, faixa_etaria, sexo, quantidade)
            VALUES (%s,%s,%s,%s,%s,%s)
        """, normalized.itertuples(index=False, name=None))
    conn.commit()
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Carga do Radar de Mercado Hospitalar")
    parser.add_argument("--source", choices=["SIA", "SIH", "ANS"], required=True)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    configure_logging()
    if not args.input.exists():
        raise FileNotFoundError(args.input)
    loader = (lambda conn: load_ans(conn, args.input, args.dry_run)) if args.source == "ANS" else (lambda conn: load_production(conn, args.input, args.source, args.dry_run))
    if args.dry_run:
        result = loader(None)
        logging.info("Validação concluída: %s", result)
        return
    with connect() as conn:
        try:
            result = loader(conn)
            register_load(conn, result, "sucesso")
            logging.info("Carga concluída: %s", result)
        except Exception as exc:
            fallback = LoadResult(args.source, None, args.input.name, 0, sha256_file(args.input))
            register_load(conn, fallback, "erro", str(exc))
            raise


if __name__ == "__main__":
    main()
