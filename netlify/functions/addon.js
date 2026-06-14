// IMDb Charts Addon for Stremio / Nuvio
// Fileiras: Top 250 Filmes, Top 250 Séries, Filmes Populares, Séries Populares

const https = require('https');

// ---- Definição dos catálogos ----
const CHARTS = {
  imdb_top_movies: { url: 'https://www.imdb.com/chart/top/',        type: 'movie',  name: 'IMDb Top 250 Filmes' },
  imdb_top_series: { url: 'https://www.imdb.com/chart/toptv/',      type: 'series', name: 'IMDb Top 250 Séries' },
  imdb_pop_movies: { url: 'https://www.imdb.com/chart/moviemeter/', type: 'movie',  name: 'IMDb Filmes Populares' },
  imdb_pop_series: { url: 'https://www.imdb.com/chart/tvmeter/',    type: 'series', name: 'IMDb Séries Populares' },
};

// ---- Cache em memória (por instância) ----
const cache = {};
const CACHE_MS = 1000 * 60 * 60 * 6; // 6 horas

// ---- Manifest ----
const manifest = {
  id: 'community.imdb.charts.ptbr',
  version: '1.0.0',
  name: 'IMDb Charts',
  description: 'Fileiras do IMDb: Top 250 Filmes, Top 250 Séries, Filmes Populares e Séries Populares.',
  logo: 'https://m.media-amazon.com/images/G/01/IMDb/BG_rectangle._CB1509060989_SY230_SX307_AL_.png',
  resources: ['catalog'],
  types: ['movie', 'series'],
  idPrefixes: ['tt'],
  catalogs: [
    { type: 'movie',  id: 'imdb_top_movies', name: 'IMDb Top 250 Filmes' },
    { type: 'series', id: 'imdb_top_series', name: 'IMDb Top 250 Séries' },
    { type: 'movie',  id: 'imdb_pop_movies', name: 'IMDb Filmes Populares' },
    { type: 'series', id: 'imdb_pop_series', name: 'IMDb Séries Populares' },
  ],
};

// ---- Fetch helper ----
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
      }
    }, (res) => {
      // segue redirect simples
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchUrl(res.headers.location));
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ---- Parser principal: __NEXT_DATA__ ----
function parseNextData(html, expectedType) {
  const metas = [];
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/s);
  if (!m) return metas;

  let json;
  try { json = JSON.parse(m[1]); } catch (e) { return metas; }

  const pd = json?.props?.pageProps?.pageData || json?.props?.pageProps || {};
  const edges =
    pd?.chartTitles?.edges ||
    pd?.chartList?.edges ||
    pd?.titleListItemSearch?.edges ||
    [];

  for (const edge of edges) {
    const node = edge.node || edge.listItem || edge;
    if (!node || !node.id) continue;
    const id = node.id;
    if (!/^tt\d+/.test(id)) continue;
    const title = node.titleText?.text || node.originalTitleText?.text || '';
    const year = node.releaseYear?.year || '';
    const poster = node.primaryImage?.url || `https://images.metahub.space/poster/medium/${id}/img`;
    const rating = node.ratingsSummary?.aggregateRating;
    const ttype = node.titleType?.id;
    const mapped = (ttype === 'movie' || ttype === 'tvMovie' || ttype === 'short') ? 'movie' : 'series';

    metas.push({
      id,
      type: expectedType || mapped,
      name: title,
      poster,
      posterShape: 'poster',
      releaseInfo: year ? String(year) : undefined,
      imdbRating: rating ? String(rating) : undefined,
    });
  }
  return metas;
}

// ---- Fallback: extrai IDs por regex do HTML ----
function parseFallback(html, expectedType) {
  const ids = [];
  const seen = new Set();
  const re = /\/title\/(tt\d+)\//g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (!seen.has(m[1])) { seen.add(m[1]); ids.push(m[1]); }
  }
  return ids.slice(0, 250).map(id => ({
    id,
    type: expectedType,
    name: '',
    poster: `https://images.metahub.space/poster/medium/${id}/img`,
    posterShape: 'poster',
  }));
}

// ---- Busca catálogo com cache ----
async function getCatalog(chartKey) {
  const now = Date.now();
  if (cache[chartKey] && (now - cache[chartKey].ts) < CACHE_MS) {
    return cache[chartKey].data;
  }
  const chart = CHARTS[chartKey];
  if (!chart) return [];

  const html = await fetchUrl(chart.url);
  let metas = parseNextData(html, chart.type);
  if (!metas.length) metas = parseFallback(html, chart.type);

  if (metas.length) cache[chartKey] = { ts: now, data: metas };
  return metas;
}

// ---- Handler Netlify ----
exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Content-Type': 'application/json; charset=utf-8',
  };

  // O Netlify, ao aplicar o redirect, repassa a URL original.
  // Tentamos várias fontes para descobrir o que o cliente pediu de verdade.
  const h = event.headers || {};
  let path =
    h['x-nf-original-path'] ||
    h['x-original-uri'] ||
    event.rawUrl ||
    event.path ||
    '';

  // se veio URL completa, extrai só o pathname
  try { if (/^https?:\/\//.test(path)) path = new URL(path).pathname; } catch (e) {}

  path = path.split('?')[0];
  // remove o prefixo da função, se presente
  path = path.replace(/^.*\/\.netlify\/functions\/addon/, '');
  if (path.includes('/manifest.json')) path = '/manifest.json';
  if (!path || path === '/' || path === '/addon') path = '/manifest.json';

  try {
    if (path === '/manifest.json') {
      return { statusCode: 200, headers: cors, body: JSON.stringify(manifest) };
    }

    // /catalog/:type/:id.json
    const cm = path.match(/\/catalog\/([^/]+)\/([^/.]+)(?:\.json)?$/);
    if (cm) {
      const id = cm[2];
      const metas = await getCatalog(id);
      return { statusCode: 200, headers: cors, body: JSON.stringify({ metas }) };
    }

    return { statusCode: 404, headers: cors, body: JSON.stringify({ err: 'not found', path }) };
  } catch (e) {
    return { statusCode: 200, headers: cors, body: JSON.stringify({ metas: [], error: String(e) }) };
  }
};
