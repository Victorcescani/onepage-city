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

PIPELINE_VERSION = "0.1.1"
TARGET_MUNICIPALITIES = {
    "4316808": "Santa Cruz do Sul",
    "4314902": "Porto Alegre",
    "4305108": "Caxias do Sul",
}


@dataclass(frozen=True)
class LoadResult:
    source: str
    competence: date | None
    file_name: str
    rows: int
    sha256: str


def configure_logging() -> None:
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(message)s",
    )


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


def register_load(conn: psycopg.Connection, result: LoadResult, status: str, error: str | None = None) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO controle_cargas (
              fonte, competencia, arquivo, hash_arquivo, data_download,
              quantidade_registros, status, mensagem_erro, versao_pipeline
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (fonte, competencia, COALESCE(arquivo, ''))
            DO UPDATE SET
              hash_arquivo = EXCLUDED.hash_arquivo,
              data_download = EXCLUDED.data_download,
              data_processamento = NOW(),
              quantidade_registros = EXCLUDED.quantidade_registros,
              status = EXCLUDED.status,
              mensagem_erro = EXCLUDED.mensagem_erro,
              versao_pipeline = EXCLUDED.versao_pipeline
            """,
            (
                result.source,
                result.competence,
                result.file_name,
                result.sha256,
                datetime.now(timezone.utc),
                result.rows,
                status,
                error,
                PIPELINE_VERSION,
            ),
        )
    conn.commit()


def ensure_text_column(frame: pd.DataFrame, column: str, default: str = "") -> pd.Series:
    if column not in frame.columns:
        return pd.Series(default, index=frame.index, dtype="string")
    return frame[column].fillna(default).astype("string")


def normalize_production(frame: pd.DataFrame, source: str) -> pd.DataFrame:
    required = {
        "competencia",
        "codigo_municipio_atendimento",
        "codigo_sigtap",
        "quantidade_aprovada",
    }
    missing = required.difference(frame.columns)
    if missing:
        raise ValueError(f"Colunas obrigatórias ausentes: {sorted(missing)}")

    result = frame.copy()
    result["fonte"] = source
    result["competencia"] = pd.to_datetime(result["competencia"], errors="raise").dt.date
    result["codigo_municipio_atendimento"] = result["codigo_municipio_atendimento"].astype("string").str.zfill(7)
    result["codigo_municipio_residencia"] = ensure_text_column(result, "codigo_municipio_residencia").str.zfill(7)
    result["codigo_sigtap"] = result["codigo_sigtap"].astype("string").str.zfill(10)
    result["cnes"] = ensure_text_column(result, "cnes").str.zfill(7)
    result["quantidade_aprovada"] = pd.to_numeric(result["quantidade_aprovada"], errors="coerce").fillna(0)
    valor = ensure_text_column(result, "valor_aprovado", "0")
    result["valor_aprovado"] = pd.to_numeric(valor, errors="coerce").fillna(0)
    result["tipo_atendimento"] = ensure_text_column(result, "tipo_atendimento")

    result = result[result["codigo_municipio_atendimento"].isin(TARGET_MUNICIPALITIES)]
    return result[
        [
            "competencia",
            "fonte",
            "codigo_municipio_residencia",
            "codigo_municipio_atendimento",
            "cnes",
            "codigo_sigtap",
            "quantidade_aprovada",
            "valor_aprovado",
            "tipo_atendimento",
        ]
    ]


def load_production_csv(conn: psycopg.Connection | None, path: Path, source: str, dry_run: bool) -> LoadResult:
    frame = pd.read_csv(path, dtype=str)
    normalized = normalize_production(frame, source)
    competence = normalized["competencia"].min() if not normalized.empty else None
    result = LoadResult(source, competence, path.name, len(normalized), sha256_file(path))

    if dry_run:
        logging.info("Dry-run: %s linhas válidas em %s", result.rows, path)
        return result
    if conn is None:
        raise RuntimeError("Conexão com banco ausente")

    rows: Iterable[tuple] = normalized.itertuples(index=False, name=None)
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO fact_producao (
              competencia, fonte, codigo_municipio_residencia,
              codigo_municipio_atendimento, cnes, codigo_sigtap,
              quantidade_aprovada, valor_aprovado, tipo_atendimento
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            rows,
        )
        cur.execute("REFRESH MATERIALIZED VIEW mv_producao_municipal_mensal")
    conn.commit()
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Pipeline inicial do Radar de Mercado Hospitalar")
    parser.add_argument("--source", choices=["SIA", "SIH"], required=True)
    parser.add_argument("--input", type=Path, required=True, help="CSV normalizado de entrada")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    configure_logging()
    if not args.input.exists():
        raise FileNotFoundError(args.input)

    if args.dry_run:
        result = load_production_csv(None, args.input, args.source, True)
        logging.info("Validação concluída: %s", result)
        return

    with connect() as conn:
        try:
            result = load_production_csv(conn, args.input, args.source, False)
            register_load(conn, result, "sucesso")
            logging.info("Carga concluída: %s", result)
        except Exception as exc:
            fallback = LoadResult(args.source, None, args.input.name, 0, sha256_file(args.input))
            register_load(conn, fallback, "erro", str(exc))
            raise


if __name__ == "__main__":
    main()
