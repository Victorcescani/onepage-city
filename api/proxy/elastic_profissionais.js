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


    if (req.query.debug === "api") {
      const cod6 = ibge.length >= 6 ? ibge.slice(0, 6) : ibge;
      const target = "https://apidadosabertos.saude.gov.br/assistencia-a-saude/cnes-profissionais" +
        "?co_ibge=" + encodeURIComponent(cod6) + "&limit=5&offset=0";
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      try {
        const rr = await fetch(target, {
          headers: { Accept: "application/json", "User-Agent": "pesquisa-cidade/1.0" },
          signal: controller.signal,
        });
        const reader = rr.body?.getReader();
        const first = reader ? await reader.read() : { value: null, done: true };
        if (reader) await reader.cancel().catch(() => {});
        const preview = first.value ? new TextDecoder().decode(first.value).slice(0, 5000) : "";
        clearTimeout(timer);
        return res.status(200).json({
          upstreamStatus: rr.status,
          contentType: rr.headers.get("content-type"),
          contentLength: rr.headers.get("content-length"),
          preview,
        });
      } finally {
        clearTimeout(timer);
      }
    }

    if (req.query.debug === "1" && comp) {
      const raw = await elasticSearch(`cnes-profissionais-${comp}`, { size: 1, query: { match_all: {} } });
      const hit = raw?.rawResponse?.hits?.hits?.[0] || null;
      return res.status(200).json({
        comp,
        totalHits: raw?.rawResponse?.hits?.total || null,
        source: hit?._source || null,
        fields: hit?.fields || null,\n        raw,
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
