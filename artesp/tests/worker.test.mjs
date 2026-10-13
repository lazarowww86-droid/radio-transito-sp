import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({resolve(specifier, context, next){return specifier==='cloudflare:workers'?{url:new URL('./cloudflare-stub.mjs',import.meta.url).href,shortCircuit:true}:next(specifier,context);}});
const { default: worker } = await import('../worker.mjs');
const origin='https://lazarowww86-droid.github.io';
function state(result={status:200,body:{items:['Boletim fictício.'],updated_at:'2026-10-13T15:00:00Z'}}){
 const env={ARTESP_API_KEY:'CHAVE_FICTICIA_PARA_TESTES',RADIO_ORIGIN:origin,ARTESP_CACHE:{getByName(name){assert.equal(name,'radio-occurrences-v1');return{async snapshot(){env.calls++;return result;}}}},calls:0};return env;
}
test('status permite verificar configuração sem consultar a ARTESP',async()=>{
 const env=state(),r=await worker.fetch(new Request('https://worker.test/'),env);const json=await r.json();assert.equal(json.configured,true);assert.equal(env.calls,0);assert.ok(!JSON.stringify(json).includes(env.ARTESP_API_KEY));
});
test('boletim compatível e CORS autorizam o GitHub Pages da rádio',async()=>{
 const env=state(),r=await worker.fetch(new Request('https://worker.test/boletins',{headers:{Origin:origin}}),env);assert.equal(r.status,200);assert.equal(env.calls,1);assert.equal(r.headers.get('Access-Control-Allow-Origin'),origin);assert.equal(r.headers.get('Cache-Control'),'no-store');
});
test('outra origem não consome chamada nem recebe autorização CORS',async()=>{
 const env=state(),r=await worker.fetch(new Request('https://worker.test/boletins',{headers:{Origin:'https://outro.test'}}),env);assert.equal(r.status,403);assert.equal(env.calls,0);assert.notEqual(r.headers.get('Access-Control-Allow-Origin'),'https://outro.test');
});
test('OPTIONS, POST e rotas desconhecidas não consultam a API',async()=>{
 const env=state();
 for(const[request,status]of[[new Request('https://worker.test/boletins',{method:'OPTIONS',headers:{Origin:origin}}),204],[new Request('https://worker.test/boletins',{method:'POST'}),405],[new Request('https://worker.test/admin'),404]])assert.equal((await worker.fetch(request,env)).status,status);
 assert.equal(env.calls,0);
});
test('filtros e tentativa de forçar atualização pela URL são rejeitados',async()=>{
 const env=state(),r=await worker.fetch(new Request('https://worker.test/boletins?force=1'),env);assert.equal(r.status,400);assert.equal(env.calls,0);
});
test('sem vínculo retorna erro controlado',async()=>{
 const r=await worker.fetch(new Request('https://worker.test/boletins'),{});assert.equal(r.status,503);assert.deepEqual((await r.json()).items,[]);
});
test('falha da fonte mantém contrato de erro e Retry-After',async()=>{
 const env=state({status:503,retry:300,body:{error:'Fonte indisponível.',items:[],updated_at:null}});const r=await worker.fetch(new Request('https://worker.test/boletins'),env);assert.equal(r.status,503);assert.equal(r.headers.get('Retry-After'),'300');assert.deepEqual((await r.json()).items,[]);
});
test('erro interno não expõe mensagens com credenciais',async()=>{
 const env=state();env.ARTESP_CACHE.getByName=()=>{throw new Error(env.ARTESP_API_KEY)};
 const r=await worker.fetch(new Request('https://worker.test/boletins'),env);assert.equal(r.status,503);assert.ok(!(await r.text()).includes(env.ARTESP_API_KEY));
});
