# Pipeline de dados do mercado hospitalar

## Objetivo

Atualizar o dashboard com produção assistencial, estrutura instalada, beneficiários e indicadores municipais para Santa Cruz do Sul, Porto Alegre e Caxias do Sul.

## Arquitetura

1. GitHub Actions agenda e executa o ETL.
2. Python valida e normaliza os dados.
3. Neon PostgreSQL armazena fatos, dimensões e indicadores.
4. Vercel consulta apenas tabelas analíticas e materialized views.

## Configuração inicial

1. Criar um banco PostgreSQL no Neon.
2. Executar `database/hospital_market_schema.sql`.
3. Adicionar o secret `DATABASE_URL` no repositório GitHub.
4. Executar manualmente o workflow `Hospital market ETL` em modo `dry_run`.
5. Após validar o arquivo normalizado, executar com `dry_run=false`.

## Formato mínimo da produção

O CSV de entrada precisa conter:

- `competencia`
- `codigo_municipio_atendimento`
- `codigo_sigtap`
- `quantidade_aprovada`

Campos opcionais:

- `codigo_municipio_residencia`
- `cnes`
- `valor_aprovado`
- `tipo_atendimento`

## Municípios da primeira fase

- Santa Cruz do Sul: `4316808`
- Porto Alegre: `4314902`
- Caxias do Sul: `4305108`

## Estado atual

Esta primeira versão cria a infraestrutura, valida arquivos normalizados e permite carga no banco. A etapa seguinte é implementar os coletores das fontes oficiais SIA, SIH, CNES e ANS e substituir o arquivo de exemplo por downloads automáticos.
