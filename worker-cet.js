// Rádio Trânsito SP — consulta experimental à página pública da CET.
// Não é API oficial. Confirme permissão de coleta automatizada antes de publicar amplamente.
const CET = 'https://www.cetsp.com.br/';
const REGIONS = ['Norte','Oeste','Centro','Leste','Sul'];
const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, OPTIONS','Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=900'};
const reply = (data,status=200) => new Response(JSON.stringify(data,null,2),{status,headers:cors});
function clean(s){return s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<!--([\s\S]*?)-->/g,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/\s+/g,' ').trim()}
function extract(html){
 const start=html.search(/Trânsito Agora/i);
 if(start<0)throw new Error('Seção Trânsito Agora não localizada');
 const section=clean(html.slice(start,start+25000));
 const found={};
 for(const region of REGIONS){
  const re=new RegExp('(?:^|\\s)'+region+'\\s+(?:Lentidão\\s*:?\\s*)?(\\d{1,4}(?:[.,]\\d+)?)\\s*km(?:\\s*de\\s*lentid[aã]o)?','i');
  const m=section.match(re);if(m){const km=Number(m[1].replace(',','.'));if(km>=0&&km<2000)found[region]=km}
 }
 if(Object.keys(found).length!==5)throw new Error('Formato CET não reconhecido: '+Object.keys(found).join(','));
 return found;
}
export default {
 async fetch(request){
  if(request.method==='OPTIONS')return new Response(null,{headers:cors});
  if(request.method!=='GET')return reply({error:'Método não permitido'},405);
  const path=new URL(request.url).pathname;
  if(path!=='/'&&path!=='/boletins')return reply({error:'Rota não encontrada'},404);
  try{
   const r=await fetch(CET,{headers:{'Accept':'text/html','User-Agent':'RadioTransitoSP/0.3 (+projeto experimental)'},signal:AbortSignal.timeout(12000),cf:{cacheTtl:900,cacheEverything:true}});
   if(!r.ok)throw new Error('CET retornou HTTP '+r.status);
   const html=await r.text();const regions=extract(html);
   const total=Object.values(regions).reduce((a,b)=>a+b,0);
   const items=[`Segundo o painel público da CET, há ${total.toLocaleString('pt-BR')} quilômetros de lentidão somados nas cinco regiões monitoradas da capital.`,...Object.entries(regions).map(([region,km])=>`Região ${region}: ${km.toLocaleString('pt-BR')} quilômetros de lentidão.`)];
   return reply({source:'CET São Paulo — painel público',source_url:CET,updated_at:new Date().toISOString(),retrieved_at:new Date().toISOString(),data_timestamp_verified:false,items,regions,notice:'Horário da coleta, não da medição CET. Coleta experimental; confira permissão de reutilização.'});
  }catch(e){return reply({error:'Fonte indisponível ou formato alterado',detail:String(e.message),updated_at:null,items:[]},503)}
 }
};
