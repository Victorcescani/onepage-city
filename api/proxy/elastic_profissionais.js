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
