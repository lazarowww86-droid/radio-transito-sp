// Adaptador do produto Ocorrências Rodoviárias. Não recebe credenciais do navegador.
export const API_URL = 'https://ccm.artesp.sp.gov.br/rodovias/api/ocorrencias/';
export const SOURCE_URL = 'https://ccm.artesp.sp.gov.br/';
export const LICENSE_URL = 'https://creativecommons.org/licenses/by-nc/4.0/';
export const INTERVAL = 15 * 60000;
export const MIN_INTERVAL = 5 * 60000 + 1000;
export const HOUR = 3600000;
export const MAX_CALLS = 12;
const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const text = (value, max = 90) => typeof value === 'string' ? value.replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const stamp = value => typeof value === 'string' && /(Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
const km = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 10000;
const parts = time => Object.fromEntries(formatter.formatToParts(new Date(time)).map(p => [p.type, p.value]));
const dateKey = time => { const p = parts(time); return `${p.year}-${p.month}-${p.day}`; };

export function settings(env = {}) {
  const municipalities = String(env.ARTESP_MUNICIPIOS ?? '3550308,3518800').trim();
  const roads = String(env.ARTESP_RODOVIAS || '').trim();
  if (municipalities && !/^\d{7}(,\d{7})*$/.test(municipalities)) throw new Error('INVALID_SETTINGS');
  if (roads && !/^[a-z0-9-]+(,[a-z0-9-]+)*$/.test(roads)) throw new Error('INVALID_SETTINGS');
  return { municipalities, roads, region: text(env.ARTESP_REGIAO || 'São Paulo e Guarulhos', 90) };
}

export function apiURL(config, now = Date.now()) {
  const url = new URL(API_URL);
  // A API é histórica; o boletim usa só registros ativos conhecidos nos últimos sete dias.
  url.search = new URLSearchParams({ filtro_finalizada: '1', filtro_data_inicio: dateKey(now - 6 * 86400000), filtro_data_fim: dateKey(now), limit: '100', offset: '0' });
  if (config.municipalities) url.searchParams.set('filtro_municipio', config.municipalities);
  if (config.roads) url.searchParams.set('filtro_rodovia', config.roads);
  return url.href;
}

export function bulletin(payload, config, now = Date.now()) {
  const at = stamp(payload?.meta?.timestamp);
  if (!Number.isFinite(at) || now - at > 10 * 60000 || at - now > 60000) throw new Error('INVALID_TIMESTAMP');
  if (!Array.isArray(payload.results) || payload.results.length > 100 || !Number.isInteger(payload.meta.count) || payload.meta.count < payload.results.length || payload.meta.offset !== 0) throw new Error('INVALID_PAYLOAD');
  if (payload.meta.count > 0 && !payload.results.length) throw new Error('INVALID_PAYLOAD');
  const applied = payload.meta.filtros_aplicados?.filtro_finalizada;
  if (applied !== undefined && String(applied) !== '1') throw new Error('INVALID_FILTER');
  const allowed = new Set(config.municipalities.split(',').filter(Boolean));
  const allowedRoads = new Set(config.roads.split(',').filter(Boolean));
  const classes = new Set(['Acidente', 'Evento natural', 'Obra', 'Ocorrência']);
  const seen = new Set(), records = [];
  for (const row of payload.results) {
    if (row?.status !== 'ativa' || row.dt_hr_termino || !classes.has(row.classe)) continue;
    const road = text(row.rodovia?.nome, 60), roadSlug = text(row.rodovia?.slug, 60);
    if (!road || (allowedRoads.size && !allowedRoads.has(roadSlug)) || !Array.isArray(row.municipios)) continue;
    const cities = row.municipios.filter(c => !allowed.size || allowed.has(String(c?.cod_ibge))).map(c => text(c?.nome, 60)).filter(Boolean).slice(0, 2);
    if (!cities.length) continue;
    const id = text(row.slug, 50);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const subtype = row.classe === 'Acidente' ? text(row.tipo_ac || row.subclasse_ac, 60) : text(row.subclasse_oc, 60);
    const subject = subtype && !/^não se aplica$/i.test(subtype) ? subtype : row.classe;
    let location = '';
    if (km(row.km_inicial)) {
      location = km(row.km_final) && row.km_final > row.km_inicial ? `, entre os quilômetros ${number.format(row.km_inicial)} e ${number.format(row.km_final)}` : `, no quilômetro ${number.format(row.km_inicial)}`;
    }
    const direction = text(row.sentido, 30);
    const description = `${subject} na rodovia ${road}${location}, em ${cities.join(' e ')}${direction ? ', sentido ' + direction.toLocaleLowerCase('pt-BR') : ''}.`;
    records.push({ id, description, at: stamp(row.atualizado_em) || stamp(row.dt_hr_oc) || 0 });
  }
  // Não confunde resposta inválida, finalizados ou fora do recorte com ausência de ocorrências.
  if (payload.results.length && !records.length) throw new Error('NO_VALID_RECORDS');
  records.sort((a, b) => b.at - a.at);
  const p = parts(at), complete = payload.meta.count <= payload.results.length && records.length === payload.results.length;
  const intro = `Rádio Trânsito SP. Segundo a ARTESP, na consulta das ${+p.hour} horas e ${+p.minute} minutos, estes registros constavam como ativos nas rodovias monitoradas em ${config.region}.`;
  const items = records.length ? [intro, ...records.slice(0, 5).map(r => r.description)] : [`Segundo a ARTESP, a consulta das ${+p.hour} horas e ${+p.minute} minutos não retornou registros ativos no recorte de ${config.region}, conhecidos nos últimos sete dias.`];
  return { source: 'ARTESP — Centro de Controle Multimodal; Ocorrências Rodoviárias', source_url: SOURCE_URL, license: 'CC BY-NC 4.0', license_url: LICENSE_URL,
    updated_at: new Date(at).toISOString(), retrieved_at: new Date(now).toISOString(), timestamp_kind: 'consulta_oficial_api', data_timestamp_verified: true,
    region: config.region, period: 'Registros conhecidos nos últimos sete dias', complete, total_in_query: payload.meta.count, returned_records: records.length,
    notice: complete ? 'Seleção de até cinco registros; horário da consulta oficial, não da medição de velocidade.' : 'Seleção parcial de registros; horário da consulta oficial, não da medição de velocidade.', items };
}

export function retryDelay(value, now = Date.now()) {
  if (!value) return HOUR;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Math.min(24 * HOUR, Math.max(MIN_INTERVAL, Number.isFinite(delay) ? delay : HOUR));
}

export class TrafficGateway {
  constructor(storage, env, runtime = {}) {
    this.storage = storage; this.env = env;
    this.now = runtime.now || Date.now;
    // O runtime do Cloudflare exige que fetch mantenha o receptor global.
    this.fetch = runtime.fetch || globalThis.fetch.bind(globalThis);
    this.queue = Promise.resolve();
    this.ready = storage.get('gateway').then(value => { this.state = value || { attempts: [], nextAt: 0, snapshot: null, failure: null, config: '' }; });
  }
  get() {
    const job = this.queue.then(async () => { await this.ready; return this.update(); });
    this.queue = job.catch(() => {});
    return job;
  }
  async update() {
    const now = this.now(), state = this.state;
    const key = typeof this.env.ARTESP_API_KEY === 'string' ? this.env.ARTESP_API_KEY.trim() : '';
    if (!key || /^Api-Key\s/i.test(key) || /[\r\n]/.test(key)) return { status: 503, body: { error: 'Configure o segredo ARTESP_API_KEY com somente o valor da chave.', items: [], updated_at: null } };
    const config = settings(this.env), identity = JSON.stringify(config);
    if (identity !== state.config) { state.snapshot = null; state.config = identity; }
    if (state.snapshot && now >= Date.parse(state.snapshot.retrieved_at) && now - Date.parse(state.snapshot.retrieved_at) < INTERVAL) return { status: 200, body: state.snapshot };
    state.attempts = state.attempts.filter(at => at > now - HOUR && at <= now);
    const quotaAt = state.attempts.length >= MAX_CALLS ? state.attempts[0] + HOUR + 1000 : 0;
    const nextAt = Math.max(state.nextAt, quotaAt);
    if (now < nextAt) return { status: 503, retry: Math.ceil((nextAt - now) / 1000), body: { error: state.failure || 'Consulta compartilhada aguardando a próxima janela.', items: [], updated_at: null } };
    state.snapshot = null; state.failure = null; state.attempts.push(now); state.nextAt = now + MIN_INTERVAL;
    // Persiste a tentativa antes de acessar a API, inclusive em caso de timeout/reinício.
    await this.storage.put('gateway', state);
    let response;
    try {
      response = await this.fetch(apiURL(config, now), { headers: { Authorization: 'Api-Key ' + key, Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(8000), cache: 'no-store' });
      if (!response.ok) throw new Error('UPSTREAM_' + response.status);
      const length = response.headers.get('Content-Length');
      if (length && Number(length) > 2 * 1024 * 1024) throw new Error('RESPONSE_TOO_LARGE');
      const raw = await response.text();
      if (raw.length > 2 * 1024 * 1024) throw new Error('RESPONSE_TOO_LARGE');
      state.snapshot = bulletin(JSON.parse(raw), config, this.now());
      state.nextAt = this.now() + INTERVAL;
      if (response.headers.get('X-RateLimit-Remaining') === '0') state.nextAt = Math.max(state.nextAt, this.now() + retryDelay(response.headers.get('Retry-After'), this.now()));
    } catch (error) {
      state.snapshot = null;
      const code = error.message;
      state.failure = code === 'UPSTREAM_401' ? 'A ARTESP recusou a chave. Confira o segredo e o produto Ocorrências Rodoviárias.' :
        code === 'UPSTREAM_403' ? 'A ARTESP recusou o acesso. Confira os termos aceitos e as restrições de IP no portal.' :
        code === 'UPSTREAM_429' ? 'A cota da ARTESP foi atingida. A próxima consulta aguardará a liberação.' : 'A consulta da ARTESP falhou ou retornou dados inválidos.';
      if (code === 'UPSTREAM_429') state.nextAt = this.now() + retryDelay(response?.headers.get('Retry-After'), this.now());
      if (code === 'UPSTREAM_401' || code === 'UPSTREAM_403') state.nextAt = this.now() + INTERVAL;
    }
    await this.storage.put('gateway', state);
    return state.snapshot ? { status: 200, body: state.snapshot } : { status: 503, retry: Math.ceil((state.nextAt - this.now()) / 1000), body: { error: state.failure, items: [], updated_at: null } };
  }
}
