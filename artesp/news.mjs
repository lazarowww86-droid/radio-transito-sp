// Notícias públicas: somente títulos, datas, fonte e links. Sem credenciais ARTESP.
export const NEWS_SOURCES = [
  { id: 'g1', name: 'G1', feed: 'https://g1.globo.com/rss/g1/', hosts: ['g1.globo.com'] },
  { id: 'metropoles', name: 'Metrópoles', feed: 'https://www.metropoles.com/feed', hosts: ['www.metropoles.com', 'metropoles.com'] },
  { id: 'terra', name: 'Terra', feed: 'https://www.terra.com.br/rss', hosts: ['www.terra.com.br', 'terra.com.br'] },
  { id: 'agencia-brasil', name: 'Agência Brasil', feed: 'https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml', hosts: ['agenciabrasil.ebc.com.br'] }
];
const INTERVAL = 30 * 60000, RETRY = 5 * 60000, MAX_AGE = 36 * 3600000, MAX_BYTES = 2 * 1024 * 1024;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function plainText(value) {
  const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (all, entity) => {
    if (entity[0] !== '#') return ENTITIES[entity.toLowerCase()] || all;
    const n = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
  });
  return decode(decode(String(value))).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}
function field(item, name) {
  const raw = item.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + name + '\\s*>', 'i'))?.[1] || '';
  return plainText(raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'));
}
export function parseNewsFeed(xml, source, now = Date.now()) {
  if (typeof xml !== 'string' || xml.length > MAX_BYTES || /<!DOCTYPE|<!ENTITY/i.test(xml) || !/<rss\b/i.test(xml) || !/<\/rss\s*>/i.test(xml)) throw new Error('Feed inválido');
  const items = [], seen = new Set();
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi)) {
    const title = field(match[1], 'title'), link = field(match[1], 'link'), published = Date.parse(field(match[1], 'pubDate'));
    if (title.length < 8 || title.length > 240 || !Number.isFinite(published) || now - published > MAX_AGE || published - now > 5 * 60000) continue;
    let url;
    try { url = new URL(link); } catch (_) { continue; }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || !source.hosts.includes(url.hostname)) continue;
    url.protocol = 'https:'; url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|src$|ref$)/i.test(key)) url.searchParams.delete(key);
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    items.push({ source: source.name, source_id: source.id, title, url: url.href, published_at: new Date(published).toISOString() });
  }
  return items.sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at)).slice(0, 2);
}
async function readBounded(response) {
  if (!response.body) throw new Error('Resposta vazia');
  const reader = response.body.getReader(), chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw new Error('Feed excede o limite');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  const data = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(data);
}
export class NewsGateway {
  constructor(storage, deps = {}) {
    this.storage = storage;
    this.fetcher = deps.fetch || ((...args) => globalThis.fetch(...args));
    this.now = deps.now || (() => Date.now());
    this.inFlight = null;
  }
  async get() {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.load().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }
  async load() {
    const now = this.now(), saved = await this.storage.get('radio-news-v1');
    if (saved && saved.nextAt > now) return saved.result;
    // Reserva persistente e independente do contador de solicitações da ARTESP.
    const waiting = { status: 503, body: { items: [], sources: [], updated_at: null, error: 'Notícias temporariamente indisponíveis.' } };
    await this.storage.put('radio-news-v1', { nextAt: now + RETRY, result: waiting });
    const results = await Promise.all(NEWS_SOURCES.map(async source => {
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await this.fetcher(source.feed, { signal: controller.signal, headers: { Accept: 'application/rss+xml, application/xml, text/xml', 'User-Agent': 'RadioTransitoSP/1.0' }, redirect: 'follow' });
        if (!response.ok) throw new Error('Fonte indisponível');
        const items = parseNewsFeed(await readBounded(response), source, now);
        return { source: source.name, source_id: source.id, available: items.length > 0, items };
      } catch (_) { return { source: source.name, source_id: source.id, available: false, items: [] }; }
      finally { clearTimeout(timeout); }
    }));
    const items = results.flatMap(result => result.items), result = {
      status: items.length ? 200 : 503,
      body: { items, sources: results.map(({ items, ...source }) => source), updated_at: items.length ? new Date(now).toISOString() : null,
        interval_minutes: 30, ...(items.length ? {} : { error: 'Nenhuma notícia recente disponível.' }) }
    };
    await this.storage.put('radio-news-v1', { nextAt: now + (items.length ? INTERVAL : RETRY), result });
    return result;
  }
}
