// IMDb Charts Addon — Stremio / Nuvio
const https = require('https');

const cache = {};
const CACHE_MS = 1000 * 60 * 60 * 6;

// Fontes:
// - Top 250 filmes: JSON estável no GitHub (não bloqueia o Netlify)
// - Demais: IMDb com headers de browser (fallback regex)
const CHARTS = {
  imdb_top_movies: { type:'movie',  github:'https://raw.githubusercontent.com/theapache64/top250/master/top250_min.json', imdb:'https://www.imdb.com/chart/top/' },
  imdb_top_series: { type:'series', imdb:'https://www.imdb.com/chart/toptv/' },
  imdb_pop_movies: { type:'movie',  imdb:'https://www.imdb.com/chart/moviemeter/' },
  imdb_pop_series: { type:'series', imdb:'https://www.imdb.com/chart/tvmeter/' },
};

const manifest = {
  id:'community.imdb.charts.ptbr', version:'1.1.0', name:'IMDb Charts',
  description:'Fileiras do IMDb: Top 250 Filmes, Top 250 Séries, Filmes Populares e Séries Populares.',
  logo:'https://m.media-amazon.com/images/G/01/IMDb/BG_rectangle._CB1509060989_SY230_SX307_AL_.png',
  resources:['catalog'], types:['movie','series'], idPrefixes:['tt'],
  catalogs:[
    {type:'movie', id:'imdb_top_movies', name:'IMDb Top 250 Filmes'},
    {type:'series',id:'imdb_top_series', name:'IMDb Top 250 Séries'},
    {type:'movie', id:'imdb_pop_movies', name:'IMDb Filmes Populares'},
    {type:'series',id:'imdb_pop_series', name:'IMDb Séries Populares'},
  ],
};

function fetchUrl(url){
  return new Promise((resolve,reject)=>{
    const req=https.get(url,{headers:{
      'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36',
      'Accept':'text/html,application/xhtml+xml,application/json',
      'Accept-Language':'en-US,en;q=0.9',
    }},(res)=>{
      if(res.statusCode>=300&&res.statusCode<400&&res.headers.location) return resolve(fetchUrl(res.headers.location));
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(d));
    });
    req.on('error',reject);
    req.setTimeout(15000,()=>{req.destroy();reject(new Error('timeout'));});
  });
}

// Parse do JSON do GitHub (formato theapache64)
function parseGithub(text, type){
  let arr; try{arr=JSON.parse(text);}catch(e){return [];}
  if(!Array.isArray(arr)) return [];
  const metas=[];
  for(const it of arr){
    const m=(it.imdb_url||'').match(/(tt\d+)/);
    if(!m) continue;
    metas.push({
      id:m[1], type,
      name:it.name||'',
      poster:it.image_url||it.thumb_url||`https://images.metahub.space/poster/medium/${m[1]}/img`,
      posterShape:'poster',
      releaseInfo:it.year?String(it.year):undefined,
      imdbRating:it.rating?String(it.rating):undefined,
    });
  }
  return metas;
}

// Parse do __NEXT_DATA__ do IMDb
function parseNext(html, type){
  const metas=[];
  const m=html.match(/<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/s);
  if(!m) return metas;
  let j; try{j=JSON.parse(m[1]);}catch(e){return metas;}
  const pd=j?.props?.pageProps?.pageData||j?.props?.pageProps||{};
  const edges=pd?.chartTitles?.edges||pd?.chartList?.edges||pd?.titleListItemSearch?.edges||[];
  for(const e of edges){
    const n=e.node||e.listItem||e; if(!n||!n.id) continue;
    if(!/^tt\d+/.test(n.id)) continue;
    metas.push({
      id:n.id, type,
      name:n.titleText?.text||n.originalTitleText?.text||'',
      poster:n.primaryImage?.url||`https://images.metahub.space/poster/medium/${n.id}/img`,
      posterShape:'poster',
      releaseInfo:n.releaseYear?.year?String(n.releaseYear.year):undefined,
      imdbRating:n.ratingsSummary?.aggregateRating?String(n.ratingsSummary.aggregateRating):undefined,
    });
  }
  return metas;
}

// Fallback regex
function parseFallback(html, type){
  const ids=[]; const seen=new Set();
  const re=/\/title\/(tt\d+)\//g; let m;
  while((m=re.exec(html))!==null){ if(!seen.has(m[1])){seen.add(m[1]);ids.push(m[1]);} }
  return ids.slice(0,250).map(id=>({id,type,name:'',poster:`https://images.metahub.space/poster/medium/${id}/img`,posterShape:'poster'}));
}

async function getCatalog(key){
  const now=Date.now();
  if(cache[key]&&(now-cache[key].ts)<CACHE_MS) return cache[key].data;
  const ch=CHARTS[key]; if(!ch) return [];
  let metas=[];

  // 1) tenta fonte GitHub se houver
  if(ch.github){
    try{ const t=await fetchUrl(ch.github); metas=parseGithub(t,ch.type); }catch(e){}
  }
  // 2) tenta IMDb se ainda vazio
  if(!metas.length && ch.imdb){
    try{
      const html=await fetchUrl(ch.imdb);
      metas=parseNext(html,ch.type);
      if(!metas.length) metas=parseFallback(html,ch.type);
    }catch(e){}
  }

  if(metas.length) cache[key]={ts:now,data:metas};
  return metas;
}

exports.handler=async(event)=>{
  const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Content-Type':'application/json; charset=utf-8'};
  const h=event.headers||{};
  let path=h['x-nf-original-path']||h['x-original-uri']||event.rawUrl||event.path||'';
  try{ if(/^https?:\/\//.test(path)) path=new URL(path).pathname; }catch(e){}
  path=path.split('?')[0];
  path=path.replace(/^.*\/\.netlify\/functions\/addon/,'');
  if(path.includes('/manifest.json')) path='/manifest.json';
  if(!path||path==='/'||path==='/addon') path='/manifest.json';

  try{
    if(path==='/manifest.json') return {statusCode:200,headers:cors,body:JSON.stringify(manifest)};
    const cm=path.match(/\/catalog\/([^/]+)\/([^/.]+)(?:\.json)?$/);
    if(cm){
      const metas=await getCatalog(cm[2]);
      return {statusCode:200,headers:cors,body:JSON.stringify({metas})};
    }
    return {statusCode:404,headers:cors,body:JSON.stringify({err:'not found',path})};
  }catch(e){
    return {statusCode:200,headers:cors,body:JSON.stringify({metas:[],error:String(e)})};
  }
};
