// Fontes públicas independentes da API de ocorrências e de sua cota.
export const SOURCES = [
 {id:'artesp',name:'ARTESP Tráfego',url:'https://ccm.artesp.sp.gov.br/rodovias/trafego'},
 {id:'renovias',name:'Renovias',url:'https://renovias.com.br/'},
 {id:'mobilidade-sampa',name:'Mobilidade Sampa',url:'https://mobilidadesampa.com.br/feed/'}
];
export const MAX_AGE=90*60000;
const accents={ccedil:'ç',atilde:'ã',otilde:'õ',aacute:'á',eacute:'é',iacute:'í',oacute:'ó',uacute:'ú',acirc:'â',ecirc:'ê',ocirc:'ô',agrave:'à',uuml:'ü',nbsp:' ',amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'};
export function text(value){return String(value).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<[^>]*>/g,' ').replace(/&(#x[\da-f]+|#\d+|\w+);/gi,(all,k)=>{if(k[0]==='#'){const n=k[1].toLowerCase()==='x'?parseInt(k.slice(2),16):Number(k.slice(1));return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):'';}const v=accents[k.toLowerCase()];return v?(k[0]===k[0].toUpperCase()?v.toUpperCase():v):all;}).replace(/\s+/g,' ').trim();}
export function fresh(date,now){const t=Date.parse(date);return Number.isFinite(t)&&now-t<=MAX_AGE&&t-now<=120000;}
function dateBR(raw){const s=text(raw);let m=s.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);if(m)return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00-03:00`;m=s.match(/(\d{1,2}) de (\w+) de (\d{4}) às (\d{2}):(\d{2})/);if(!m)return '';const month=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'].indexOf(m[2].toLowerCase())+1;return month?`${m[3]}-${String(month).padStart(2,'0')}-${m[1].padStart(2,'0')}T${m[4]}:${m[5]}:00-03:00`:'';}
const attr=(s,k)=>text(s.match(new RegExp('\\b'+k+'\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))','i'))?.slice(1).find(v=>v!==undefined)||'');
function item(source,title,summary,date,url){title=title.slice(0,150);summary=summary.slice(0,420);return {id:`${source.id}:${url}:${date}:${title}:${summary}`,source_id:source.id,source:source.name,kind:source.id==='mobilidade-sampa'?'news':'conditions',title:title.slice(0,150),summary:summary.slice(0,420),published_at:new Date(date).toISOString(),url};}
// O portal usa três casas decimais: 29,000 significa km 29, não 29 mil.
export function kilometre(value) {
 const match = /^(\d{1,4})(?:,(\d{1,3}))?$/.exec(String(value).trim());
 if (!match) return null;
 const km = Number(match[1]), metres = Number((match[2] || '').padEnd(3, '0'));
 return String(km) + (metres ? ` e ${metres} ${metres === 1 ? 'metro' : 'metros'}` : '');
}
export function kilometreRange(start, end) {
 const first = kilometre(start), last = kilometre(end);
 if (first === null) return '';
 return last === null || first === last ? `No quilômetro ${first}` : `Do quilômetro ${first} ao quilômetro ${last}`;
}
export function parseArtesp(html,now=Date.now()){
 const source=SOURCES[0],items=[];
 for(const card of html.split(/(?=<div\b[^>]*\sdata-rod-cod=)/i).slice(1)){
  const header=card.slice(0,card.indexOf('>')+1),name=attr(header,'data-rod-nome');if(!name)continue;
  const direction=text(card.match(/<span[^>]*class="[^"]*ml-auto[^\"]*rounded-full[^\"]*"[^>]*>([^<]+)<\/span>/i)?.[1]||'');
  for(const chunk of card.split(/(?=<div\b[^>]*class="trafego-container)/i).slice(1)){
   const field=k=>text(chunk.match(new RegExp('<span[^>]*data-trafego-'+k+'="[^"]+"[^>]*>([\\s\\S]*?)<\\/span>','i'))?.[1]||'');
   const date=dateBR(field('atualizado-em'));if(!fresh(date,now))continue;
   const condition=text(chunk.match(/tracking-wide[^>]*>[\s\S]*?<\/span>\s*([^<]+)/i)?.[1]||attr(header,'data-trafego'));
   const km1=field('km-inicial'),km2=field('km-final'),cause=field('causa');
   const summary=[condition,kilometreRange(km1,km2),cause&&cause!=='—'?`Causa: ${cause}`:'',field('comentario')].filter(Boolean).join('. ');
   if(summary)items.push(item(source,`${name}${direction?' — '+direction:''}`,summary,date,source.url));
  }
 }
 // Trechos sem horário próprio não são apresentados como trânsito normal atualizado.
 return items.sort((a,b)=>Date.parse(b.published_at)-Date.parse(a.published_at)).slice(0,3);
}
export function parseRenovias(html, now=Date.now()) {
 const source=SOURCES[1];
 const updated=text(html).match(/Última atualização em:\s*(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2})/i)?.[1];
 const date=dateBR(updated || '');
 if(!fresh(date,now))return [];
 // Somente alertas explicitamente publicados, sem deduzir trânsito livre pela ausência deles.
 for(const match of html.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)) {
  const summary=text(match[1]).replace(/^[^\p{L}\p{N}]+/u,'');
  if(/Atenção/i.test(summary)&&/\bSP-\d{2,3}\b/i.test(summary)&&summary.length<=420) {
   const result=item(source,'Condições nas rodovias da Renovias',summary,date,source.url);
   result.id=source.id+':'+summary; // O relógio do painel não deve repetir o mesmo alerta a cada consulta.
   return [result];
  }
 }
 return [];
}
function rssField(block, name) {
 const raw=block.match(new RegExp('<'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+name+'\\s*>','i'))?.[1]||'';
 return text(raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1'));
}
export function parseMobilityFeed(xml, now=Date.now()) {
 if(typeof xml!=='string'||xml.length>2*1024*1024||/<!DOCTYPE|<!ENTITY/i.test(xml)||!/<rss\b/i.test(xml)||!/<\/rss\s*>/i.test(xml))throw sourceError('invalid_feed');
 const source=SOURCES[2],items=[];
 for(const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
  const title=rssField(match[1],'title'),url=rssField(match[1],'link'),date=rssField(match[1],'pubDate');
  if(title.length<8||title.length>150||!fresh(date,now)||!/(rodovia|\bBR-\d|\bSP-\d|trânsito|rodízio|alagamento|interdi|congestionamento|túnel)/i.test(title))continue;
  let link;try{link=new URL(url);}catch(_){continue;}
  if(link.origin!=='https://mobilidadesampa.com.br'||link.username||link.password||link.port)continue;
  items.push(item(source,title,'Notícia de trânsito. Consulte detalhes e atualizações na publicação original.',date,link.href));
 }
 return items.sort((a,b)=>Date.parse(b.published_at)-Date.parse(a.published_at)).slice(0,1);
}
function sourceError(code) { const error = new Error('Fonte indisponível'); error.sourceCode = code; return error; }
export async function download(url){
 const original = new URL(url);
 if (!SOURCES.some(source => new URL(source.url).origin === original.origin) || original.protocol !== 'https:' || original.username || original.password) throw sourceError('origin_rejected');
 const signal = AbortSignal.timeout(10000);
 let target = original.href, response;
 for (let redirects = 0; redirects <= 3; redirects++) {
  response = await fetch(target, {redirect:'manual',signal,headers:{Accept:'text/html','User-Agent':'RadioTransitoSP/1.0'}});
  if (![301,302,303,307,308].includes(response.status)) break;
  const location = response.headers.get('Location');
  await response.body?.cancel().catch(() => {});
  if (!location || redirects === 3) throw sourceError('redirect_rejected');
  const next = new URL(location, target);
  if (next.protocol !== 'https:' || next.origin !== original.origin || next.username || next.password) throw sourceError('origin_rejected');
  target = next.href;
 }
 if(!response.ok)throw sourceError('http_' + response.status);
 const reader=response.body.getReader();let size=0,body='',decoder=new TextDecoder();try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2*1024*1024)throw sourceError('response_too_large');body+=decoder.decode(value,{stream:true});}return body+decoder.decode();}finally{await reader.cancel().catch(()=>{});}
}
export class RoadsGateway{
 constructor(storage,{fetchPage=download,now=()=>Date.now()}={}){this.storage=storage;this.fetchPage=fetchPage;this.now=now;this.pending=null;}
 async get(){if(this.pending)return this.pending;this.pending=this.load();try{return await this.pending;}finally{this.pending=null;}}
 async load(){const now=this.now(),cached=await this.storage.get('roads-public-v5');if(cached&&now-cached.checked<300000)return this.result(cached,now);
 const sources=await Promise.all(SOURCES.map(async source=>{let stage='index';try{const html=await this.fetchPage(source.url);let items;if(source.id==='artesp')items=parseArtesp(html,now);else if(source.id==='renovias')items=parseRenovias(html,now);else items=parseMobilityFeed(html,now);return {...source,status:items.length?'ok':'no_recent',items};}catch(error){const code = typeof error?.sourceCode === 'string' ? error.sourceCode : /^(TimeoutError|AbortError)$/.test(error?.name || '') ? 'timeout' : 'connection_or_processing_failed';return {...source,status:'unavailable',diagnostic:{stage,code},items:[]};}}));
 const value={checked:now,sources};await this.storage.put('roads-public-v5',value);return this.result(value,now);}
 result(value,now){const sources=value.sources.map(s=>{const items=s.items.filter(i=>fresh(i.published_at,now));return {...s,items,status:s.status==='ok'&&!items.length?'no_recent':s.status};});return {status:200,body:{checked_at:new Date(value.checked).toISOString(),sources:sources.map(({items,...s})=>s),items:sources.flatMap(s=>s.items)}};}
}



