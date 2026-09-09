// Helpers ANS — lê JSONs pré-processados de /data
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Em serverless Vercel, process.cwd() é a raiz do projeto
const DATA_DIR = path.join(process.cwd(), "data");
const RELEASE_DIR = path.join(DATA_DIR, "ans", "releases");

// Cache em memória por instância de função (ajuda em invocações seguidas)
const memCache = new Map();
const pointerCache = new Map();

function loadMonth(uf, ym) {
  const key = `${uf}_${ym}`;
  if (memCache.has(key)) return memCache.get(key);
  const file = path.join(DATA_DIR, `ans_${uf}_${ym}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    memCache.set(key, data);
    return data;
  } catch {
    return null;
  }
}

function readReleasePointer(fileName) {
  if (pointerCache.has(fileName)) return pointerCache.get(fileName);

  const file = path.join(RELEASE_DIR, fileName);
  if (!fs.existsSync(file)) {
    pointerCache.set(fileName, null);
    return null;
  }

  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    pointerCache.set(fileName, value);
    return value;
  } catch {
    pointerCache.set(fileName, null);
    return null;
  }
}

function normalizeCompetence(value) {
  const ym = String(value || "").replace(/-/g, "");
  return /^\d{6}$/.test(ym) ? ym : null;
}

function releaseMonthForUF(uf) {
  const branch = String(process.env.VERCEL_GIT_COMMIT_REF || "");
  const isCandidatePreview = branch === "onepage-ans-candidate";
  const pointer = readReleasePointer(isCandidatePreview ? "candidate.json" : "approved.json");
  const competence = normalizeCompetence(pointer?.competence);
  const ufs = Array.isArray(pointer?.ufs) ? pointer.ufs.map(value => String(value).toUpperCase()) : [];

  if (!competence) return null;
  if (ufs.length && !ufs.includes(String(uf).toUpperCase())) return null;
  if (!fs.existsSync(path.join(DATA_DIR, `ans_${uf}_${competence}.json`))) return null;

  return competence;
}

// Lista meses disponíveis para um UF.
export function listMonthsForUF(uf) {
  try {
    const files = fs.readdirSync(DATA_DIR);
    const rx = new RegExp(`^ans_${uf}_(\\d{6})\\.json$`);
    const months = [];
    for (const f of files) {
      const m = f.match(rx);
      if (m) months.push(m[1]);
    }
    return months.sort();
  } catch {
    return [];
  }
}

// Competência publicada. Produção usa o ponteiro aprovado; a branch de
// homologação usa a candidata. Se os metadados ainda não existirem, mantém
// compatibilidade com a lógica antiga e escolhe o arquivo mais recente.
export function latestMonth(uf) {
  const pinned = releaseMonthForUF(uf);
  if (pinned) return pinned;

  const months = listMonthsForUF(uf);
  return months.length ? months[months.length - 1] : null;
}

// Dados de uma cidade num mês específico (ou competência publicada).
export function cityData(uf, cod6, ym) {
  ym = ym || latestMonth(uf);
  if (!ym) return null;
  const data = loadMonth(uf, ym);
  if (!data) return null;
  const c = data.byCity?.[cod6] || { total: 0, mh: 0, odonto: 0, operadoras: {} };
  const ops = Object.entries(c.operadoras || {})
    .map(([razao, v]) => ({
      razao,
      modalidade: v.modalidade,
      beneficiarios: v.beneficiarios,
      mh: v.mh,
      odonto: v.odonto,
    }))
    .sort((a, b) => b.beneficiarios - a.beneficiarios);
  return {
    month: ym,
    total: c.total,
    mh: c.mh,
    odonto: c.odonto,
    operadoras: ops,
  };
}

// Soma para múltiplas cidades (microrregião).
export function multiCityData(uf, cods, ym) {
  ym = ym || latestMonth(uf);
  if (!ym) return null;
  const data = loadMonth(uf, ym);
  if (!data) return null;
  let total = 0, mh = 0, odonto = 0;
  const opsMap = {};
  const cities = {};
  for (const cod of cods) {
    const c = data.byCity?.[cod] || { total: 0, mh: 0, odonto: 0, operadoras: {} };
    cities[cod] = { total: c.total, mh: c.mh, odonto: c.odonto };
    total += c.total; mh += c.mh; odonto += c.odonto;
    for (const [razao, v] of Object.entries(c.operadoras || {})) {
      if (!opsMap[razao]) opsMap[razao] = { razao, modalidade: v.modalidade, beneficiarios: 0, mh: 0, odonto: 0 };
      opsMap[razao].beneficiarios += v.beneficiarios;
      opsMap[razao].mh += v.mh;
      opsMap[razao].odonto += v.odonto;
    }
  }
  const ops = Object.values(opsMap).sort((a, b) => b.beneficiarios - a.beneficiarios);
  return { month: ym, total, mh, odonto, operadoras: ops, cities };
}

// Série histórica. Para produção, limita a série até a competência aprovada,
// evitando que um arquivo candidato eventualmente presente seja consumido.
export function historySeries(uf, cods) {
  const published = latestMonth(uf);
  const months = listMonthsForUF(uf).filter(ym => !published || ym <= published);
  const series = [];
  for (const ym of months) {
    const data = loadMonth(uf, ym);
    if (!data) continue;
    let total = 0, mh = 0, odonto = 0;
    for (const cod of cods) {
      const c = data.byCity?.[cod];
      if (!c) continue;
      total += c.total; mh += c.mh; odonto += c.odonto;
    }
    series.push({ month: ym, total, mh, odonto });
  }
  return series;
}
