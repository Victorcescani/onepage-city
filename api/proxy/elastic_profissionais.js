import { elasticSearch, medicosPorCidade } from "../_lib/elastic.js";

export default async function handler(req, res) {
  try {
    const ibge = String(req.query.ibge || "").replace(/\D/g, "");
    const comp = req.query.comp ? String(req.query.comp).replace(/\D/g, "") : undefined;

    if (!ibge) {
      return res.status(400).json({
        error: "Informe o parâmetro ibge.",
      });
    }

    if (req.query.debug === "page") {
      const rr = await fetch("https://elasticnes.saude.gov.br/profissionais", {
        headers: { "User-Agent": "pesquisa-cidade/1.0" },
      });
      const html = await rr.text();
      const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]);
      const links = [...html.matchAll(/<link[^>]+href=["']([^"']+)["']/gi)].map((m) => m[1]);
      return res.status(200).json({ status: rr.status, scripts, links });
    }

    if (req.query.debug === "elastic") {
      const debugIndex = String(req.query.index || "cnes-profissionais-202608").replace(/[^a-zA-Z0-9_*?,.-]/g, "");\n      const raw = await elasticSearch(debugIndex, { size: 1, query: { match_all: {} } });
      const rr = raw?.rawResponse;
      return res.status(200).json({
        debugIndex,\n        rawKeys: raw && typeof raw === "object" ? Object.keys(raw) : [],
        id: raw?.id ?? null,
        isPartial: raw?.isPartial ?? null,
        isRunning: raw?.isRunning ?? null,
        total: raw?.total ?? null,
        loaded: raw?.loaded ?? null,
        rawResponseType: rr == null ? null : typeof rr,
        rawResponseKeys: rr && typeof rr === "object" ? Object.keys(rr) : [],
        rawResponseError: rr?.error ?? null,
        rawResponseStatus: rr?.status ?? null,
        rawResponseHits: rr?.hits ? {
          total: rr.hits.total ?? null,
          count: Array.isArray(rr.hits.hits) ? rr.hits.hits.length : null,
          first: Array.isArray(rr.hits.hits) ? rr.hits.hits[0] ?? null : null,
        } : null,
      });
    }

    if (req.query.debug === "api") {
      const cod6 = ibge.length >= 6 ? ibge.slice(0, 6) : ibge;
      const target = "https://apidadosabertos.saude.gov.br/assistencia-a-saude/cnes-profissionais" +
        "?nu_comp=202608&co_ibge=" + encodeURIComponent(cod6) + "&limit=5&offset=0";
      const rr = await fetch(target, {
        headers: { Accept: "application/json", "User-Agent": "pesquisa-cidade/1.0" },
      });
      const payload = await rr.json();
      return res.status(200).json({
        upstreamStatus: rr.status,
        type: Array.isArray(payload) ? "array" : typeof payload,
        keys: payload && typeof payload === "object" && !Array.isArray(payload) ? Object.keys(payload) : [],
        sample: Array.isArray(payload) ? payload.slice(0, 2) : payload,
      });
    }

    const data = await medicosPorCidade(ibge, comp);

    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({
      error: String(e?.message || e),
    });
  }
}
