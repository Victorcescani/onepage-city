# Pipeline de dados do mercado hospitalar

## Objetivo

Atualizar o dashboard com produção assistencial, beneficiários e indicadores municipais para Santa Cruz do Sul, Porto Alegre e Caxias do Sul.

## Arquitetura

1. GitHub Actions agenda e executa o ETL.
2. `etl/collect_official_sources.py` baixa e converte arquivos DBC oficiais.
3. `etl/run_hospital_market_pipeline.py` valida, padroniza e grava no Neon.
4. Vercel consulta apenas tabelas analíticas e materialized views.

## Fontes implementadas

- SIA/SUS: arquivo `PARS<AA><MM>.dbc` no diretório oficial de disseminação do DATASUS.
- SIH/SUS: arquivo `RDRS<AA><MM>.dbc` no diretório oficial de disseminação do DATASUS.
- ANS: arquivo municipal `tb_bb_<AAAA>-<MM>.dbc` no portal de dados abertos.

O coletor trata ausência de publicação como condição esperada. Quando uma fonte ainda não disponibilizou a competência, as demais podem continuar.

## Configuração inicial

1. Criar um banco PostgreSQL no Neon.
2. Executar `database/hospital_market_schema.sql`.
3. Adicionar o secret `DATABASE_URL` no repositório GitHub.
4. Executar manualmente o workflow `Hospital market ETL` com `dry_run=true`.
5. Informar uma competência no formato `AAAA-MM` ou deixar vazio para usar a defasagem segura padrão.
6. Após validar o artefato normalizado, executar com `dry_run=false`.

## Execução local

```bash
pip install -r requirements-etl.txt
python etl/collect_official_sources.py --source ALL --competence 2025-12
python etl/run_hospital_market_pipeline.py --source SIA --input data/hospital-market/normalized/sia/sia_202512.csv.gz --dry-run
```

## Reprocessamento e idempotência

As cargas são substituídas por fonte e competência. Isso permite reprocessar arquivos corrigidos pelo DATASUS ou pela ANS sem duplicar registros. Cada execução registra fonte, competência, arquivo, hash, quantidade de linhas, versão do pipeline e status em `controle_cargas`.

## Municípios da primeira fase

- Santa Cruz do Sul: `4316808`
- Porto Alegre: `4314902`
- Caxias do Sul: `4305108`

## Agenda

O workflow roda no dia 12 de cada mês às 05:17 UTC. A execução automática usa uma competência fechada com defasagem conservadora de quatro meses. O operador pode informar uma competência específica na execução manual.

## Pendência CNES

A estrutura de banco para capacidade instalada já existe. A coleta automática do CNES permanece separada porque o portal oficial apresentou instabilidade recente nos downloads e existem múltiplos formatos de disseminação. A implementação deverá priorizar uma fonte oficial estável e validar os layouts de estabelecimentos, leitos e equipamentos antes da carga produtiva.
