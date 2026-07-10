/* =========================================================
 * One Page — ajustes complementares v3
 * Carregar depois de app.js.
 * ========================================================= */
(() => {
  "use strict";

  const IBGE_AGG = "https://servicodados.ibge.gov.br/api/v3/agregados";
  const IBGE_LOC = "https://servicodados.ibge.gov.br/api/v1/localidades";

  const CAXIAS_IBGE = "4305108";
  const POA_IBGE = "4314902";

  const RENDA_AB_KEYS = new Set(["99825", "99828", "96184"]); // >= 10 salários mínimos
  const RENDA_CLASS_IDS = [
    "99822", "99823", "99824", "96179", "96180", "96181",
    "96182", "99825", "99828", "96184", "96185"
  ];

  const AGE_60_PLUS = new Set([
    "93095", "93096", "93097", "93098", "49108",
    "49109", "60040", "60041", "6653"
  ]);

  const AGE_60_PLUS_IDS = [...AGE_60_PLUS];

  let metricsRequestToken = 0;
  let lastMetricsKey = "";
  let refreshTimer = null;
  let hospitalTimer = null;
  let referenceIdsPromise = null;

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

  function formatPercent(value, digits = 1) {
    return Number.isFinite(value)
      ? `${(value * 100).toLocaleString("pt-BR", {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits
        })}%`
      : "—";
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

  async function getJSON(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} em ${url}`);
    return response.json();
  }

  function replaceStaticLabels() {
    const infraTab = qs('.tab[data-tab="infra"]');
    if (infraTab) infraTab.textContent = "Hospitais";

    document.querySelectorAll("#landing strong").forEach(node => {
      if (/infra/i.test(node.textContent || "")) node.textContent = "Hospitais";
    });

    const infraMap = document.getElementById("infra-map");
    const mapHeading = infraMap?.closest(".card")?.querySelector(":scope > h3");
    if (mapHeading && /estabelecimentos/i.test(mapHeading.textContent || "")) {
      mapHeading.remove();
    }

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

  function ensureCompareLine(card, id) {
    if (!card || document.getElementById(id)) return;

    const compare = document.createElement("span");
    compare.id = id;
    compare.className = "k-compare";
    compare.innerHTML = "Caxias: <strong>—</strong> · POA: <strong>—</strong>";
    card.appendChild(compare);
  }

  function ensureIncomeKpis(scope, grid) {
    const pctId = `${scope}-renda-ab-pct`;
    const pop60Id = `${scope}-renda-ab-60`;

    if (!document.getElementById(pctId)) {
      grid.appendChild(makeKpi(
        pctId,
        "% população classe A+B",
        "Proxy de renda: participação das pessoas ocupadas de 14 anos ou mais com rendimento de 10 salários mínimos ou mais, conforme o agregado 10292 do Censo 2022."
      ));
    }

    if (!document.getElementById(pop60Id)) {
      grid.appendChild(makeKpi(
        pop60Id,
        "População A+B com 60 anos ou mais",
        "Estimativa obtida aplicando a participação de renda A+B à população de 60 anos ou mais. O percentual entre parênteses representa esse segmento sobre a população total."
      ));
    }

    ensureCompareLine(
      document.getElementById(pctId)?.closest(".kpi"),
      `${scope}-renda-ab-pct-compare`
    );

    ensureCompareLine(
      document.getElementById(pop60Id)?.closest(".kpi"),
      `${scope}-renda-ab-60-compare`
    );
  }

  function ensureScopeStructure(scope) {
    const isMicro = scope === "micro";
    const summaryAnchorId = isMicro ? "micro-total-pop" : "city-pop";
    const ansAnchorId = isMicro ? "micro-ans-total" : "city-ans-total";
    const className = isMicro ? "micro-summary-kpis" : "city-summary-kpis";

    const summaryGrid = document.getElementById(summaryAnchorId)?.closest(".kpis");
    const ansGrid = document.getElementById(ansAnchorId)?.closest(".kpis");

    if (!summaryGrid) return;

    summaryGrid.classList.add("summary-kpis", className);

    if (ansGrid && ansGrid !== summaryGrid) {
      [...ansGrid.children].forEach(child => summaryGrid.appendChild(child));
      ansGrid.remove();
    }

    ensureIncomeKpis(scope, summaryGrid);

    if (isMicro) {
      document.getElementById("micro-hosp-count")
        ?.closest(".kpis")
        ?.classList.add("micro-leitos-totals");

      document.getElementById("micro-habxleito-tot")
        ?.closest(".kpis")
        ?.classList.add("micro-page1-end");
    } else {
      document.getElementById("city-hosp-count")
        ?.closest(".kpis")
        ?.classList.add("city-leitos-totals");

      document.getElementById("city-habxleito-tot")
        ?.closest(".kpis")
        ?.classList.add("city-leitos-ratios");
    }
  }

  function ensureStructures() {
    ensureScopeStructure("micro");
    ensureScopeStructure("city");
  }

  function getCurrentIds() {
    try {
      const cityId = typeof state !== "undefined"
        ? String(state?.city?.id || "")
        : "";

      const microIds = typeof state !== "undefined" && Array.isArray(state?.micro?.municipios)
        ? state.micro.municipios
            .map(item => String(item?.id || ""))
            .filter(Boolean)
        : [];

      return { cityId, microIds };
    } catch (error) {
      console.warn("Não foi possível ler os IDs atuais:", error);
      return { cityId: "", microIds: [] };
    }
  }

  async function fetchMicroIdsForCity(cityId) {
    const city = await getJSON(`${IBGE_LOC}/municipios/${cityId}`);
    const microId = city?.microrregiao?.id;
    if (!microId) return [];

    const municipalities = await getJSON(`${IBGE_LOC}/microrregioes/${microId}/municipios`);
    return (municipalities || [])
      .map(item => String(item?.id || ""))
      .filter(Boolean);
  }

  function loadReferenceIds() {
    if (!referenceIdsPromise) {
      referenceIdsPromise = Promise.all([
        fetchMicroIdsForCity(CAXIAS_IBGE),
        fetchMicroIdsForCity(POA_IBGE)
      ]).then(([caxiasMicroIds, poaMicroIds]) => ({
        caxiasCityIds: [CAXIAS_IBGE],
        poaCityIds: [POA_IBGE],
        caxiasMicroIds,
        poaMicroIds
      })).catch(error => {
        console.warn("Falha ao carregar microrregiões de referência:", error);
        return {
          caxiasCityIds: [CAXIAS_IBGE],
          poaCityIds: [POA_IBGE],
          caxiasMicroIds: [CAXIAS_IBGE],
          poaMicroIds: [POA_IBGE]
        };
      });
    }

    return referenceIdsPromise;
  }

  async function fetchPopulationByLocality(ids) {
    const url = `${IBGE_AGG}/9514/periodos/2022/variaveis/93` +
      `?localidades=N6[${ids.join(",")}]`;

    const data = await getJSON(url);
    const output = new Map();

    for (const series of data?.[0]?.resultados?.[0]?.series || []) {
      const id = String(series?.localidade?.id || "");
      const value = Number(Object.values(series?.serie || {})[0]);
      if (id && Number.isFinite(value)) output.set(id, value);
    }

    return output;
  }

  async function fetchIncomeByLocality(ids) {
    const classIds = RENDA_CLASS_IDS.join(",");
    const url = `${IBGE_AGG}/10292/periodos/2022/variaveis/4090` +
      `?localidades=N6[${ids.join(",")}]` +
      `&classificacao=11915[${classIds}]|2[6794]`;

    const data = await getJSON(url);
    const output = new Map();

    for (const result of data?.[0]?.resultados || []) {
      const classification = (result.classificacoes || [])
        .find(item => String(item.id) === "11915");
      const category = classification?.categoria || {};
      const classId = Object.keys(category)[0];
      if (!classId) continue;

      for (const series of result.series || []) {
        const id = String(series?.localidade?.id || "");
        const value = Number(Object.values(series?.serie || {})[0]);
        if (!id || !Number.isFinite(value)) continue;

        const current = output.get(id) || { denominator: 0, ab: 0 };
        current.denominator += value;
        if (RENDA_AB_KEYS.has(classId)) current.ab += value;
        output.set(id, current);
      }
    }

    return output;
  }

  async function fetchPop60ByLocality(ids) {
    const url = `${IBGE_AGG}/9514/periodos/2022/variaveis/93` +
      `?localidades=N6[${ids.join(",")}]` +
      `&classificacao=2[4,5]|287[${AGE_60_PLUS_IDS.join(",")}]`;

    const data = await getJSON(url);
    const output = new Map();

    for (const result of data?.[0]?.resultados || []) {
      const ageClassification = (result.classificacoes || [])
        .find(item => String(item.id) === "287");
      const ageId = Object.keys(ageClassification?.categoria || {})[0];
      if (!AGE_60_PLUS.has(ageId)) continue;

      for (const series of result.series || []) {
        const id = String(series?.localidade?.id || "");
        const value = Number(Object.values(series?.serie || {})[0]);
        if (!id || !Number.isFinite(value)) continue;
        output.set(id, (output.get(id) || 0) + value);
      }
    }

    return output;
  }

  function aggregateMetrics(ids, populationMap, incomeMap, pop60Map) {
    let totalPopulation = 0;
    let population60 = 0;
    let denominator = 0;
    let incomeAB = 0;

    for (const id of ids || []) {
      totalPopulation += Number(populationMap.get(id) || 0);
      population60 += Number(pop60Map.get(id) || 0);

      const income = incomeMap.get(id);
      denominator += Number(income?.denominator || 0);
      incomeAB += Number(income?.ab || 0);
    }

    const shareAB = denominator > 0 ? incomeAB / denominator : null;
    const estimated60AB = Number.isFinite(shareAB)
      ? population60 * shareAB
      : null;
    const estimatedShareTotal = Number.isFinite(estimated60AB) && totalPopulation > 0
      ? estimated60AB / totalPopulation
      : null;

    return {
      totalPopulation,
      population60,
      shareAB,
      estimated60AB,
      estimatedShareTotal
    };
  }

  function formatEstimatedSegment(metric, includeApprox = true) {
    if (!Number.isFinite(metric?.estimated60AB)) return "—";

    const prefix = includeApprox ? "≈ " : "";
    return `${prefix}${formatInteger(metric.estimated60AB)} (${formatPercent(metric.estimatedShareTotal)})`;
  }

  function setCompare(id, caxiasValue, poaValue) {
    const node = document.getElementById(id);
    if (!node) return;

    node.innerHTML =
      `Caxias: <strong>${caxiasValue}</strong> · ` +
      `POA: <strong>${poaValue}</strong>`;
  }

  function renderScopeMetrics(scope, target, caxias, poa) {
    const pctNode = document.getElementById(`${scope}-renda-ab-pct`);
    const pop60Node = document.getElementById(`${scope}-renda-ab-60`);

    if (pctNode) pctNode.textContent = formatPercent(target?.shareAB);
    if (pop60Node) pop60Node.textContent = formatEstimatedSegment(target, true);

    setCompare(
      `${scope}-renda-ab-pct-compare`,
      formatPercent(caxias?.shareAB),
      formatPercent(poa?.shareAB)
    );

    setCompare(
      `${scope}-renda-ab-60-compare`,
      formatEstimatedSegment(caxias, false),
      formatEstimatedSegment(poa, false)
    );
  }

  function setMetricsLoading() {
    ["micro", "city"].forEach(scope => {
      const pctNode = document.getElementById(`${scope}-renda-ab-pct`);
      const pop60Node = document.getElementById(`${scope}-renda-ab-60`);
      if (pctNode) pctNode.textContent = "…";
      if (pop60Node) pop60Node.textContent = "…";
    });
  }

  function setMetricsUnavailable() {
    ["micro", "city"].forEach(scope => {
      const pctNode = document.getElementById(`${scope}-renda-ab-pct`);
      const pop60Node = document.getElementById(`${scope}-renda-ab-60`);
      if (pctNode) pctNode.textContent = "—";
      if (pop60Node) pop60Node.textContent = "—";

      setCompare(`${scope}-renda-ab-pct-compare`, "—", "—");
      setCompare(`${scope}-renda-ab-60-compare`, "—", "—");
    });
  }

  async function refreshIncomeMetrics(force = false) {
    ensureStructures();

    const { cityId, microIds } = getCurrentIds();
    if (!cityId || !microIds.length) return;

    const key = `${cityId}|${microIds.join(",")}`;
    if (!force && key === lastMetricsKey) return;

    lastMetricsKey = key;
    const requestToken = ++metricsRequestToken;
    setMetricsLoading();

    try {
      const refs = await loadReferenceIds();

      const allIds = [...new Set([
        cityId,
        ...microIds,
        ...refs.caxiasCityIds,
        ...refs.poaCityIds,
        ...refs.caxiasMicroIds,
        ...refs.poaMicroIds
      ])];

      const [populationMap, incomeMap, pop60Map] = await Promise.all([
        fetchPopulationByLocality(allIds),
        fetchIncomeByLocality(allIds),
        fetchPop60ByLocality(allIds)
      ]);

      if (requestToken !== metricsRequestToken) return;

      const currentCity = aggregateMetrics(
        [cityId], populationMap, incomeMap, pop60Map
      );
      const currentMicro = aggregateMetrics(
        microIds, populationMap, incomeMap, pop60Map
      );

      const caxiasCity = aggregateMetrics(
        refs.caxiasCityIds, populationMap, incomeMap, pop60Map
      );
      const poaCity = aggregateMetrics(
        refs.poaCityIds, populationMap, incomeMap, pop60Map
      );

      const caxiasMicro = aggregateMetrics(
        refs.caxiasMicroIds, populationMap, incomeMap, pop60Map
      );
      const poaMicro = aggregateMetrics(
        refs.poaMicroIds, populationMap, incomeMap, pop60Map
      );

      renderScopeMetrics("city", currentCity, caxiasCity, poaCity);
      renderScopeMetrics("micro", currentMicro, caxiasMicro, poaMicro);
    } catch (error) {
      console.warn("Falha ao calcular os indicadores de renda A+B:", error);
      if (requestToken !== metricsRequestToken) return;
      lastMetricsKey = "";
      setMetricsUnavailable();
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
      ensureStructures();
      refreshIncomeMetrics(false);
    }, 220);
  }

  function scheduleHospitalPreparation() {
    window.clearTimeout(hospitalTimer);
    hospitalTimer = window.setTimeout(prepareExecutiveHospitalRows, 80);
  }

  function initialize() {
    replaceStaticLabels();
    ensureStructures();
    prepareExecutiveHospitalRows();

    const executiveButton = document.getElementById("print-exec-btn");
    executiveButton?.addEventListener("click", prepareExecutiveHospitalRows, true);

    window.addEventListener("beforeprint", () => {
      replaceStaticLabels();
      ensureStructures();
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

        if (target?.closest?.("#city-leitos-table tbody")) {
          hospitalTableChanged = true;
        }
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
