'use strict';

// Authentification simple : un mot de passe visiteur (passe en ?k=... ou via
// un formulaire) et un mot de passe admin (env). Les sessions sont gerees par
// des cookies signes ; la valeur du cookie derive du mot de passe courant, donc
// changer le mot de passe invalide automatiquement les anciennes sessions.

const crypto = require('crypto');
const store = require('./store');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin-change-moi';
const COOKIE_MAX_AGE = 1000 * 60 * 60 * 24 * 30; // 30 jours

// Comparaison a temps constant, robuste aux longueurs differentes.
function safeEqual(a, b) {
  const ab = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ab.length !== bb.length) {
    // compare quand meme pour limiter la fuite de timing, mais renvoie false
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

function tokenFor(password) {
  return crypto.createHash('sha256').update(String(password)).digest('hex');
}

// Empeche les redirections ouvertes : seules les URLs internes sont acceptees.
function sanitizeNext(next) {
  if (typeof next !== 'string') return '/';
  if (!next.startsWith('/') || next.startsWith('//')) return '/';
  return next;
}

function cookieOpts(req) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    signed: true,
    maxAge: COOKIE_MAX_AGE,
    secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
  };
}

// ---- Visiteur ----------------------------------------------------------

function setVisitorCookie(req, res) {
  const pw = store.get().sitePassword;
  res.cookie('visitor', tokenFor(pw), cookieOpts(req));
}

function isVisitorAuthed(req) {
  const pw = store.get().sitePassword;
  const cookie = req.signedCookies && req.signedCookies.visitor;
  return !!cookie && safeEqual(cookie, tokenFor(pw));
}

// Middleware : protege les pages publiques.
function requireVisitor(req, res, next) {
  const pw = store.get().sitePassword;

  // 1) Mot de passe fourni dans l'URL (?k=...) -> on authentifie et on nettoie l'URL.
  if (typeof req.query.k === 'string') {
    if (safeEqual(req.query.k, pw)) {
      setVisitorCookie(req, res);
      const url = new URL(req.originalUrl, 'http://placeholder');
      url.searchParams.delete('k');
      const clean = url.pathname + (url.search || '');
      return res.redirect(clean);
    }
    // clef fournie mais fausse -> on redemande
    return res.status(401).render('login', {
      title: store.get().siteTitle,
      next: req.path,
      error: true,
    });
  }

  // 2) Deja authentifie via cookie.
  if (isVisitorAuthed(req)) return next();

  // 3) Sinon, on demande le mot de passe.
  return res.status(401).render('login', {
    title: store.get().siteTitle,
    next: req.originalUrl,
    error: false,
  });
}

// ---- Admin -------------------------------------------------------------

function setAdminCookie(req, res) {
  res.cookie('admin', tokenFor(ADMIN_PASSWORD), cookieOpts(req));
}

function isAdminAuthed(req) {
  const cookie = req.signedCookies && req.signedCookies.admin;
  return !!cookie && safeEqual(cookie, tokenFor(ADMIN_PASSWORD));
}

module.exports = {
  ADMIN_PASSWORD,
  safeEqual,
  tokenFor,
  sanitizeNext,
  setVisitorCookie,
  isVisitorAuthed,
  requireVisitor,
  setAdminCookie,
  isAdminAuthed,
};
