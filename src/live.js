'use strict';

// Moteur de "donnees live" : chaque source est une URL qui renvoie du JSON.
// A chaque affichage de page, on appelle les sources referencees, on met en
// cache un court instant (TTL), et on remplace les jetons {{source.chemin}}
// dans les textes / stats par la valeur courante.

const DEFAULT_TTL = 30; // secondes
const FETCH_TIMEOUT = 6000; // ms

// Cache en memoire : id source -> { at, data, lastGood, error }
const cache = new Map();

// --- Résolution de chemin JSON (ex: "results.0.value" ou "data[2].power") ---
function resolvePath(obj, pathStr) {
  if (obj == null) return undefined;
  const parts = String(pathStr)
    .replace(/\[(\w+)\]/g, '.$1') // a[0].b -> a.0.b
    .split('.')
    .filter((p) => p !== '');
  let cur = obj;
  for (const part of parts) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

// Aplati un JSON en une liste de feuilles { path, value, preview }.
function flatten(obj, prefix = '', out = [], depth = 0) {
  if (depth > 6 || out.length > 300) return out;
  if (obj == null || typeof obj !== 'object') {
    out.push({ path: prefix, value: obj, preview: previewValue(obj) });
    return out;
  }
  if (Array.isArray(obj)) {
    // On expose les premiers elements du tableau
    obj.slice(0, 20).forEach((v, i) => {
      const p = prefix ? `${prefix}.${i}` : String(i);
      if (v !== null && typeof v === 'object') flatten(v, p, out, depth + 1);
      else out.push({ path: p, value: v, preview: previewValue(v) });
    });
    return out;
  }
  for (const key of Object.keys(obj)) {
    const p = prefix ? `${prefix}.${key}` : key;
    const v = obj[key];
    if (v !== null && typeof v === 'object') flatten(v, p, out, depth + 1);
    else out.push({ path: p, value: v, preview: previewValue(v) });
  }
  return out;
}

function previewValue(v) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return Array.isArray(v) ? '[…]' : '{…}';
  const s = String(v);
  return s.length > 40 ? s.slice(0, 40) + '…' : s;
}

function formatValue(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v);
    } catch (_) {
      return String(v);
    }
  }
  return String(v);
}

function parseHeaders(headersStr) {
  const headers = {};
  String(headersStr || '')
    .split('\n')
    .forEach((line) => {
      const idx = line.indexOf(':');
      if (idx > 0) {
        const k = line.slice(0, idx).trim();
        const val = line.slice(idx + 1).trim();
        if (k) headers[k] = val;
      }
    });
  return headers;
}

// Récupère (avec cache) le JSON d'une source. Ne jette jamais : renvoie un objet
// { ok, json, error, at }. En cas d'échec, on ressert la dernière valeur connue.
async function getData(source) {
  if (!source || !source.url) return { ok: false, json: null, error: 'URL manquante' };
  const ttl = (Number(source.ttl) || DEFAULT_TTL) * 1000;
  const entry = cache.get(source.id);
  const now = Date.now();
  if (entry && now - entry.at < ttl) {
    return { ok: !entry.error, json: entry.data, error: entry.error, at: entry.at, cached: true };
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(source.url, {
      signal: ac.signal,
      headers: Object.assign({ Accept: 'application/json' }, parseHeaders(source.headers)),
      redirect: 'follow',
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    cache.set(source.id, { at: now, data: json, lastGood: json, error: null });
    return { ok: true, json, error: null, at: now };
  } catch (err) {
    const lastGood = entry && entry.lastGood;
    cache.set(source.id, {
      at: now,
      data: lastGood || null,
      lastGood: lastGood || null,
      error: err.name === 'AbortError' ? 'délai dépassé' : err.message,
    });
    return { ok: false, json: lastGood || null, error: err.message, at: now };
  } finally {
    clearTimeout(timer);
  }
}

// Récupère plusieurs sources en parallèle -> { name: json }
async function loadByName(sources) {
  const out = {};
  await Promise.all(
    (sources || []).map(async (s) => {
      const r = await getData(s);
      out[s.name] = r.json;
    })
  );
  return out;
}

// Jeton : {{ nom.chemin }} ou {{ nom.chemin | valeur par défaut }}
const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_]+)\.([^}|]+?)\s*(?:\|\s*([^}]*?))?\s*\}\}/g;

function resolveTokens(text, dataByName) {
  if (!text) return '';
  return String(text).replace(TOKEN_RE, (m, name, path, fallback) => {
    const root = dataByName ? dataByName[name] : undefined;
    const val = resolvePath(root, path);
    if (val === undefined || val === null || val === '') {
      return fallback !== undefined ? fallback : '—';
    }
    return formatValue(val);
  });
}

// Liste les noms de sources référencés dans un texte.
function referencedNames(text, set) {
  if (!text) return;
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text)) !== null) set.add(m[1]);
}

module.exports = {
  DEFAULT_TTL,
  resolvePath,
  flatten,
  previewValue,
  formatValue,
  parseHeaders,
  getData,
  loadByName,
  resolveTokens,
  referencedNames,
};
