import { DurableObject } from 'cloudflare:workers';
import { TrafficGateway } from './traffic.mjs';

export class ArtespStore extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.gateway = new TrafficGateway(ctx.storage, env); }
  async snapshot() { return this.gateway.get(); }
}
const reply = (body, status, origin, retry) => {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff' };
  if (retry) headers['Retry-After'] = String(retry);
  return new Response(JSON.stringify(body), { status, headers });
};
export default {
  async fetch(request, env) {
    const origin = env.RADIO_ORIGIN || 'https://lazarowww86-droid.github.io';
    const caller = request.headers.get('Origin');
    if (caller && caller !== origin) return reply({ error: 'Origem não autorizada.' }, 403, origin);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Vary': 'Origin' } });
    if (request.method !== 'GET') return reply({ error: 'Método não permitido.' }, 405, origin);
    const url = new URL(request.url);
    if (url.pathname === '/') return reply({ service: 'Rádio Trânsito SP — ARTESP', revision: '20261013-artesp-r3', route: '/boletins', configured: Boolean(env.ARTESP_API_KEY && env.ARTESP_CACHE), interval_minutes: 15 }, 200, origin);
    if (url.pathname !== '/boletins') return reply({ error: 'Rota não encontrada.' }, 404, origin);
    if (url.search) return reply({ error: 'Os filtros são definidos no servidor. Use apenas /boletins.' }, 400, origin);
    if (!env.ARTESP_CACHE) return reply({ error: 'Configure o vínculo ARTESP_CACHE.', items: [], updated_at: null }, 503, origin);
    try {
      // Um único objeto para a rádio inteira: ouvintes de diferentes lugares compartilham a cota.
      const result = await env.ARTESP_CACHE.getByName('radio-occurrences-v1').snapshot();
      return reply(result.body, result.status, origin, result.retry);
    } catch (_) {
      return reply({ error: 'Serviço de boletins temporariamente indisponível.', items: [], updated_at: null }, 503, origin);
    }
  }
};
