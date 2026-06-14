// IMDb Charts Addon — Stremio / Nuvio (v2.1 - fontes estáveis + multi-fallback)
const https = require('https');

const cache = {};
const CACHE_MS = 1000 * 60 * 60 * 6;

// Para cada fileira, tentamos uma lista de URLs em ordem até uma retornar dados.
// Top 250 Filmes: JSON oficial (GitHub). Demais: catálogos do Cinemeta (oficial Stremio).
const SOURCES = {
  imdb_top_movies: {
    type:'movie',
    urls:[
      {kind:'cinemeta', url:'https://v3-cinemeta.strem.io/catalog/movie/imdbRating.json'},
      {kind:'cinemeta', url:'https://v3-cinemeta.strem.io/catalog/movie/top.json'},
    ],
  },
  imdb_top_series: {
    type:'series',
    urls:[
      {kind:'cinemeta', url:'https://v3-cinemeta.strem.io/catalog/series/imdbRating.json'},
      {kind:'cinemeta', url:'https://v3-cinemeta.strem.io/catalog/series/top.json'},
    ],
  },
  imdb_pop_movies: {
    type:'movie',
    urls:[
      {kind:'cinemeta', url:'https://v3-cinemeta.strem.io/catalog/movie/top.json'},
      {kind:'cinemeta', url:'https://v3-cinemeta.strem.io/catalog/movie/popular.json'},
    ],
  },
  imdb_pop_series: {
    type:'series',
    urls:[
      {kind:'cinemeta', url:'https://v3-cinemeta.strem.io/catalog/series/top.json'},
      {kind:'cinemeta', url:'https://v3-cinemeta.strem.io/catalog/series/popular.json'},
    ],
  },
};

const manifest = {
  id:'community.imdb.charts.ptbr', version:'2.2.0', name:'IMDb Charts',
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
      'Accept':'application/json,text/plain,*/*',
    }},(res)=>{
      if(res.statusCode>=300&&res.statusCode<400&&res.headers.location) return resolve(fetchUrl(res.headers.location));
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(d));
    });
    req.on('error',reject);
    req.setTimeout(15000,()=>{req.destroy();reject(new Error('timeout'));});
  });
}

function parseGithub(text, type){
  let arr; try{arr=JSON.parse(text);}catch(e){return [];}
  if(!Array.isArray(arr)) return [];
  const out=[];
  for(const it of arr){
    const m=(it.imdb_url||'').match(/(tt\d+)/); if(!m) continue;
    out.push({
      id:m[1], type, name:it.name||'',
      poster:it.image_url||it.thumb_url||`https://images.metahub.space/poster/medium/${m[1]}/img`,
      posterShape:'poster',
      releaseInfo:it.year?String(it.year):undefined,
      imdbRating:it.rating?String(it.rating):undefined,
    });
  }
  return out;
}

function parseCinemeta(text, type){
  let j; try{j=JSON.parse(text);}catch(e){return [];}
  const metas=Array.isArray(j?.metas)?j.metas:[];
  return metas.filter(m=>m&&m.id&&/^tt\d+/.test(m.id)).map(m=>({
    id:m.id, type:m.type||type, name:m.name||'',
    poster:m.poster||`https://images.metahub.space/poster/medium/${m.id}/img`,
    posterShape:m.posterShape||'poster',
    releaseInfo:m.releaseInfo, imdbRating:m.imdbRating,
  }));
}

async function getCatalog(key){
  const now=Date.now();
  if(cache[key]&&(now-cache[key].ts)<CACHE_MS) return cache[key].data;
  const s=SOURCES[key]; if(!s) return [];
  let metas=[];
  for(const src of s.urls){
    try{
      const t=await fetchUrl(src.url);
      metas = src.kind==='github' ? parseGithub(t,s.type) : parseCinemeta(t,s.type);
      if(metas.length) break; // achou, para
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
