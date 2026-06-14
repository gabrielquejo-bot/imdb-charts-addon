// IMDb Charts Addon — Stremio / Nuvio (v3 DEFINITIVA)
// Ranking real (IDs do GitHub) + metadados uniformes (Cinemeta por ID)
const https = require('https');

const cache = {};
const CACHE_MS = 1000 * 60 * 60 * 6; // atualiza a cada 6h

// Fontes de IDs (ranking real, atualizadas periodicamente no GitHub):
const RANK_SOURCES = {
  imdb_pop_series: { type:'series', url:'https://raw.githubusercontent.com/crazyuploader/IMDb_Top_50/main/data/popular/shows.json', fallback:'https://v3-cinemeta.strem.io/catalog/series/top.json' },
  imdb_pop_movies: { type:'movie',  url:'https://raw.githubusercontent.com/crazyuploader/IMDb_Top_50/main/data/popular/movies.json', fallback:'https://v3-cinemeta.strem.io/catalog/movie/top.json' },
  imdb_top_series: { type:'series', url:'https://raw.githubusercontent.com/crazyuploader/IMDb_Top_50/main/data/top250/shows.json', fallback:'https://v3-cinemeta.strem.io/catalog/series/top.json' },
  imdb_top_movies: { type:'movie',  url:'https://raw.githubusercontent.com/crazyuploader/IMDb_Top_50/main/data/top250/movies.json', fallback:'https://v3-cinemeta.strem.io/catalog/movie/top.json' },
};
// Populares vêm direto do catálogo "top" do Cinemeta (Popular oficial):
const POPULAR_SOURCES = {};

const manifest = {
  id:'community.imdb.charts.ptbr', version:'3.2.0', name:'IMDb Charts',
  description:'Fileiras do IMDb: Top 250 Filmes, Top 250 Séries, Filmes Populares e Séries Populares. Atualiza periodicamente.',
  logo:'https://m.media-amazon.com/images/G/01/IMDb/BG_rectangle._CB1509060989_SY230_SX307_AL_.png',
  resources:['catalog'], types:['movie','series'], idPrefixes:['tt'],
  catalogs:[
    {type:'series',id:'imdb_pop_series', name:'IMDb Séries Populares'},
    {type:'movie', id:'imdb_pop_movies', name:'IMDb Filmes Populares'},
    {type:'series',id:'imdb_top_series', name:'IMDb Top 250 Séries'},
    {type:'movie', id:'imdb_top_movies', name:'IMDb Top 250 Filmes'},
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
    req.setTimeout(20000,()=>{req.destroy();reject(new Error('timeout'));});
  });
}

// Extrai lista ordenada de IDs do JSON de ranking (campo "link" tem o tt...)
function extractIds(text){
  let arr; try{arr=JSON.parse(text);}catch(e){return [];}
  if(!Array.isArray(arr)) return [];
  const ids=[];
  for(const it of arr){
    const src=it.link||it.imdb_url||it.url||it.id||'';
    const m=String(src).match(/(tt\d+)/);
    if(m) ids.push(m[1]);
  }
  return ids;
}

// Busca metadado de 1 item no Cinemeta (com pequeno cache por id)
const metaCache={};
async function getMeta(type,id){
  const k=type+':'+id;
  if(metaCache[k]&&(Date.now()-metaCache[k].ts)<CACHE_MS) return metaCache[k].data;
  try{
    const t=await fetchUrl(`https://v3-cinemeta.strem.io/meta/${type}/${id}.json`);
    const j=JSON.parse(t);
    if(j&&j.meta){
      const m=j.meta;
      const data={
        id:m.id, type:m.type||type, name:m.name||'',
        poster:m.poster||`https://images.metahub.space/poster/medium/${id}/img`,
        posterShape:'poster', releaseInfo:m.releaseInfo, imdbRating:m.imdbRating,
      };
      metaCache[k]={ts:Date.now(),data};
      return data;
    }
  }catch(e){}
  // fallback minimal
  return {id,type,name:'',poster:`https://images.metahub.space/poster/medium/${id}/img`,posterShape:'poster'};
}

function parseCinemeta(text, type){
  let j; try{j=JSON.parse(text);}catch(e){return [];}
  const metas=Array.isArray(j?.metas)?j.metas:[];
  return metas.filter(m=>m&&m.id&&/^tt\d+/.test(m.id)).map(m=>({
    id:m.id, type:m.type||type, name:m.name||'',
    poster:m.poster||`https://images.metahub.space/poster/medium/${m.id}/img`,
    posterShape:'poster', releaseInfo:m.releaseInfo, imdbRating:m.imdbRating,
  }));
}

async function getCatalog(key){
  const now=Date.now();
  if(cache[key]&&(now-cache[key].ts)<CACHE_MS) return cache[key].data;

  const s=RANK_SOURCES[key];
  if(!s) return [];
  let metas=[];

  // 1) tenta a fonte de ranking real (GitHub) -> metadados Cinemeta por ID
  try{
    const t=await fetchUrl(s.url);
    const ids=extractIds(t).slice(0,250);
    if(ids.length){
      const batch=20; const out=[];
      for(let i=0;i<ids.length;i+=batch){
        const part=await Promise.all(ids.slice(i,i+batch).map(id=>getMeta(s.type,id)));
        out.push(...part);
      }
      metas=out.filter(m=>m&&m.id);
    }
  }catch(e){}

  // 2) fallback: catalogo "top" do Cinemeta, se a fonte falhou
  if(!metas.length && s.fallback){
    try{ const t=await fetchUrl(s.fallback); metas=parseCinemeta(t,s.type); }catch(e){}
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
