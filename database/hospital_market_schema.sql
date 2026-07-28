CREATE TABLE IF NOT EXISTS controle_cargas (
  id BIGSERIAL PRIMARY KEY,
  fonte TEXT NOT NULL,
  competencia DATE,
  arquivo TEXT,
  hash_arquivo TEXT,
  data_download TIMESTAMPTZ,
  data_processamento TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  quantidade_registros BIGINT,
  status TEXT NOT NULL CHECK (status IN ('iniciado','sucesso','erro','ignorado')),
  mensagem_erro TEXT,
  versao_pipeline TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_controle_cargas_fonte_competencia_arquivo
ON controle_cargas (fonte, competencia, COALESCE(arquivo, ''));

CREATE TABLE IF NOT EXISTS dim_municipio (
  codigo_ibge CHAR(7) PRIMARY KEY,
  nome TEXT NOT NULL,
  uf CHAR(2) NOT NULL,
  regiao_saude TEXT,
  populacao INTEGER,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dim_estabelecimento (
  cnes CHAR(7) PRIMARY KEY,
  nome TEXT NOT NULL,
  codigo_ibge CHAR(7) REFERENCES dim_municipio(codigo_ibge),
  tipo_unidade TEXT,
  natureza_juridica TEXT,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dim_procedimento (
  codigo_sigtap CHAR(10) PRIMARY KEY,
  descricao TEXT NOT NULL,
  grupo_gerencial TEXT NOT NULL,
  modelo_assistencial TEXT,
  driver_estrutural TEXT,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fact_producao (
  id BIGSERIAL PRIMARY KEY,
  competencia DATE NOT NULL,
  fonte TEXT NOT NULL,
  codigo_municipio_residencia CHAR(7),
  codigo_municipio_atendimento CHAR(7) NOT NULL,
  cnes CHAR(7),
  codigo_sigtap CHAR(10) NOT NULL,
  quantidade_aprovada NUMERIC(18,2) NOT NULL DEFAULT 0,
  valor_aprovado NUMERIC(18,2) NOT NULL DEFAULT 0,
  tipo_atendimento TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_fact_producao_competencia ON fact_producao (competencia);
CREATE INDEX IF NOT EXISTS ix_fact_producao_municipio_atendimento ON fact_producao (codigo_municipio_atendimento);
CREATE INDEX IF NOT EXISTS ix_fact_producao_municipio_residencia ON fact_producao (codigo_municipio_residencia);
CREATE INDEX IF NOT EXISTS ix_fact_producao_procedimento ON fact_producao (codigo_sigtap);

CREATE TABLE IF NOT EXISTS fact_beneficiarios (
  competencia DATE NOT NULL,
  codigo_ibge CHAR(7) NOT NULL,
  tipo_contratacao TEXT NOT NULL,
  faixa_etaria TEXT NOT NULL DEFAULT '',
  sexo TEXT NOT NULL DEFAULT '',
  quantidade INTEGER NOT NULL,
  PRIMARY KEY (competencia, codigo_ibge, tipo_contratacao, faixa_etaria, sexo)
);

CREATE TABLE IF NOT EXISTS fact_estrutura (
  competencia DATE NOT NULL,
  cnes CHAR(7) NOT NULL,
  leitos_totais INTEGER NOT NULL DEFAULT 0,
  leitos_sus INTEGER NOT NULL DEFAULT 0,
  leitos_nao_sus INTEGER NOT NULL DEFAULT 0,
  salas_cirurgicas INTEGER NOT NULL DEFAULT 0,
  salas_endoscopia INTEGER NOT NULL DEFAULT 0,
  tomografos INTEGER NOT NULL DEFAULT 0,
  ressonancias INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (competencia, cnes)
);

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_producao_municipal_mensal AS
SELECT
  p.competencia,
  p.codigo_municipio_atendimento,
  d.grupo_gerencial,
  SUM(p.quantidade_aprovada) AS producao,
  SUM(p.valor_aprovado) AS valor_aprovado
FROM fact_producao p
JOIN dim_procedimento d ON d.codigo_sigtap = p.codigo_sigtap
GROUP BY 1,2,3;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_producao_municipal_mensal
ON mv_producao_municipal_mensal (competencia, codigo_municipio_atendimento, grupo_gerencial);
