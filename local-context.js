(() => {
  const button = document.getElementById('local-context-button');
  const status = document.getElementById('local-context-status');
  const result = document.getElementById('local-context-result');
  const label = document.getElementById('local-context-city');
  const memory = new Map();
  let city = null;
  let controller = null;
  let version = 0;
  const key = id => `onepage-context-v1:${id}`;
  const valid = (data, id) => data?.city?.ibge === id && Date.parse(data.expiresAt) > Date.now() && Array.isArray(data.paragraphs) && Array.isArray(data.sources);
  const read = id => {
    let data = memory.get(id);
    try { data ||= JSON.parse(localStorage.getItem(key(id))); } catch {}
    return valid(data, id) ? data : null;
  };
  function sourceLink(source, text) {
    const a = document.createElement('a');
    a.textContent = text;
    try {
      const url = new URL(source.url);
      if (url.protocol !== 'https:') return document.createTextNode(text);
      a.href = url.href;
    } catch { return document.createTextNode(text); }
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  }
  function render(data) {
    result.replaceChildren();
    for (const text of data.paragraphs) {
      const p = document.createElement('p');
      p.textContent = text;
      const ids = new Set((data.citations || []).filter(c => text.includes(c.text)).flatMap(c => c.sources));
      for (const id of ids) {
        const source = data.sources.find(s => s.id === id);
        if (source) { p.append(' ', sourceLink(source, `[${id}]`)); }
      }
      result.append(p);
    }
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = `Fontes consultadas (${data.sources.length})`;
    const list = document.createElement('ol');
    for (const source of data.sources) {
      const li = document.createElement('li');
      li.append(sourceLink(source, source.title));
      list.append(li);
    }
    details.append(summary, list);
    result.append(details);
    if (data.searchSuggestions) {
      // Provider's mandatory Search Suggestions, isolated from the app DOM.
      const frame = document.createElement('iframe');
      frame.title = 'Sugestões de pesquisa do Google';
      frame.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');
      frame.setAttribute('referrerpolicy', 'no-referrer');
      frame.style.cssText = 'width:100%;height:110px;border:0;margin-top:12px';
      frame.srcdoc = '<meta http-equiv="Content-Security-Policy" content="default-src https: data:; script-src \'none\'; style-src \'unsafe-inline\' https:; form-action \'none\'"><base target="_blank">' + data.searchSuggestions;
      result.append(frame);
    }
    result.hidden = false;
    status.textContent = `Consulta: ${new Date(data.queriedAt).toLocaleString('pt-BR')} · Síntese por IA com fontes públicas. Cache por município por até 7 dias. Não interfere no IQM.`;
  }
  window.localContext = {
    reset() {
      version++;
      controller?.abort();
      city = null;
      button.disabled = true;
      button.textContent = 'Analisar contexto local';
      result.hidden = true;
      result.replaceChildren();
      label.textContent = 'Selecionando município…';
      status.textContent = 'Pesquisa sob demanda em fontes públicas. Não interfere no IQM.';
    },
    select(value) {
      city = { ...value };
      label.textContent = `${city.name} · ${city.uf} · IBGE ${city.id}`;
      button.disabled = false;
    }
  };
  button.addEventListener('click', async () => {
    if (!city) return;
    const selected = city.id;
    const currentVersion = version;
    const saved = read(selected);
    if (saved) { render(saved); return; }
    button.disabled = true;
    button.textContent = 'Pesquisando fontes…';
    result.hidden = true;
    status.textContent = 'Consultando fontes públicas e preparando a síntese. Pode levar até um minuto.';
    controller = new AbortController();
    const requestController = controller;
    const timer = setTimeout(() => requestController.abort(), 65000);
    try {
      const response = await fetch(`/api/contexto-local?ibge=${encodeURIComponent(selected)}`, { signal: requestController.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Pesquisa indisponível. Tente novamente.');
      if (!valid(data, selected)) throw new Error('Resposta inconsistente para o município selecionado. Tente novamente.');
      memory.set(selected, data);
      try { localStorage.setItem(key(selected), JSON.stringify(data)); } catch {}
      if (currentVersion === version) render(data);
    } catch (error) {
      if (currentVersion === version) status.textContent = error.name === 'AbortError' ? 'A pesquisa excedeu o tempo de espera. Tente novamente.' : error.message;
    } finally {
      clearTimeout(timer);
      if (currentVersion === version) {
        button.disabled = false;
        button.textContent = 'Analisar contexto local';
      }
    }
  });
})();
