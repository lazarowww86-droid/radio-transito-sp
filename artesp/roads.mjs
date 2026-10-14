// Fontes públicas independentes da API de ocorrências e de sua cota.
export const SOURCES = [
 {id:'artesp',name:'ARTESP Tráfego',url:'https://ccm.artesp.sp.gov.br/rodovias/trafego'},
 {id:'leste',name:'Ecovias Leste Paulista',url:'https://www.ecoviaslestepaulista.com.br/noticias/boletins-de-trafego'},
 {id:'imigrantes',name:'Ecovias Imigrantes',url:'https://www.ecoviasimigrantes.com.br/noticias/boletins-de-trafego'}
];
export const MAX_AGE=90*60000;
const accents={ccedil:'ç',atilde:'ã',otilde:'õ',aacute:'á',eacute:'é',iacute:'í',oacute:'ó',uacute:'ú',acirc:'â',ecirc:'ê',ocirc:'ô',agrave:'à',uuml:'ü',nbsp:' ',amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'};
export function text(value){return String(value).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<[^>]*>/g,' ').replace(/&(#x[\da-f]+|#\d+|\w+);/gi,(all,k)=>{if(k[0]==='#'){const n=k[1].toLowerCase()==='x'?parseInt(k.slice(2),16):Number(k.slice(1));return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):'';}const v=accents[k.toLowerCase()];return v?(k[0]===k[0].toUpperCase()?v.toUpperCase():v):all;}).replace(/\s+/g,' ').trim();}
export function fresh(date,now){const t=Date.parse(date);return Number.isFinite(t)&&now-t<=MAX_AGE&&t-now<=120000;}
function dateBR(raw){const s=text(raw);let m=s.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);if(m)return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00-03:00`;m=s.match(/(\d{1,2}) de (\w+) de (\d{4}) às (\d{2}):(\d{2})/);if(!m)return '';const month=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'].indexOf(m[2].toLowerCase())+1;return month?`${m[3]}-${String(month).padStart(2,'0')}-${m[1].padStart(2,'0')}T${m[4]}:${m[5]}:00-03:00`:'';}
const attr=(s,k)=>text(s.match(new RegExp('\\b'+k+'\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))','i'))?.slice(1).find(v=>v!==undefined)||'');
function item(source,title,summary,date,url){title=title.slice(0,150);summary=summary.slice(0,420);return {id:`${source.id}:${url}:${date}:${title}:${summary}`,source_id:source.id,source:source.name,title:title.slice(0,150),summary:summary.slice(0,420),published_at:new Date(date).toISOString(),url};}
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
   const summary=[condition,km1?`Quilômetros ${km1}${km2?' a '+km2:''}`:'',cause&&cause!=='—'?`Causa: ${cause}`:'',field('comentario')].filter(Boolean).join('. ');
   if(summary)items.push(item(source,`${name}${direction?' — '+direction:''}`,summary,date,source.url));
  }
 }
 // Trechos sem horário próprio não são apresentados como trânsito normal atualizado.
 return items.sort((a,b)=>Date.parse(b.published_at)-Date.parse(a.published_at)).slice(0,3);
}
export function articleURL(html,source,now=Date.now()){
 for(const m of html.matchAll(/<a\b[^>]*href=(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi)){
  const date=dateBR(m[4]);if(!fresh(date,now))continue;
  const url=new URL(text(m[1]||m[2]||m[3]),source.url);if(url.origin===new URL(source.url).origin&&url.pathname.startsWith('/noticias/boletins-de-trafego/'))return url.href;
 }return null;
}
export function parseEco(html,source,url,now=Date.now()){
 if(new URL(url).origin!==new URL(source.url).origin)throw new Error('Origem inválida');
 const content=html.match(/<div\b[^>]*class="[^"]*html-content[^\"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1]||'';
 const date=dateBR(content),title=text(content.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1]||'');
 const paragraphs=[...content.matchAll(/<p\b([^>]*)>([\s\S]*?)(?=<p\b|<\/p>|$)/gi)].filter(m=>!/(?:class\s*=\s*["']?date)/i.test(m[1])).map(m=>text(m[2])).filter(Boolean);
 if(!title||!paragraphs.length||!fresh(date,now))return [];
 return [item(source,title,paragraphs.join(' ').slice(0,420),date,url)];
}
async function download(url){
 const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(10000),headers:{Accept:'text/html'}});if(!response.ok)throw new Error('Fonte indisponível');
 const reader=response.body.getReader();let size=0,body='',decoder=new TextDecoder();try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2*1024*1024)throw new Error('Página excessiva');body+=decoder.decode(value,{stream:true});}return body+decoder.decode();}finally{await reader.cancel().catch(()=>{});}
}
export class RoadsGateway{
 constructor(storage,{fetchPage=download,now=()=>Date.now()}={}){this.storage=storage;this.fetchPage=fetchPage;this.now=now;this.pending=null;}
 async get(){if(this.pending)return this.pending;this.pending=this.load();try{return await this.pending;}finally{this.pending=null;}}
 async load(){const now=this.now(),cached=await this.storage.get('roads-public-v1');if(cached&&now-cached.checked<300000)return this.result(cached,now);
 const sources=await Promise.all(SOURCES.map(async source=>{try{const html=await this.fetchPage(source.url);let items;if(source.id==='artesp')items=parseArtesp(html,now);else{const url=articleURL(html,source,now);items=url?parseEco(await this.fetchPage(url),source,url,now):[];}return {...source,status:items.length?'ok':'no_recent',items};}catch(_){return {...source,status:'unavailable',items:[]};}}));
 const value={checked:now,sources};await this.storage.put('roads-public-v1',value);return this.result(value,now);}
 result(value,now){const sources=value.sources.map(s=>{const items=s.items.filter(i=>fresh(i.published_at,now));return {...s,items,status:s.status==='ok'&&!items.length?'no_recent':s.status};});return {status:200,body:{checked_at:new Date(value.checked).toISOString(),sources:sources.map(({items,...s})=>s),items:sources.flatMap(s=>s.items)}};}
}
