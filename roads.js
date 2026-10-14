(() => {
'use strict';
const ENDPOINT = 'https://radio-transito-sp.lazarowww86.workers.dev/rodovias';
const SOURCES = {
  artesp: ['ARTESP Tráfego', 'ccm.artesp.sp.gov.br'],
  renovias: ['Renovias', 'renovias.com.br'],
  'mobilidade-sampa': ['Mobilidade Sampa', 'mobilidadesampa.com.br']
};
const INTERVAL = 15 * 60000;
function fresh(item) {
  const at = Date.parse(item.published_at), age = Date.now() - at;
  return Number.isFinite(at) && age >= -120000 && age <= 90 * 60000;
}
function valid(item) {
  try {
    const source = SOURCES[item?.source_id], url = new URL(item.url);
    return Boolean(source && item.source === source[0] &&
      typeof item.id === 'string' && item.id.length > 0 && item.id.length < 1600 &&
      typeof item.title === 'string' && item.title.trim().length > 0 && item.title.length <= 150 &&
      typeof item.summary === 'string' && item.summary.trim().length > 0 && item.summary.length <= 420 &&
      !/[<>\u0000-\u001f]/.test(item.title + item.summary) &&
      url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      url.hostname === source[1] && fresh(item));
  } catch (_) { return false; }
}
const time = item => new Date(item.published_at).toLocaleString('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
});
window.RadioRoads = { create(hooks) {
  const $ = id => document.getElementById(id);
  const list = $('roads-list'), status = $('roads-status'), speak = $('roads-speak'), refresh = $('roads-refresh');
  if (!list || !status || !speak || !refresh) return null;
  let items = [], sources = [], loading = null, busy = false, revision = 0, nextAt = null;
  let seen = [];
  try {
    const stored = JSON.parse(localStorage.getItem('radio-roads-seen-v1') || '[]');
    if (Array.isArray(stored)) seen = stored.filter(x => typeof x === 'string').slice(-200);
  } catch (_) {}
  function render() {
    items = items.filter(fresh);
    list.replaceChildren();
    for (const item of items) {
      const card = document.createElement('article'); card.className = 'roads-item';
      const source = document.createElement('small');
      source.textContent = `${SOURCES[item.source_id][0]} • ${item.kind === 'news' ? 'Notícia publicada' : 'Painel atualizado'} em ${time(item)} (Brasília)`;
      const title = document.createElement('h3'); title.textContent = item.title;
      const summary = document.createElement('p'); summary.textContent = item.summary;
      const link = document.createElement('a'); link.href = item.url;
      link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Ver na fonte';
      card.append(source, title, summary, link); list.append(card);
    }
    for (const [id, [name]] of Object.entries(SOURCES)) {
      if (items.some(item => item.source_id === id)) continue;
      const p = document.createElement('p'); p.className = 'roads-source-status';
      p.textContent = `${name}: ${sources.find(s => s.id === id)?.status === 'unavailable' ? 'temporariamente indisponível' : 'sem boletim recente'}.`;
      list.append(p);
    }
    speak.disabled = busy || !items.length;
  }
  function load() {
    if (loading) return loading;
    refresh.disabled = true;
    loading = (async () => {
      try {
        const response = await fetch(ENDPOINT, { cache: 'no-store', signal: AbortSignal.timeout(25000) });
        if (!response.ok) throw new Error('Fonte indisponível');
        const data = await response.json(), seenIds = new Set();
        items = Array.isArray(data.items) ? data.items.filter(item => {
          if (!valid(item) || seenIds.has(item.id)) return false;
          seenIds.add(item.id); return true;
        }).slice(0, 5) : [];
        sources = Array.isArray(data.sources) ? data.sources.filter(s => s && SOURCES[s.id]) : [];
        status.textContent = 'Horários informados pelas fontes. Boletins com mais de 90 minutos não são exibidos.';
      } catch (_) {
        // Uma falha de consulta nunca transforma os dados em uma afirmação de trânsito livre.
        items = []; sources = Object.keys(SOURCES).map(id => ({ id, status: 'unavailable' }));
        status.textContent = 'Não foi possível consultar as fontes agora. A programação continua normalmente.';
      } finally { refresh.disabled = false; render(); }
    })().finally(() => { loading = null; });
    return loading;
  }
  async function announce(manual = false) {
    render();
    if (busy || !hooks.canAnnounce(manual)) {
      if (manual) status.textContent = 'Outro aviso está no ar. Aguarde para ouvir o boletim.';
      return false;
    }
    const selected = items.filter(item => fresh(item) && (manual || !seen.includes(item.id)));
    if (!selected.length) return false;
    const token = revision;
    const stillValid = () => token === revision && selected.every(fresh) && (manual || hooks.isListening());
    busy = true; speak.disabled = true;
    try {
      const phrases = ['Rádio Trânsito SP. Informações das rodovias.'];
      for (const item of selected) {
        const hour = new Date(item.published_at).toLocaleTimeString('pt-BR', {
          timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit'
        });
        if (item.kind === 'news') phrases.push(`Notícia publicada por ${SOURCES[item.source_id][0]} às ${hour}. Manchete: ${item.title}. Consulte os detalhes e atualizações no link da fonte.`);
        else phrases.push(`Segundo ${SOURCES[item.source_id][0]}, às ${hour}. ${item.title}. ${item.summary}.`);
      }
      const ok = await hooks.announce(phrases, stillValid);
      if (ok && stillValid()) {
        seen = [...new Set([...seen, ...selected.map(item => item.id)])].slice(-200);
        try { localStorage.setItem('radio-roads-seen-v1', JSON.stringify(seen)); } catch (_) {}
        nextAt = Date.now() + INTERVAL;
        status.textContent = 'Boletim concluído.';
        return true;
      }
      status.textContent = 'A leitura não foi concluída. As informações continuam disponíveis abaixo.';
      return false;
    } finally { busy = false; render(); }
  }
  function tick() {
    render();
    if (!hooks.isListening()) { nextAt = null; return; }
    if (nextAt === null) { nextAt = Date.now() + INTERVAL; return; }
    // Mantém o boletim pendente enquanto a fila de voz estiver ocupada.
    if (Date.now() < nextAt || busy || !hooks.canAnnounce(false)) return;
    nextAt = Date.now() + 60000;
    announce(false).catch(() => {});
  }
  speak.addEventListener('click', () => {
    hooks.unlockVoice?.();
    announce(true).catch(() => { status.textContent = 'Não foi possível ler o boletim agora.'; });
  });
  refresh.addEventListener('click', load);
  for (const id of ['play', 'prev', 'next']) $(id)?.addEventListener('click', () => { revision++; });
  const timers = [setInterval(tick, 15000), setInterval(load, 300000)];
  load();
  return { load, announce, tick, destroy: () => timers.forEach(clearInterval) };
} };
})();

