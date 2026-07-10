/* =========================================================
 * One Page — ajustes complementares
 * Carregar depois de app.js.
 * ========================================================= */
(() => {
  "use strict";

  const IBGE_AGG = "https://servicodados.ibge.gov.br/api/v3/agregados";
  const RENDA_AB_KEYS = new Set(["99825", "99828", "96184"]); // >= 10 salários mínimos
  const RENDA_CLASS_IDS = [
    "99822", "99823", "99824", "96179", "96180", "96181",
    "96182", "99825", "99828", "96184", "96185"
  ];

  let rendaRequestToken = 0;
  let lastMicroKey = "";
  let refreshTimer = null;
  let hospitalTimer = null;

  const qs = (selector, root = document) => root.querySelector(selector);

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/_/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();
  }

  function formatInteger(value) {
    return Number.isFinite(value)
      ? Math.round(value).toLocaleString("pt-BR")
      : "—";
  }

  function parseBrazilianInteger(value) {
    const firstPart = String(value || "").split("(")[0];
    const digits = firstPart.replace(/[^0-9-]/g, "");
    const parsed = Number(digits);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function parseTableNumber(value) {
    const clean = String(value || "")
      .replace(/\s/g, "")
      .replace(/\./g, "")
      .replace(",", ".")
      .replace(/[^0-9.-]/g, "");
    const parsed = Number(clean);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function replaceStaticLabels() {
    const infraTab = qs('.tab[data-tab="infra"]');
    if (infraTab) infraTab.textContent = "Hospitais";

    document.querySelectorAll("#landing strong").forEach(node => {
      if (/infra/i.test(node.textContent || "")) node.textContent = "Hospitais";
    });

    // Remove o cabeçalho visual ligado ao mapa de estabelecimentos do CNES.
    const infraMap = document.getElementById("infra-map");
    const mapHeading = infraMap?.closest(".card")?.querySelector(":scope > h3");
    if (mapHeading && /estabelecimentos/i.test(mapHeading.textContent || "")) {
      mapHeading.remove();
    }

    // O banner de modo de teste não deve aparecer na versão final.
    document.getElementById("test-mode-banner")?.remove();
  }

  function makeKpi(id, label, title) {
    const card = document.createElement("div");
    card.className = "kpi compact-kpi";
    if (title) card.title = title;

    const labelNode = document.createElement("span");
    labelNode.className = "k-label";
    labelNode.textContent = label;

    const valueNode = document.createElement("span");
    valueNode.className = "k-val";
    valueNode.id = id;
    valueNode.textContent = "—";

    card.append(labelNode, valueNode);
    return card;
  }

  function ensureMicroStructure() {
    const panel = qs('.tab-panel[data-panel="micro"]');
    if (!panel) return;

    const demographicGrid = document.getElementById("micro-total-pop")?.closest(".kpis");
    const ansGrid = document.getElementById("micro-ans-total")?.closest(".kpis");

    if (demographicGrid) {
      demographicGrid.classList.add("micro-summary-kpis");

      if (ansGrid && ansGrid !== demographicGrid) {
        [...ansGrid.children].forEach(child => demographicGrid.appendChild(child));
        ansGrid.remove();
      }

      if (!document.getElementById("micro-renda-ab-pct")) {
        demographicGrid.appendChild(makeKpi(
          "micro-renda-ab-pct",
          "% população classe A+B",
          "Proxy de renda: participação das pessoas ocupadas de 14 anos ou mais com rendimento de 10 salários mínimos ou mais, conforme o agregado 10292 do Censo 2022."
        ));
      }

      if (!document.getElementById("micro-renda-ab-60")) {
        demographicGrid.appendChild(makeKpi(
          "micro-renda-ab-60",
          "População A+B com 60 anos ou mais",
          "Estimativa obtida aplicando a participação de renda A+B da microrregião à população de 60 anos ou mais. O Censo usado no painel não fornece diretamente o cruzamento idade x classe econômica."
        ));
      }
    }

    document.getElementById("micro-hosp-count")
      ?.closest(".kpis")
      ?.classList.add("micro-leitos-totals");

    document.getElementById("micro-habxleito-tot")
      ?.closest(".kpis")
      ?.classList.add("micro-page1-end");
  }

  function getMicroMunicipalityIds() {
    try {
      if (typeof state !== "undefined" && Array.isArray(state?.micro?.municipios)) {
        return state.micro.municipios
          .map(item => String(item?.id || ""))
          .filter(Boolean);
      }
    } catch (error) {
      console.warn("Não foi possível ler os municípios da microrregião:", error);
    }
    return [];
  }

  async function fetchMicroIncome(ids) {
    const locations = ids.join(",");
    const classIds = RENDA_CLASS_IDS.join(",");
    const url = `${IBGE_AGG}/10292/periodos/2022/variaveis/4090` +
      `?localidades=N6[${locations}]&classificacao=11915[${classIds}]|2[6794]`;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`IBGE retornou HTTP ${response.status}`);

    const data = await response.json();
    const totals = new Map();

    for (const result of data?.[0]?.resultados || []) {
      const classification = (result.classificacoes || [])
        .find(item => String(item.id) === "11915");
      const category = classification?.categoria || {};
      const key = Object.keys(category)[0];
      if (!key) continue;

      let value = 0;
      for (const series of result.series || []) {
        const raw = Object.values(series?.serie || {})[0];
        const numeric = Number(raw);
        if (Number.isFinite(numeric)) value += numeric;
      }

      totals.set(key, (totals.get(key) || 0) + value);
    }

    return totals;
  }

  async function refreshMicroIncome(force = false) {
    ensureMicroStructure();

    const ids = getMicroMunicipalityIds();
    const microName = document.getElementById("micro-title")?.textContent?.trim() || "";
    const key = `${microName}|${ids.join(",")}`;

    if (!ids.length || !microName || /—$/.test(microName)) return;
    if (!force && key === lastMicroKey) return;

    lastMicroKey = key;
    const requestToken = ++rendaRequestToken;

    const pctNode = document.getElementById("micro-renda-ab-pct");
    const pop60Node = document.getElementById("micro-renda-ab-60");
    if (pctNode) pctNode.textContent = "…";
    if (pop60Node) pop60Node.textContent = "…";

    try {
      const totals = await fetchMicroIncome(ids);
      if (requestToken !== rendaRequestToken) return;

      let denominator = 0;
      let rendaAB = 0;

      for (const [classId, value] of totals.entries()) {
        denominator += Number(value || 0);
        if (RENDA_AB_KEYS.has(classId)) rendaAB += Number(value || 0);
      }

      const share = denominator > 0 ? rendaAB / denominator : null;
      const pop60 = parseBrazilianInteger(document.getElementById("micro-60")?.textContent);
      const estimatedPop60AB = share != null && pop60 != null ? pop60 * share : null;

      if (pctNode) {
        pctNode.textContent = share == null
          ? "—"
          : `${(share * 100).toLocaleString("pt-BR", {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1
            })}%`;
      }

      if (pop60Node) {
        pop60Node.textContent = estimatedPop60AB == null
          ? "—"
          : `≈ ${formatInteger(estimatedPop60AB)}`;
      }
    } catch (error) {
      console.warn("Falha ao calcular renda A+B da microrregião:", error);
      if (requestToken !== rendaRequestToken) return;
      lastMicroKey = "";
      if (pctNode) pctNode.textContent = "—";
      if (pop60Node) pop60Node.textContent = "—";
    }
  }

  function natureAllowed(value) {
    const nature = normalizeText(value);
    return nature.includes("SEM FINS LUCRATIVOS") || nature.includes("PRIVAD");
  }

  function prepareExecutiveHospitalRows() {
    const table = document.getElementById("city-leitos-table");
    if (!table) return;

    const rows = [...table.querySelectorAll("tbody tr")];
    const visibleTotals = [0, 0, 0, 0, 0];

    for (const row of rows) {
      const allowed = natureAllowed(row.cells?.[1]?.textContent);
      row.classList.toggle("exec-nature-allowed", allowed);

      if (!allowed) continue;
      for (let index = 0; index < visibleTotals.length; index += 1) {
        visibleTotals[index] += parseTableNumber(row.cells?.[index + 2]?.textContent);
      }
    }

    const tfoot = table.tFoot || table.createTFoot();
    tfoot.querySelector(".exec-filter-total")?.remove();

    const totalRow = document.createElement("tr");
    totalRow.className = "exec-filter-total";

    const labelCell = document.createElement("td");
    labelCell.colSpan = 2;
    labelCell.textContent = "TOTAL EXIBIDO";
    totalRow.appendChild(labelCell);

    for (const value of visibleTotals) {
      const cell = document.createElement("td");
      cell.className = "num";
      cell.textContent = formatInteger(value);
      totalRow.appendChild(cell);
    }

    tfoot.appendChild(totalRow);
  }

  function scheduleRefresh() {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      replaceStaticLabels();
      ensureMicroStructure();
      refreshMicroIncome(false);
    }, 180);
  }

  function scheduleHospitalPreparation() {
    window.clearTimeout(hospitalTimer);
    hospitalTimer = window.setTimeout(prepareExecutiveHospitalRows, 80);
  }

  function initialize() {
    replaceStaticLabels();
    ensureMicroStructure();
    prepareExecutiveHospitalRows();

    const executiveButton = document.getElementById("print-exec-btn");
    executiveButton?.addEventListener("click", prepareExecutiveHospitalRows, true);

    window.addEventListener("beforeprint", () => {
      replaceStaticLabels();
      ensureMicroStructure();
      if (document.body.classList.contains("print-executive")) {
        prepareExecutiveHospitalRows();
      }
    });

    const dashboard = document.getElementById("dashboard") || document.body;
    const observer = new MutationObserver(mutations => {
      let hospitalTableChanged = false;

      for (const mutation of mutations) {
        const target = mutation.target?.nodeType === Node.ELEMENT_NODE
          ? mutation.target
          : mutation.target?.parentElement;

        if (target?.closest?.("#city-leitos-table tbody")) hospitalTableChanged = true;
      }

      scheduleRefresh();
      if (hospitalTableChanged) scheduleHospitalPreparation();
    });

    observer.observe(dashboard, {
      subtree: true,
      childList: true,
      characterData: true
    });

    scheduleRefresh();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
