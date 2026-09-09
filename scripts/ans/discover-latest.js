#!/usr/bin/env node

const ANS_BASE = "https://dadosabertos.ans.gov.br/FTP/PDA/informacoes_consolidadas_de_beneficiarios-024";

function ymToFileToken(ym) {
  return `${ym.slice(0, 4)}_${ym.slice(4, 6)}`;
}

function urlFor(uf, ym) {
  return `${ANS_BASE}/${ym}/pda-024-icb-${uf}-${ymToFileToken(ym)}.zip`;
}

function recentMonths(count = 12) {
  const now = new Date();
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth() + 1;
  const out = [];

  for (let i = 0; i < count; i++) {
    out.push(`${year}${String(month).padStart(2, "0")}`);
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }

  return out;
}

async function exists(url) {
  try {
    let response = await fetch(url, { method: "HEAD", redirect: "follow" });
    if (response.ok) return true;

    response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { Range: "bytes=0-0" }
    });
    return response.ok || response.status === 206;
  } catch {
    return false;
  }
}

async function main() {
  const uf = String(process.argv[2] || "RS").toUpperCase();

  for (const ym of recentMonths(12)) {
    if (await exists(urlFor(uf, ym))) {
      process.stdout.write(`${ym}\n`);
      return;
    }
  }

  throw new Error(`Nenhuma competência ANS recente foi encontrada para ${uf}.`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
