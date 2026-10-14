(function (global) {
'use strict';
const ENDPOINT = 'https://radio-transito-sp.lazarowww86.workers.dev/noticias';
const INTERVAL = 30 * 60000, MAX_AGE = 36 * 3600000;
const SOURCES = {
  g1: { name: 'G1', hosts: ['g1.globo.com'] },
  metropoles: { name: 'Metrópoles', hosts: ['metropoles.com', 'www.metropoles.com'] },
  terra: { name: 'Terra', hosts: ['terra.com.br', 'www.terra.com.br'] },
  'agencia-brasil': { name: 'Agência Brasil', hosts: ['agenciabrasil.ebc.com.br'] }
};
function validItem(item, now = Date.now()) {
  const source = SOURCES[item?.source_id], at = Date.parse(item?.published_at);
  if (!source || item.source !== source.name || typeof item.title !== 'string' || item.title.length < 8 || item.title.length > 240 || /[<>\u0000-\u001f]/.test(item.title) || !Number.isFinite(at) || now - at > MAX_AGE || at - now > 5 * 60000) return false;
  try {
    const url = new URL(item.url);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && source.hosts.includes(url.hostname);
  } catch (_) { return false; }
}
function parse(data, now = Date.now()) {
  const checked = Date.parse(data?.updated_at);
  if (!Array.isArray(data?.items) || !Number.isFinite(checked) || now - checked > 45 * 60000 || checked - now > 60000) throw new Error('Notícias desatualizadas');
  const seen = new Set(), counts = new Map();
  const items = data.items.filter(item => {
    if (!validItem(item, now) || seen.has(item.url) || (counts.get(item.source_id) || 0) >= 2) return false;
    seen.add(item.url); counts.set(item.source_id, (counts.get(item.source_id) || 0) + 1); return true;
  }).slice(0, 8).map(item => ({ source_id: item.source_id, source: item.source, title: item.title.trim(), url: item.url, published_at: item.published_at }));
  if (!items.length) throw new Error('Sem notícias recentes');
  return { items, checked };
}
function create(hooks) {
  const $ = id => document.getElementById(id);
  if (!$('news-panel') \vert{}\vert{} !$('news-list') || !$('news-speak') \vert{}\vert{} !$('news-status')) return null;
  let snapshot = null, inFlight = null, busy = false, nextCheck = 0, nextAt = null, interaction = 0, waitingSince = null;
  let seen = new Set();
  try {
    const value = JSON.parse(localStorage.getItem('radio_news_seen') || '[]');
    if (Array.isArray(value)) seen = new Set(value.filter(x => typeof x === 'string').slice(-200));
  } catch (_) {}
  const time = value => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  function fresh() { return snapshot && Date.now() - snapshot.checked <= 45 * 60000 && snapshot.items.some(item => validItem(item)); }
  function paint() {
    $('news-list').replaceChildren();
    if (!fresh()) return;
    for (const item of snapshot.items.filter(item => validItem(item))) {
      const article = document.createElement('article'), meta = document.createElement('p'), link = document.createElement('a');
      article.className = 'news-item'; meta.className = 'news-meta';
      meta.textContent = `${item.source} • ${time(item.published_at)}`;
      link.href = item.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = item.title;
      article.append(meta); article.append(link); $('news-list').append(article);
    }
  }
  function message(text) { $('news-status').textContent = text; }
  function updateDefaultMessage() {
    if (!fresh()) return;
    const available = new Set(snapshot.items.map(item => item.source_id)).size;
    message(`Manchetes consultadas em ${time(snapshot.checked)}.${available < 4 ? ' Algumas fontes estão temporariamente indisponíveis.' : ''}`);
  }
  function refresh() {
    if (inFlight) return inFlight;
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 12000);
    inFlight = (async () => {
      try {
        const response = await fetch(ENDPOINT, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Consulta indisponível');
        snapshot = parse(await response.json());
        nextCheck = Date.now() + INTERVAL;
        paint();
        updateDefaultMessage();
        return true;
      } catch (_) {
        nextCheck = Date.now() + 5 * 60000;
        paint();
        message(fresh() ? `Última consulta: ${time(snapshot.checked)}. Atualização temporariamente indisponível.` : 'Notícias temporariamente indisponíveis. A programação continua.');
        return false;
      } finally { clearTimeout(timeout); inFlight = null; }
    })();
    return inFlight;
  }
  function selection(manual) {
    if (!fresh()) return [];
    const selected = [], titles = new Set();
    for (const id of Object.keys(SOURCES)) {
      const item = snapshot.items.find(item => item.source_id === id && validItem(item) && (manual || !seen.has(item.url)) && !titles.has(item.title.toLocaleLowerCase('pt-BR')));
      if (item) { selected.push(item); titles.add(item.title.toLocaleLowerCase('pt-BR')); }
    }
    return selected;
  }
  async function bulletin(manual = false) {
    if (busy || !hooks.canAnnounce(manual)) {
      if (manual) message('Aguarde o boletim que está no ar terminar.');
      return false;
    }
    if (manual) hooks.unlockVoice?.();
    busy = true; $('news-speak').disabled = true;
    const token = interaction, listening = hooks.isListening();
    const stillValid = () => token === interaction && (manual ? !listening || hooks.isListening() : hooks.isListening());
    try {
      // Se for clique manual e já houver manchetes válidas na tela, não espera novo fetch()
      // para não perder a permissão de voz do navegador mobile (User Gesture).
      if (!fresh() || (!manual && Date.now() >= nextCheck)) {
        if (!await refresh()) return false;
      }
      const items = selection(manual);
      if (!items.length) { if (manual) message('Nenhuma manchete recente disponível.'); return false; }
      if (!stillValid() || !hooks.canAnnounce(manual)) return false;
      const phrases = ['Rádio Trânsito SP. Confira as manchetes.'];
      for (const item of items) phrases.push(`Segundo ${item.source}, ${item.title}.`);
      phrases.push('Mais informações nos links da nossa página. Rádio Trânsito SP.');
      if (manual) message('Lendo as manchetes em destaque…');
      const ok = await hooks.announce(phrases, stillValid);
      if (ok && stillValid()) {
        for (const item of items) seen.add(item.url);
        seen = new Set([...seen].slice(-200));
        try { localStorage.setItem('radio_news_seen', JSON.stringify([...seen])); } catch (_) {}
        updateDefaultMessage();
      } else if (manual && stillValid()) {
        message('A leitura por voz não está disponível no momento. Confira as manchetes no painel.');
      }
      return Boolean(ok);
    } finally { busy = false; $('news-speak').disabled = false; }
  }
  function tick() {
    if (!hooks.isListening()) { nextAt = null; waitingSince = null; return; }
    if (nextAt === null) { nextAt = Date.now() + INTERVAL; return; }
    if (Date.now() < nextAt || busy) return;
    if (!hooks.canAnnounce(false)) {
      waitingSince ||= Date.now();
      if (Date.now() - waitingSince < 5 * 60000) return;
      waitingSince = null; nextAt = Date.now() + INTERVAL; return;
    }
    waitingSince = null; nextAt = Date.now() + INTERVAL;
    bulletin(false).catch(() => {});
  }
  $('news-speak').addEventListener('click', () => bulletin(true).catch(() => message('Não foi possível ouvir as manchetes.')));
  for (const id of ['play', 'prev', 'next']) $(id)?.addEventListener('click', () => { interaction++; });
  refresh().catch(() => {});
  const timer = setInterval(() => { if (Date.now() >= nextCheck && !inFlight) refresh().catch(() => {}); tick(); }, 15000);
  return { refresh, bulletin, tick, snapshot: () => snapshot, destroy: () => clearInterval(timer) };
}
global.RadioNews = { create, parse, validItem };
})(window);
