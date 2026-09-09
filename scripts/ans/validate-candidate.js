#!/usr/bin/env node

import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const RELEASE_DIR = path.join(DATA_DIR, "ans", "releases");

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function normalizeYm(value) {
  const ym = String(value || "").replace(/-/g, "");
  if (!/^\d{6}$/.test(ym)) throw new Error(`Competência inválida: ${value}`);
  return ym;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function pctChange(current, previous) {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function round(value, digits = 2) {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function summarize(snapshot) {
  const byCity = snapshot?.byCity || {};
  const cityEntries = Object.entries(byCity);
  let total = 0;
  let mh = 0;
  let odonto = 0;
  let operatorRows = 0;
  const problems = [];

  for (const [cityCode, city] of cityEntries) {
    const cityTotal = Number(city?.total || 0);
    const cityMh = Number(city?.mh || 0);
    const cityOdonto = Number(city?.odonto || 0);

    if (!/^\d{6,7}$/.test(String(cityCode))) {
      problems.push(`Código municipal inválido: ${cityCode}`);
    }
    if ([cityTotal, cityMh, cityOdonto].some(value => !Number.isFinite(value) || value < 0)) {
      problems.push(`Valores inválidos no município ${cityCode}.`);
      continue;
    }
    if (cityTotal !== cityMh + cityOdonto) {
      problems.push(`Reconciliação municipal falhou em ${cityCode}: total=${cityTotal}, mh+odonto=${cityMh + cityOdonto}.`);
    }

    let operatorTotal = 0;
    for (const [name, operator] of Object.entries(city?.operadoras || {})) {
      const opTotal = Number(operator?.beneficiarios || 0);
      const opMh = Number(operator?.mh || 0);
      const opOdonto = Number(operator?.odonto || 0);
      operatorRows += 1;

      if (!name.trim()) problems.push(`Operadora sem nome em ${cityCode}.`);
      if ([opTotal, opMh, opOdonto].some(value => !Number.isFinite(value) || value < 0)) {
        problems.push(`Valores inválidos para operadora ${name} em ${cityCode}.`);
        continue;
      }
      if (opTotal !== opMh + opOdonto) {
        problems.push(`Reconciliação da operadora ${name} falhou em ${cityCode}.`);
      }
      operatorTotal += opTotal;
    }

    if (operatorTotal !== cityTotal) {
      problems.push(`Soma das operadoras difere do total em ${cityCode}: ${operatorTotal} vs ${cityTotal}.`);
    }

    total += cityTotal;
    mh += cityMh;
    odonto += cityOdonto;
  }

  return {
    cityCount: cityEntries.length,
    operatorRows,
    total,
    mh,
    odonto,
    problems
  };
}

function validateUf(uf, candidate, approved) {
  const candidateFile = path.join(DATA_DIR, `ans_${uf}_${candidate}.json`);
  const approvedFile = path.join(DATA_DIR, `ans_${uf}_${approved}.json`);
  const blockingIssues = [];
  const warnings = [];

  if (!fs.existsSync(candidateFile)) {
    blockingIssues.push(`Arquivo candidato ausente: ${path.basename(candidateFile)}.`);
    return { uf, status: "blocked", blockingIssues, warnings };
  }

  const candidateData = readJson(candidateFile);
  const candidateSummary = summarize(candidateData);

  if (String(candidateData.month || "") !== candidate) {
    blockingIssues.push(`${path.basename(candidateFile)} declara month=${candidateData.month}; esperado ${candidate}.`);
  }
  if (String(candidateData.uf || "").toUpperCase() !== uf) {
    blockingIssues.push(`${path.basename(candidateFile)} declara UF=${candidateData.uf}; esperado ${uf}.`);
  }
  if (candidateSummary.cityCount === 0 || candidateSummary.mh <= 0) {
    blockingIssues.push(`Carga ${uf}/${candidate} vazia ou sem beneficiários médico-hospitalares.`);
  }
  if (candidateSummary.problems.length > 0) {
    blockingIssues.push(...candidateSummary.problems.slice(0, 25));
    if (candidateSummary.problems.length > 25) {
      blockingIssues.push(`Existem mais ${candidateSummary.problems.length - 25} inconsistências de reconciliação.`);
    }
  }

  let approvedSummary = null;
  if (fs.existsSync(approvedFile)) {
    approvedSummary = summarize(readJson(approvedFile));
    const mhDeltaPct = pctChange(candidateSummary.mh, approvedSummary.mh);
    const cityDeltaPct = pctChange(candidateSummary.cityCount, approvedSummary.cityCount);

    if (mhDeltaPct != null && Math.abs(mhDeltaPct) > 20) {
      blockingIssues.push(`Beneficiários MH de ${uf} variaram ${round(mhDeltaPct)}% frente a ${approved}.`);
    } else if (mhDeltaPct != null && Math.abs(mhDeltaPct) > 5) {
      warnings.push(`Beneficiários MH de ${uf} variaram ${round(mhDeltaPct)}% frente a ${approved}.`);
    }

    if (cityDeltaPct != null && Math.abs(cityDeltaPct) > 25) {
      blockingIssues.push(`Quantidade de municípios de ${uf} variou ${round(cityDeltaPct)}% frente a ${approved}.`);
    } else if (cityDeltaPct != null && Math.abs(cityDeltaPct) > 10) {
      warnings.push(`Quantidade de municípios de ${uf} variou ${round(cityDeltaPct)}% frente a ${approved}.`);
    }
  } else {
    warnings.push(`Base aprovada ${uf}/${approved} não existe; comparação temporal não executada.`);
  }

  if (uf === "RS") {
    for (const code of ["431490", "430510"]) {
      if (!candidateData.byCity?.[code]) {
        blockingIssues.push(`Município de referência ${code} ausente na carga RS/${candidate}.`);
      }
    }
  }

  return {
    uf,
    status: blockingIssues.length ? "blocked" : warnings.length ? "passed_with_warnings" : "passed",
    candidate: candidateSummary,
    approved: approvedSummary,
    blockingIssues,
    warnings
  };
}

function main() {
  const candidate = normalizeYm(arg("candidate"));
  const approved = normalizeYm(arg("approved"));
  const ufs = String(arg("ufs", "RS,SC"))
    .split(",")
    .map(value => value.trim().toUpperCase())
    .filter(Boolean);

  const results = ufs.map(uf => validateUf(uf, candidate, approved));
  const blockingIssues = results.flatMap(result => result.blockingIssues.map(message => `${result.uf}: ${message}`));
  const warnings = results.flatMap(result => result.warnings.map(message => `${result.uf}: ${message}`));
  const status = blockingIssues.length ? "blocked" : warnings.length ? "passed_with_warnings" : "passed";
  const generatedAt = new Date().toISOString();

  fs.mkdirSync(RELEASE_DIR, { recursive: true });

  const report = {
    candidate,
    baseCompetence: approved,
    ufs,
    status,
    generatedAt,
    blockingIssues,
    warnings,
    results
  };

  fs.writeFileSync(
    path.join(RELEASE_DIR, "candidate-validation.json"),
    `${JSON.stringify(report, null, 2)}\n`
  );

  const candidateState = {
    competence: candidate,
    baseCompetence: approved,
    ufs,
    status: status === "blocked" ? "blocked" : "pending",
    validationStatus: status,
    createdAt: generatedAt,
    reviewUrl: null,
    notes: status === "blocked"
      ? "Carga bloqueada pela validação automática e impedida de promoção."
      : "Carga candidata aguardando homologação e aprovação explícita."
  };

  fs.writeFileSync(
    path.join(RELEASE_DIR, "candidate.json"),
    `${JSON.stringify(candidateState, null, 2)}\n`
  );

  console.log(JSON.stringify({ status, candidate, approved, ufs, blockingIssues: blockingIssues.length, warnings: warnings.length }, null, 2));

  if (status === "blocked") process.exitCode = 2;
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
