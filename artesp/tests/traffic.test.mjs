import test from 'node:test';
import assert from 'node:assert/strict';
import { settings, apiURL, bulletin, TrafficGateway, INTERVAL, MIN_INTERVAL, HOUR, retryDelay } from '../traffic.mjs';
const NOW = Date.parse('2026-10-13T15:00:00Z');
const env = { ARTESP_API_KEY: 'CHAVE_FICTICIA_PARA_TESTES', RADIO_ORIGIN: 'https://lazarowww86-droid.github.io' };
const fixture = (now = NOW) => ({ meta: { timestamp: new Date(now).toISOString(), count: 1, offset: 0, filtros_aplicados: { filtro_finalizada: '1' } }, results: [{ slug: 'oc-teste', classe: 'Acidente', tipo_ac: 'Colisão traseira', status: 'ativa', dt_hr_termino: null,
  rodovia: { nome: 'SP-070', slug: 'sp-070' }, municipios: [{ cod_ibge: '3518800', nome: 'Guarulhos' }], km_inicial: 12.5, km_final: 13, sentido: 'LESTE', atualizado_em: new Date(now - 60000).toISOString() }] });
function storage() {
  const data = new Map();
  return { data, get: async k => structuredClone(data.get(k)), put: async (k, v) => { data.set(k, structuredClone(v)); } };
}
function gateway(extra = {}) {
  const disk = extra.disk || storage();
  const runtime = { at: NOW, calls: [], mode: 200, async fetch(url, options) {
    this.calls.push({url, options, at:this.at});
    return this.mode === 200 ? Response.json(fixture(this.at)) : new Response('erro', {status:this.mode,headers:{'Retry-After':'3600'}});
  }, ...extra.runtime };
  const instance = new TrafficGateway(disk, extra.env || env, { now: () => runtime.at, fetch: (url, options) => runtime.fetch(url, options) });
  return { instance, runtime, disk };
}
test('filtro ativo tem valor 1 e cidades/recorte corretos, sem incluir chave na URL', () => {
  const url = new URL(apiURL(settings(env), NOW));
  assert.equal(url.searchParams.get('filtro_finalizada'),'1');assert.equal(url.searchParams.get('filtro_municipio'),'3550308,3518800');
  assert.equal(url.searchParams.get('filtro_data_inicio'),'2026-10-07');assert.equal(url.searchParams.get('filtro_data_fim'),'2026-10-13');
  assert.equal(url.searchParams.get('limit'),'100');assert.ok(!url.href.includes(env.ARTESP_API_KEY));
});
test('contrato compatível com a rádio, km/município, origem e licença', () => {
  const data=bulletin(fixture(),settings(env),NOW);
  assert.equal(data.updated_at,new Date(NOW).toISOString());assert.equal(data.data_timestamp_verified,true);
  assert.ok(data.items[0].includes('ARTESP'));assert.ok(data.items[0].includes('12 horas'));
  assert.ok(data.items[1].includes('12,5'));assert.ok(data.items[1].includes('Guarulhos'));assert.ok(data.items[1].includes('leste'));
  assert.ok(data.items.every(x=>x.length<350));assert.equal(data.complete,true);assert.equal(data.timestamp_kind,'consulta_oficial_api');
  assert.equal(data.license,'CC BY-NC 4.0');assert.ok(!JSON.stringify(data).includes(env.ARTESP_API_KEY));
});
test('consulta vazia descreve o recorte, sem afirmar que o trânsito está normal', () => {
  const raw=fixture();raw.results=[];raw.meta.count=0;
  const data=bulletin(raw,settings(env),NOW);assert.equal(data.items.length,1);assert.ok(data.items[0].includes('últimos sete dias'));assert.ok(!data.items[0].includes('normal'));
});
test('finalizados, fora da região e registros inválidos não viram ausência de eventos', () => {
  const empty=fixture();empty.results=[];assert.throws(()=>bulletin(empty,settings(env),NOW),/INVALID_PAYLOAD/);
  for(const change of [r=>r.status='finalizada',r=>r.dt_hr_termino=new Date(NOW).toISOString(),r=>r.municipios[0].cod_ibge='3505708',r=>r.rodovia=null,r=>r.classe='Desconhecido']) {
    const raw=fixture();change(raw.results[0]);assert.throws(()=>bulletin(raw,settings(env),NOW),/NO_VALID_RECORDS/);
  }
});
test('timestamp da fonte ausente, velho, futuro ou sem fuso não é aceito', () => {
  for(const value of [null,'2026-10-13T12:00:00','2026-10-13T14:00:00Z','2026-10-13T16:00:00Z']) {
    const raw=fixture();raw.meta.timestamp=value;assert.throws(()=>bulletin(raw,settings(env),NOW),/INVALID_TIMESTAMP/);
  }
});
test('paginação parcial é declarada e eventos mais recentes têm prioridade', () => {
  const raw=fixture();raw.meta.count=120;raw.results.push({...structuredClone(raw.results[0]),slug:'oc-novo',tipo_ac:'Tombamento',atualizado_em:new Date(NOW).toISOString()});
  const data=bulletin(raw,settings(env),NOW);assert.equal(data.complete,false);assert.ok(data.items[1].includes('Tombamento'));assert.ok(data.notice.includes('parcial'));
});
test('100 ouvintes simultâneos fazem só uma chamada à ARTESP', async () => {
  const a=gateway();const replies=await Promise.all(Array.from({length:100},()=>a.instance.get()));
  assert.equal(a.runtime.calls.length,1);assert.ok(replies.every(r=>r.status===200));
  assert.equal(a.runtime.calls[0].options.headers.Authorization,'Api-Key '+env.ARTESP_API_KEY);
  assert.equal(a.runtime.calls[0].options.redirect,'manual');
});
test('redirecionamento da API não repassa a chave a outro destino', async () => {
  const a=gateway({runtime:{async fetch(url,options){this.calls.push({url,options});return new Response('destino privado', {status:302,headers:{Location:'https://outro.test/'}});}}});
  const result=await a.instance.get();assert.equal(result.status,503);assert.equal(a.runtime.calls.length,1);
  assert.equal(a.runtime.calls[0].options.redirect,'manual');assert.deepEqual(result.body.items,[]);
  assert.ok(!JSON.stringify(result).includes('destino privado'));assert.ok(!JSON.stringify(result).includes(env.ARTESP_API_KEY));
});
test('cache dura 15 minutos e sobreviver ao reinício não renova o horário dos dados', async () => {
  const a=gateway();const first=await a.instance.get();a.runtime.at+=INTERVAL-1;await a.instance.get();assert.equal(a.runtime.calls.length,1);
  const restored=gateway({disk:a.disk,runtime:{at:a.runtime.at}});const cached=await restored.instance.get();assert.equal(restored.runtime.calls.length,0);assert.equal(cached.body.updated_at,first.body.updated_at);
  restored.runtime.at+=1;await restored.instance.get();assert.equal(restored.runtime.calls.length,1);
});
test('cache não é reutilizado depois de mudar o recorte', async () => {
  const a=gateway();await a.instance.get();const restored=gateway({disk:a.disk,env:{...env,ARTESP_REGIAO:'Outro recorte'},runtime:{at:NOW+1000}});
  const result=await restored.instance.get();assert.equal(result.status,503);assert.equal(restored.runtime.calls.length,0);assert.deepEqual(result.body.items,[]);
});
test('sem chave ou com prefixo indevido não envia nenhuma chamada', async () => {
  for(const key of ['', 'Api-Key teste', 'teste\nsecreto']) {const a=gateway({env:{ARTESP_API_KEY:key}});assert.equal((await a.instance.get()).status,503);assert.equal(a.runtime.calls.length,0);}
});
test('401, 403 e 429 não devolvem payloads antigos nem conteúdo da resposta', async () => {
  for(const code of [401,403,429]) {
    const a=gateway();await a.instance.get();a.runtime.at+=INTERVAL;a.runtime.mode=code;
    const result=await a.instance.get();assert.equal(result.status,503);assert.deepEqual(result.body.items,[]);assert.equal(result.body.updated_at,null);
    const calls=a.runtime.calls.length;await a.instance.get();assert.equal(a.runtime.calls.length,calls);
  }
});
test('429 respeita Retry-After e não volta a consultar antes do prazo', async () => {
  const a=gateway();a.runtime.mode=429;await a.instance.get();a.runtime.at+=HOUR-1;
  await a.instance.get();assert.equal(a.runtime.calls.length,1);a.runtime.at+=1;await a.instance.get();assert.equal(a.runtime.calls.length,2);
});
test('respostas HTTP 200 com JSON inválido, carimbo vencido ou schema incorreto falham', async () => {
  for(const response of [new Response('html'),Response.json({meta:{},results:[]}),Response.json(fixture(NOW-HOUR))]) {
    const a=gateway({runtime:{async fetch(){this.calls.push({});return response.clone();}}});const result=await a.instance.get();assert.equal(result.status,503);assert.deepEqual(result.body.items,[]);
  }
});
test('tentativas com falha não podem ultrapassar 12 em uma hora', async () => {
  const a=gateway();a.runtime.mode=500;
  for(let n=0;n<80;n++){await a.instance.get();a.runtime.at+=MIN_INTERVAL;}
  for(const call of a.runtime.calls) assert.ok(a.runtime.calls.filter(other=>other.at>call.at-HOUR&&other.at<=call.at).length<=12);
  assert.ok(a.runtime.calls.length>12); // Confere várias janelas horárias, não só a primeira.
});
test('cota persistida com 12 tentativas bloqueia novas chamadas após reiniciar', async () => {
  const disk=storage();await disk.put('gateway',{attempts:Array.from({length:12},(_,i)=>NOW-10000-i*10000).reverse(),nextAt:0,snapshot:null,failure:null,config:JSON.stringify(settings(env))});
  const a=gateway({disk});assert.equal((await a.instance.get()).status,503);assert.equal(a.runtime.calls.length,0);
});
test('falha de armazenamento antes da chamada não consome credencial', async () => {
  const disk=storage();disk.put=async()=>{throw new Error('disk')};const a=gateway({disk});await assert.rejects(a.instance.get());assert.equal(a.runtime.calls.length,0);
});
test('timeout de rede registra tentativa e impede repetição imediata', async () => {
  const a=gateway({runtime:{async fetch(){this.calls.push({});throw new Error('timeout');}}});
  const first=await a.instance.get();assert.equal(first.status,503);await a.instance.get();assert.equal(a.runtime.calls.length,1);
  a.runtime.at+=MIN_INTERVAL;await a.instance.get();assert.equal(a.runtime.calls.length,2);
});
test('Retry-After aceita segundos/data e tem limites previsíveis',()=>{
  assert.equal(retryDelay('3600',NOW),HOUR);assert.equal(retryDelay('lixo',NOW),HOUR);assert.equal(retryDelay('-5',NOW),MIN_INTERVAL);
  assert.equal(retryDelay(new Date(NOW+HOUR).toUTCString(),NOW),HOUR);
});
