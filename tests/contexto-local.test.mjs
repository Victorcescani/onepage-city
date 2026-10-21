import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler, { groundedResult } from '../api/contexto-local.js';
const candidate = {
  finishReason: 'STOP',
  content: { parts: [{ text: 'Atividade produtiva documentada.\n\nInstituição regional documentada.' }] },
  groundingMetadata: {
    webSearchQueries: ['cidade UF economia'],
    groundingChunks: [{ web: { uri: 'https://example.org/a', title: 'Fonte A' } }, { web: { uri: 'https://example.com/b', title: 'Fonte B' } }],
    groundingSupports: [{ segment: { text: 'Atividade produtiva documentada.' }, groundingChunkIndices: [0] }, { segment: { text: 'Instituição regional documentada.' }, groundingChunkIndices: [1] }]
  }
};
function response() {
  return { statusCode: 200, headers: {}, setHeader(k,v){this.headers[k]=v;}, status(v){this.statusCode=v;return this;}, json(v){this.body=v;return this;} };
}
test('grounding requires complete text, actual search and evidence in each paragraph', () => {
  assert.equal(groundedResult(candidate).sources.length, 2);
  assert.throws(() => groundedResult({ ...candidate, finishReason: 'MAX_TOKENS' }));
  const noSearch = structuredClone(candidate); noSearch.groundingMetadata.webSearchQueries = [];
  assert.throws(() => groundedResult(noSearch));
  const unsafe = structuredClone(candidate); unsafe.groundingMetadata.groundingChunks[1].web.uri='javascript:alert(1)';
  assert.throws(() => groundedResult(unsafe));
  const noEvidence = structuredClone(candidate); noEvidence.groundingMetadata.groundingSupports.pop();
  assert.throws(() => groundedResult(noEvidence));
});
test('endpoint validates identity, handles absent key, coalesces requests and caches', async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  try {
    delete process.env.GEMINI_API_KEY;
    let res = response(); await handler({ method:'GET', query:{ibge:'4316808'} },res);
    assert.equal(res.statusCode,503); assert.equal(res.headers['Cache-Control'],'no-store');
    res = response(); await handler({method:'GET',query:{ibge:'4316808',prompt:'injection'}},res); assert.equal(res.statusCode,400);
    res = response(); await handler({method:'POST',query:{ibge:'4316808'}},res); assert.equal(res.statusCode,405);
    process.env.GEMINI_API_KEY='test-only';
    let calls=0;
    global.fetch=async (url, options) => {
      calls++;
      if(url.includes('ibge.gov.br')) return {ok:true,json:async()=>({id:4316808,nome:'Santa Cruz do Sul',microrregiao:{mesorregiao:{UF:{sigla:'RS'}}}})};
      const body=JSON.parse(options.body);
      assert.match(body.contents[0].parts[0].text,/Santa Cruz do Sul, RS, Brasil, código IBGE 4316808/);
      assert.deepEqual(body.tools,[{google_search:{}}]);
      return {ok:true,json:async()=>({candidates:[candidate]})};
    };
    const a=response(),b=response();
    await Promise.all([handler({method:'GET',query:{ibge:'4316808'}},a),handler({method:'GET',query:{ibge:'4316808'}},b)]);
    assert.equal(calls,2); assert.equal(a.statusCode,200); assert.deepEqual(a.body,b.body);
    assert.match(a.headers['Vercel-CDN-Cache-Control'],/s-maxage=/);
    res=response(); await handler({method:'GET',query:{ibge:'4316808'}},res); assert.equal(calls,2);
    res=response(); await handler({method:'GET',query:{ibge:'4305108'}},res); assert.equal(res.statusCode,404);
  } finally { global.fetch=originalFetch; if(originalKey===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=originalKey; }
});
