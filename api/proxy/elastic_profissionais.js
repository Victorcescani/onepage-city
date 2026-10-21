import { medicosPorCidade } from "../_lib/elastic.js";

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
