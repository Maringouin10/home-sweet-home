'use strict';

// Restriction geographique : bloque l'acces si le visiteur est en dehors des
// regions autorisees (par defaut le Quebec : CA-QC), meme s'il a le mot de passe.
//
// La geolocalisation se fait avec une base embarquee (geoip-lite), hors-ligne.
// Elle est imparfaite au niveau provincial : on autorise donc un IP canadien
// dont la region est inconnue (benefice du doute), tout en bloquant les autres
// pays et les provinces connues hors-liste.
//
// Reglage par variables d'environnement :
//   GEO_RESTRICT=1            active le blocage (sinon tout le monde passe)
//   GEO_ALLOW=CA-QC           liste autorisee (« PAYS-REGION » ou « PAYS »), séparée par des virgules
//   GEO_BLOCK_UNKNOWN=1       bloque aussi les IP non localisables du tout
//   TRUST_PROXY=1             lit X-Forwarded-For (à activer derrière un reverse-proxy)

const geoip = require('geoip-lite');

const RESTRICT = process.env.GEO_RESTRICT === '1' || process.env.GEO_RESTRICT === 'true';
const BLOCK_UNKNOWN = process.env.GEO_BLOCK_UNKNOWN === '1';
const TRUST_PROXY = process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true';

const ALLOW = (process.env.GEO_ALLOW || 'CA-QC')
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);
const ALLOW_SET = new Set(ALLOW);
const ALLOW_COUNTRIES = new Set(ALLOW.map((e) => e.split('-')[0]));

function enabled() {
  return RESTRICT;
}

function clientIp(req) {
  if (TRUST_PROXY) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim().replace(/^::ffff:/, '');
  }
  return String((req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/, '');
}

function isPrivateIp(ip) {
  if (!ip) return true; // pas d'IP -> on considère "local", on ne bloque pas
  if (ip === '::1' || ip === '127.0.0.1') return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
  if (ip.startsWith('169.254.') || ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) return true;
  const m = ip.match(/^172\.(\d+)\./);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 16 && n <= 31) return true;
  }
  return false;
}

// Décide si un résultat geoip est autorisé.
function geoAllowed(geo) {
  if (!geo || !geo.country) return !BLOCK_UNKNOWN; // non localisable
  const country = String(geo.country).toUpperCase();
  const region = String(geo.region || '').toUpperCase();
  if (ALLOW_SET.has(country)) return true; // pays entier autorisé
  if (region && ALLOW_SET.has(country + '-' + region)) return true; // région exacte
  if (!region && ALLOW_COUNTRIES.has(country)) return true; // bon pays, région inconnue
  return false;
}

// Évalue la requête. Renvoie { allowed, ip, geo }.
function evaluate(req) {
  if (!RESTRICT) return { allowed: true, ip: null, geo: null };
  const ip = clientIp(req);
  if (isPrivateIp(ip)) return { allowed: true, ip, geo: null, local: true };
  const geo = geoip.lookup(ip);
  return { allowed: geoAllowed(geo), ip, geo };
}

// Middleware : bloque avec une page dédiée (403) si hors zone.
function gate(req, res, next) {
  const r = evaluate(req);
  if (r.allowed) return next();
  const where = r.geo ? [r.geo.city, r.geo.region, r.geo.country].filter(Boolean).join(', ') : 'inconnue';
  return res.status(403).render('geoblock', {
    allow: ALLOW.join(', '),
    where,
  });
}

module.exports = { enabled, gate, evaluate, clientIp, isPrivateIp, geoAllowed, TRUST_PROXY, ALLOW };
