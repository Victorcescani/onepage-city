/* =========================================================
 * One Page — ajustes complementares v5
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
  let ansReferencePromise = null;
  const growthEstimateCache = new Map();

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

  function setKpiLabel(valueId, text) {
    const node = document.getElementById(valueId);
    const label = node?.closest(".kpi")?.querySelector(".k-label");
    if (label && label.textContent !== text) label.textContent = text;
  }

  function replaceStaticLabels() {
    const infraTab = qs('.tab[data-tab="infra"]');
    if (infraTab) infraTab.textContent = "Hospitais";

    document.querySelectorAll("#landing strong").forEach(node => {
      if (/infra/i.test(node.textContent || "")) node.textContent = "Hospitais";
    });

    setKpiLabel("city-ans-total", "Beneficiários ANS");
    setKpiLabel("micro-ans-total", "Beneficiários ANS");

    const infraMap = document.getElementById("infra-map");
    const mapHeading = infraMap?.closest(".card")?.querySelector(":scope > h3");
    if (mapHeading && /estabelecimentos/i.test(mapHeading.textContent || "")) {
      mapHeading.remove();
    }

    const bubble = document.getElementById("city-bubble");
    const bubbleCard = bubble?.closest(".card");
    const bubbleNote = bubbleCard?.querySelector("p.muted");
    if (bubbleNote) {
      bubbleNote.textContent =
        "Cada ponto representa uma cidade ou referência regional. " +
        "Eixo X: beneficiários ANS por leito privado (maior = maior pressão assistencial). " +
        "Eixo Y: cobertura ANS (% da população). Todos os pontos têm o mesmo tamanho; " +
        "as cores identificam a cidade pesquisada, Porto Alegre, Caxias do Sul, " +
        "a microrregião consolidada e os demais municípios.";
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

  function ensureSummaryComparisons(scope) {
    const compareTargets = [
      [`${scope}-60`, `${scope}-pop60-compare`],
      [`${scope}-ans-total`, `${scope}-ans-total-compare`],
      [`${scope}-ans-pct`, `${scope}-ans-pct-compare`]
    ];

    compareTargets.forEach(([valueId, compareId]) => {
      ensureCompareLine(
        document.getElementById(valueId)?.closest(".kpi"),
        compareId
      );
    });
  }

  function ensureSummarySource(scope, summaryGrid) {
    const sourceId = `${scope}-summary-source`;
    if (document.getElementById(sourceId)) return;

    const source = document.createElement("p");
    source.id = sourceId;
    source.className = `summary-source ${scope}-summary-source`;

    source.textContent = scope === "city"
      ? "Fontes: IBGE · Censo 2010/2022 e estimativa populacional anual; ANS · beneficiários médico-hospitalares; IBGE · Censo 2022 (renda)."
      : "Fontes: IBGE · Censo 2022; ANS · beneficiários médico-hospitalares; IBGE · Censo 2022 (renda).";

    summaryGrid.insertAdjacentElement("afterend", source);
  }

  function markHiddenSections() {
    document.getElementById("micro-types-table")
      ?.closest(".grid-2")
      ?.classList.add("section-hidden-by-design");

    document.getElementById("city-renda")
      ?.closest(".card")
      ?.classList.add("section-hidden-by-design");
  }

  function disableHospitalPhotoEnrichment() {
    try {
      if (typeof window.enrichHospitalPhotos === "function") {
        window.enrichHospitalPhotos = async function () {
          return;
        };
      }
    } catch (error) {
      console.warn("Não foi possível desativar o carregamento de fotos dos hospitais:", error);
    }
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
    ensureSummaryComparisons(scope);
    ensureSummarySource(scope, summaryGrid);
    markHiddenSections();

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

  async function loadAnsReferences(refs) {
    if (ansReferencePromise) return ansReferencePromise;

    ansReferencePromise = (async () => {
      if (
        typeof fetchAnsSingle !== "function" ||
        typeof fetchAnsMulti !== "function" ||
        typeof ansMHOnly !== "function"
      ) {
        return {
          caxiasCity: null,
          poaCity: null,
          caxiasMicro: null,
          poaMicro: null
        };
      }

      const caxiasMicroCods = refs.caxiasMicroIds
        .map(id => String(id).slice(0, 6))
        .join(",");
      const poaMicroCods = refs.poaMicroIds
        .map(id => String(id).slice(0, 6))
        .join(",");

      const [caxiasCityRaw, poaCityRaw, caxiasMicroRaw, poaMicroRaw] =
        await Promise.all([
          fetchAnsSingle("RS", CAXIAS_IBGE.slice(0, 6)).catch(() => null),
          fetchAnsSingle("RS", POA_IBGE.slice(0, 6)).catch(() => null),
          fetchAnsMulti("RS", caxiasMicroCods).catch(() => null),
          fetchAnsMulti("RS", poaMicroCods).catch(() => null)
        ]);

      return {
        caxiasCity: ansMHOnly(caxiasCityRaw),
        poaCity: ansMHOnly(poaCityRaw),
        caxiasMicro: ansMHOnly(caxiasMicroRaw),
        poaMicro: ansMHOnly(poaMicroRaw)
      };
    })();

    return ansReferencePromise;
  }

  async function fetchPopulation2010(cityId) {
    const url = `${IBGE_AGG}/608/periodos/2010/variaveis/93` +
      `?localidades=N6[${cityId}]`;
    const data = await getJSON(url);
    const series = data?.[0]?.resultados?.[0]?.series?.[0]?.serie || {};
    const raw = Object.values(series)[0];
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  async function fetchPopulationEstimate(cityId, requestedYear = 2026) {
    const cacheKey = `${cityId}|${requestedYear}`;
    if (growthEstimateCache.has(cacheKey)) {
      return growthEstimateCache.get(cacheKey);
    }

    const fetchPeriod = async period => {
      const url = `${IBGE_AGG}/6579/periodos/${period}/variaveis/9324` +
        `?localidades=N6[${cityId}]`;
      const data = await getJSON(url);
      const series = data?.[0]?.resultados?.[0]?.series?.[0]?.serie || {};
      const entries = Object.entries(series)
        .map(([year, value]) => [Number(year), Number(value)])
        .filter(([year, value]) => Number.isFinite(year) && Number.isFinite(value))
        .sort((a, b) => a[0] - b[0]);

      if (!entries.length) return null;
      const [year, value] = entries[entries.length - 1];
      return { year, value };
    };

    let result = null;
    try {
      result = await fetchPeriod(String(requestedYear));
    } catch {}

    if (!result) {
      try {
        result = await fetchPeriod("-1");
      } catch {}
    }

    growthEstimateCache.set(cacheKey, result);
    return result;
  }

  async function refreshCityGrowth(cityId) {
    const valueNode = document.getElementById("city-growth");
    if (!valueNode || !cityId) return;

    try {
      const [pop2010, estimate] = await Promise.all([
        fetchPopulation2010(cityId),
        fetchPopulationEstimate(cityId, 2026)
      ]);

      const year = estimate?.year || 2026;
      setKpiLabel("city-growth", `Crescimento populacional (2010-${year})`);

      if (!pop2010 || !estimate?.value) {
        valueNode.textContent = "—";
        return;
      }

      const growth = ((estimate.value / pop2010) - 1) * 100;
      valueNode.textContent =
        `${growth >= 0 ? "+" : ""}${growth.toLocaleString("pt-BR", {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1
        })}%`;
    } catch (error) {
      console.warn("Falha ao calcular crescimento populacional 2010-2026:", error);
      setKpiLabel("city-growth", "Crescimento populacional (2010-2026)");
    }
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

  function renderOperationalComparisons({
    city,
    micro,
    caxiasCity,
    poaCity,
    caxiasMicro,
    poaMicro,
    ansRefs
  }) {
    const pop60Pct = metric => (
      metric?.totalPopulation > 0
        ? metric.population60 / metric.totalPopulation
        : null
    );

    const coverage = (ans, metric) => (
      ans?.total > 0 && metric?.totalPopulation > 0
        ? ans.total / metric.totalPopulation
        : null
    );

    setCompare(
      "city-pop60-compare",
      formatPercent(pop60Pct(caxiasCity)),
      formatPercent(pop60Pct(poaCity))
    );
    setCompare(
      "micro-pop60-compare",
      formatPercent(pop60Pct(caxiasMicro)),
      formatPercent(pop60Pct(poaMicro))
    );

    const ansCount = ans => (
      ans && Number(ans.total) > 0
        ? formatInteger(Number(ans.total))
        : "—"
    );

    setCompare(
      "city-ans-total-compare",
      ansCount(ansRefs?.caxiasCity),
      ansCount(ansRefs?.poaCity)
    );
    setCompare(
      "micro-ans-total-compare",
      ansCount(ansRefs?.caxiasMicro),
      ansCount(ansRefs?.poaMicro)
    );

    setCompare(
      "city-ans-pct-compare",
      formatPercent(coverage(ansRefs?.caxiasCity, caxiasCity)),
      formatPercent(coverage(ansRefs?.poaCity, poaCity))
    );
    setCompare(
      "micro-ans-pct-compare",
      formatPercent(coverage(ansRefs?.caxiasMicro, caxiasMicro)),
      formatPercent(coverage(ansRefs?.poaMicro, poaMicro))
    );
  }

  function simplifyRegionalBenchmark() {
    try {
      if (typeof state === "undefined") return;
      const chart = state?.charts?.["city-bubble"];
      if (!chart?.data?.datasets?.length) return;

      const data = chart.data.datasets[0]?.data || [];
      let changed = false;

      data.forEach(point => {
        if (point && Number(point.r) !== 7) {
          point.r = 7;
          changed = true;
        }
      });

      if (chart.options?.scales?.x?.title) {
        chart.options.scales.x.title.text =
          "Beneficiários ANS por leito privado (maior = maior pressão assistencial)";
      }

      if (chart.options?.plugins?.tooltip?.callbacks) {
        chart.options.plugins.tooltip.callbacks.label = context => {
          const point = context.raw || {};
          return [
            `${point.label || "Município"}`,
            `Benef. ANS por leito privado: ${
              point.noPrivateBeds
                ? "sem leitos privados detectados"
                : Number(point.x || 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })
            }`,
            `Cobertura ANS: ${Number(point.y || 0).toLocaleString("pt-BR", {
              maximumFractionDigits: 1
            })}%`
          ];
        };
      }

      if (changed) chart.update("none");
    } catch (error) {
      console.warn("Falha ao uniformizar benchmark regional:", error);
    }
  }

  function updateCagrLabels() {
    ["city", "micro"].forEach(scope => {
      let years = null;

      try {
        const chart = typeof state !== "undefined"
          ? state?.charts?.[`${scope}-leitos-priv-evol`]
          : null;

        const labels = (chart?.data?.labels || [])
          .map(Number)
          .filter(Number.isFinite)
          .sort((a, b) => a - b);

        if (labels.length >= 2) {
          years = labels[labels.length - 1] - labels[0];
        }
      } catch {}

      setKpiLabel(
        `${scope}-leitos-cagr`,
        years != null && years > 0
          ? `CAGR Leitos privados (${years} anos)`
          : "CAGR Leitos privados"
      );
    });
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
      setCompare(`${scope}-pop60-compare`, "—", "—");
      setCompare(`${scope}-ans-total-compare`, "—", "—");
      setCompare(`${scope}-ans-pct-compare`, "—", "—");
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

      const [populationMap, incomeMap, pop60Map, ansRefs] = await Promise.all([
        fetchPopulationByLocality(allIds),
        fetchIncomeByLocality(allIds),
        fetchPop60ByLocality(allIds),
        loadAnsReferences(refs)
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

      renderOperationalComparisons({
        city: currentCity,
        micro: currentMicro,
        caxiasCity,
        poaCity,
        caxiasMicro,
        poaMicro,
        ansRefs
      });

      refreshCityGrowth(cityId);
      simplifyRegionalBenchmark();
      updateCagrLabels();
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
      simplifyRegionalBenchmark();
      updateCagrLabels();

      const current = getCurrentIds();
      if (current.cityId) refreshCityGrowth(current.cityId);

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
    markHiddenSections();
    disableHospitalPhotoEnrichment();
    simplifyRegionalBenchmark();
    updateCagrLabels();
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
