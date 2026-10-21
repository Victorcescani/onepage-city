#!/usr/bin/env Rscript

args <- commandArgs(trailingOnly = TRUE)
uf <- if (length(args) >= 1 && nzchar(args[1])) toupper(args[1]) else "RS"
forced_comp <- if (length(args) >= 2 && nzchar(args[2])) args[2] else ""

if (!uf %in% c("RS", "SC")) stop("UF não suportada")
if (nzchar(forced_comp) && !grepl("^[0-9]{4}(0[1-9]|1[0-2])$", forced_comp)) stop("Competência inválida")

if (!requireNamespace("read.dbc", quietly = TRUE)) stop("Pacote read.dbc não instalado")
if (!requireNamespace("jsonlite", quietly = TRUE)) stop("Pacote jsonlite não instalado")
if (!requireNamespace("curl", quietly = TRUE)) stop("Pacote curl não instalado")

source_base <- "ftp://ftp.datasus.gov.br/dissemin/publicos/CNES/200508_/Dados/PF"

candidate_competences <- function() {
  if (nzchar(forced_comp)) return(forced_comp)
  now <- as.Date(format(Sys.Date(), "%Y-%m-01"))
  dates <- seq(now, by = "-1 month", length.out = 8)
  format(dates, "%Y%m")
}

download_cnes_pf <- function(comp) {
  yy_mm <- paste0(substr(comp, 3, 4), substr(comp, 5, 6))
  name <- paste0("PF", uf, yy_mm, ".DBC")
  url <- paste(source_base, name, sep = "/")
  dest <- file.path(tempdir(), name)
  message("Tentando ", url)
  ok <- tryCatch({
    curl::curl_download(url, destfile = dest, mode = "wb", quiet = FALSE)
    file.exists(dest) && file.info(dest)$size > 0
  }, error = function(e) {
    message("Falha: ", conditionMessage(e))
    FALSE
  })
  if (ok) list(path = dest, comp = comp, url = url) else NULL
}

downloaded <- NULL
for (comp in candidate_competences()) {
  downloaded <- download_cnes_pf(comp)
  if (!is.null(downloaded)) break
}
if (is.null(downloaded)) stop("Nenhum arquivo CNES-PF disponível nas competências testadas.")

message("Lendo ", downloaded$path)
df <- read.dbc::read.dbc(downloaded$path)
names(df) <- toupper(names(df))

required <- c("CODUFMUN", "CBO")
missing_required <- setdiff(required, names(df))
if (length(missing_required)) stop("Campos ausentes: ", paste(missing_required, collapse = ", "))

if (!"CNS_PROF" %in% names(df)) stop("Campo CNS_PROF ausente; não é possível deduplicar com a metodologia definida.")
id_col <- "CNS_PROF"

df$CODUFMUN <- trimws(as.character(df$CODUFMUN))
df$CBO <- trimws(as.character(df$CBO))
df$PROF_ID <- trimws(as.character(df[[id_col]]))

med <- df[
  !is.na(df$CBO) & grepl("^225[0-9]{3}$", df$CBO) &
    !is.na(df$CODUFMUN) & grepl("^[0-9]{6}$", df$CODUFMUN) &
    !is.na(df$PROF_ID) & nzchar(df$PROF_ID) & !grepl("^0+$", df$PROF_ID),
  c("CODUFMUN", "CBO", "PROF_ID"),
  drop = FALSE
]

if (!nrow(med)) stop("Arquivo lido, mas nenhum médico CBO 225* foi encontrado.")

# Remove duplicidade do mesmo profissional na mesma especialidade e município.
med_spec <- unique(med[c("CODUFMUN", "CBO", "PROF_ID")])

# Tabela CBO para rótulos. Falha de rótulo não bloqueia a base.
cbo_labels <- data.frame(cod = character(), nome = character(), stringsAsFactors = FALSE)
try({
  cbo_url <- "https://raw.githubusercontent.com/rfsaldanha/microdatasus/master/data-raw/tabCBO.csv"
  cbo_labels <- utils::read.csv2(cbo_url, stringsAsFactors = FALSE, fileEncoding = "UTF-8")
  names(cbo_labels) <- tolower(names(cbo_labels))
  cbo_labels$cod <- sprintf("%06s", trimws(as.character(cbo_labels$cod)))
}, silent = TRUE)

label_map <- setNames(cbo_labels$nome, cbo_labels$cod)

cities <- list()
municipios <- sort(unique(med_spec$CODUFMUN))
for (mun in municipios) {
  x <- med_spec[med_spec$CODUFMUN == mun, , drop = FALSE]
  total <- length(unique(x$PROF_ID))
  by_cbo <- aggregate(PROF_ID ~ CBO, data = x, FUN = function(v) length(unique(v)))
  names(by_cbo)[2] <- "medicos"
  by_cbo <- by_cbo[order(-by_cbo$medicos, by_cbo$CBO), , drop = FALSE]

  especialidades <- lapply(seq_len(nrow(by_cbo)), function(i) {
    code <- as.character(by_cbo$CBO[i])
    label <- unname(label_map[code])
    if (is.na(label) || !nzchar(label)) label <- paste("CBO", code)
    list(
      cbo = code,
      especialidade = toupper(iconv(label, from = "", to = "UTF-8", sub = "")),
      medicos = as.integer(by_cbo$medicos[i])
    )
  })

  cities[[mun]] <- list(
    total = as.integer(total),
    especialidades = especialidades
  )
}

out <- list(
  comp = downloaded$comp,
  uf = uf,
  source = "CNES/DATASUS CNES-PF",
  source_file = basename(downloaded$path),
  identifier = id_col,
  rule = "CBO iniciado em 225; profissionais unicos por CNS/identificador do CNES",
  generated_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
  cities = cities
)

dir.create("data", showWarnings = FALSE, recursive = TRUE)
out_file <- file.path("data", paste0("cnes_medicos_", uf, ".json"))
jsonlite::write_json(out, out_file, auto_unbox = TRUE, pretty = FALSE, na = "null")
message("Gerado: ", out_file)
message("Competência: ", downloaded$comp)
message("Municípios: ", length(cities))
message("Registros médicos deduplicados por município/CBO: ", nrow(med_spec))
