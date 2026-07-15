'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const QRCode = require('qrcode');

const store = require('./src/store');
const auth = require('./src/auth');
const live = require('./src/live');

const app = express();
const PORT = process.env.PORT || 3000;

const ADMIN_PATH = (process.env.ADMIN_PATH || '/admin').replace(/\/+$/, '') || '/admin';

const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.warn(
    '[!] SESSION_SECRET non defini : un secret temporaire est genere. ' +
      'Definis SESSION_SECRET pour garder les sessions entre les redemarrages.'
  );
}

store.load();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(cookieParser(SESSION_SECRET));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.use('/static', express.static(path.join(__dirname, 'public')));
app.use('/media', express.static(store.UPLOADS_DIR, { maxAge: '7d', fallthrough: false }));

// ---- Upload (multer) ---------------------------------------------------
const ALLOWED = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm',
]);
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, store.UPLOADS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().slice(0, 8);
      cb(null, store.newId() + ext);
    },
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ALLOWED.has(file.mimetype)),
});
function mediaType(mimetype) {
  return mimetype && mimetype.startsWith('video/') ? 'video' : 'image';
}
function removeUpload(filename) {
  if (!filename) return;
  const p = path.join(store.UPLOADS_DIR, path.basename(filename));
  fs.rm(p, { force: true }, () => {});
}
function removeBlockMedia(block) {
  if (block && block.media) removeUpload(block.media);
}
function removePageMedia(page) {
  (page.blocks || []).forEach(removeBlockMedia);
}

// ---- Helpers URL / navigation -----------------------------------------
function baseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  return proto + '://' + req.get('host');
}
function pageUrl(cfg, page) {
  const home = store.homePage(cfg);
  return home && page.id === home.id ? '/' : '/p/' + page.slug;
}
function pointUrl(req, point) {
  const cfg = store.get();
  const page = store.pageById(point.pageId, cfg) || store.homePage(cfg);
  const u = new URL(baseUrl(req) + (page ? pageUrl(cfg, page) : '/'));
  u.searchParams.set('k', cfg.sitePassword);
  return u.toString();
}
function navFor(cfg, currentId) {
  return store.publishedPages(cfg).map((p) => ({
    id: p.id, title: p.title, icon: p.icon,
    url: pageUrl(cfg, p), active: p.id === currentId,
  }));
}
function slugify(s) {
  return (
    String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'page'
  );
}
function uniqueSlug(base, cfg, exceptId) {
  let s = slugify(base);
  let n = 1;
  while (cfg.pages.some((p) => p.slug === s && p.id !== exceptId)) s = slugify(base) + '-' + ++n;
  return s;
}

// ---- Résolution des blocs pour l'affichage public ---------------------
function collectNames(blocks) {
  const set = new Set();
  (blocks || []).forEach((b) => {
    live.referencedNames(b.body, set);
    live.referencedNames(b.text, set);
    live.referencedNames(b.value, set);
    live.referencedNames(b.label, set);
    live.referencedNames(b.unit, set);
  });
  return set;
}
function resolveBlock(b, data) {
  const out = Object.assign({}, b);
  if (b.type === 'text') out.body = live.resolveTokens(b.body, data);
  if (b.type === 'heading') out.text = live.resolveTokens(b.text, data);
  if (b.type === 'stat') {
    out.value = live.resolveTokens(b.value, data);
    out.label = live.resolveTokens(b.label, data);
    out.unit = live.resolveTokens(b.unit, data);
  }
  return out;
}

async function renderPublicPage(req, res, page) {
  const cfg = store.get();
  const names = collectNames(page.blocks);
  const sources = cfg.sources.filter((s) => names.has(s.name));
  const data = await live.loadByName(sources);
  const blocks = (page.blocks || []).map((b) => resolveBlock(b, data));
  res.render('page', {
    cfg,
    current: page,
    blocks,
    nav: navFor(cfg, page.id),
  });
}

// =======================================================================
// PAGES PUBLIQUES
// =======================================================================
app.get('/', auth.requireVisitor, (req, res) => {
  const home = store.homePage(store.get());
  if (!home) return res.status(404).send('Aucune page.');
  return renderPublicPage(req, res, home);
});

app.get('/p/:slug', auth.requireVisitor, (req, res) => {
  const cfg = store.get();
  const page = store.pageBySlug(req.params.slug, cfg);
  if (!page || !page.published) return notFound(req, res);
  return renderPublicPage(req, res, page);
});

app.post('/login', (req, res) => {
  const cfg = store.get();
  if (auth.safeEqual(req.body.password || '', cfg.sitePassword)) {
    auth.setVisitorCookie(req, res);
    return res.redirect(auth.sanitizeNext(req.body.next));
  }
  return res.status(401).render('login', {
    title: cfg.siteTitle, next: auth.sanitizeNext(req.body.next), error: true,
  });
});
app.get('/logout', (req, res) => {
  res.clearCookie('visitor');
  res.redirect('/');
});

// =======================================================================
// ADMIN
// =======================================================================
function requireAdmin(req, res, next) {
  if (auth.isAdminAuthed(req)) return next();
  return res.status(401).render('admin-login', { adminPath: ADMIN_PATH, error: false });
}

app.get(ADMIN_PATH, (req, res) => {
  if (!auth.isAdminAuthed(req)) {
    return res.render('admin-login', { adminPath: ADMIN_PATH, error: false });
  }
  return renderAdmin(req, res);
});
app.post(ADMIN_PATH + '/login', (req, res) => {
  if (auth.safeEqual(req.body.password || '', auth.ADMIN_PASSWORD)) {
    auth.setAdminCookie(req, res);
    return res.redirect(ADMIN_PATH);
  }
  return res.status(401).render('admin-login', { adminPath: ADMIN_PATH, error: true });
});
app.get(ADMIN_PATH + '/logout', (req, res) => {
  res.clearCookie('admin');
  res.redirect(ADMIN_PATH);
});

function renderAdmin(req, res) {
  const cfg = store.get();
  const pages = store.sortedPages(cfg).map((p) => ({
    ...p,
    url: pageUrl(cfg, p),
    isHome: p.id === cfg.homePageId,
    blockCount: (p.blocks || []).length,
  }));
  const points = cfg.points.map((p) => {
    const page = store.pageById(p.pageId, cfg);
    return { ...p, pageTitle: page ? page.title : '—', url: pointUrl(req, p) };
  });
  res.render('admin', {
    cfg, pages, points, adminPath: ADMIN_PATH, baseUrl: baseUrl(req),
    saved: req.query.saved || '',
  });
}

// --- Réglages généraux ---
app.post(ADMIN_PATH + '/settings', requireAdmin, (req, res) => {
  store.update((cfg) => {
    cfg.siteTitle = (req.body.siteTitle || '').slice(0, 120) || cfg.siteTitle;
  });
  res.redirect(ADMIN_PATH + '?saved=réglages');
});
app.post(ADMIN_PATH + '/password', requireAdmin, (req, res) => {
  const pw = (req.body.sitePassword || '').trim();
  if (pw.length >= 3) {
    store.update((cfg) => { cfg.sitePassword = pw; });
    auth.setVisitorCookie(req, res);
  }
  res.redirect(ADMIN_PATH + '?saved=mot de passe');
});

// --- Pages : CRUD ---
app.post(ADMIN_PATH + '/pages', requireAdmin, (req, res) => {
  let newId;
  store.update((cfg) => {
    const title = (req.body.title || 'Nouvelle page').slice(0, 120);
    const maxOrder = cfg.pages.reduce((m, p) => Math.max(m, p.order), -1);
    const page = {
      id: store.newId(), slug: uniqueSlug(title, cfg), title,
      icon: (req.body.icon || '📄').slice(0, 8), order: maxOrder + 1,
      published: true, blocks: [],
    };
    cfg.pages.push(page);
    newId = page.id;
  });
  res.redirect(ADMIN_PATH + '/pages/' + newId);
});

app.post(ADMIN_PATH + '/pages/:id/settings', requireAdmin, (req, res) => {
  store.update((cfg) => {
    const page = store.pageById(req.params.id, cfg);
    if (!page) return;
    page.title = (req.body.title || page.title).slice(0, 120);
    page.icon = (req.body.icon || page.icon).slice(0, 8);
    page.published = req.body.published === '1';
    if (req.body.slug) page.slug = uniqueSlug(req.body.slug, cfg, page.id);
  });
  res.redirect(ADMIN_PATH + '/pages/' + req.params.id + '?saved=page');
});

app.post(ADMIN_PATH + '/pages/:id/home', requireAdmin, (req, res) => {
  store.update((cfg) => {
    if (store.pageById(req.params.id, cfg)) cfg.homePageId = req.params.id;
  });
  res.redirect(ADMIN_PATH + '?saved=accueil');
});

app.post(ADMIN_PATH + '/pages/:id/move', requireAdmin, (req, res) => {
  store.update((cfg) => movePage(cfg, req.params.id, req.body.dir));
  res.redirect(ADMIN_PATH);
});

app.post(ADMIN_PATH + '/pages/:id/delete', requireAdmin, (req, res) => {
  store.update((cfg) => {
    if (req.params.id === cfg.homePageId) return; // on ne supprime pas l'accueil
    const idx = cfg.pages.findIndex((p) => p.id === req.params.id);
    if (idx === -1) return;
    removePageMedia(cfg.pages[idx]);
    cfg.pages.splice(idx, 1);
    cfg.points = cfg.points.map((pt) =>
      pt.pageId === req.params.id ? { ...pt, pageId: cfg.homePageId } : pt
    );
  });
  res.redirect(ADMIN_PATH + '?saved=page supprimée');
});

function movePage(cfg, id, dir) {
  const pages = store.sortedPages(cfg);
  const i = pages.findIndex((p) => p.id === id);
  if (i === -1) return;
  const j = dir === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= pages.length) return;
  const a = pages[i].order;
  pages[i].order = pages[j].order;
  pages[j].order = a;
}

// --- Éditeur d'une page ---
app.get(ADMIN_PATH + '/pages/:id', requireAdmin, (req, res) => {
  const cfg = store.get();
  const page = store.pageById(req.params.id, cfg);
  if (!page) return res.redirect(ADMIN_PATH);
  res.render('admin-page', {
    cfg, page, adminPath: ADMIN_PATH,
    publicUrl: pageUrl(cfg, page), isHome: page.id === cfg.homePageId,
    saved: req.query.saved || '',
  });
});

// --- Blocs : ajout ---
app.post(ADMIN_PATH + '/pages/:id/blocks', requireAdmin, (req, res) => {
  const type = req.body.type;
  const ok = ['heading', 'text', 'stat', 'image', 'video', 'embed', 'divider'];
  if (!ok.includes(type)) return res.redirect(ADMIN_PATH + '/pages/' + req.params.id);
  let bid;
  store.update((cfg) => {
    const page = store.pageById(req.params.id, cfg);
    if (!page) return;
    const block = newBlock(type);
    bid = block.id;
    page.blocks.push(block);
  });
  res.redirect(ADMIN_PATH + '/pages/' + req.params.id + '#b-' + bid);
});

function newBlock(type) {
  const b = { id: store.newId(), type };
  if (type === 'heading') { b.text = 'Titre'; b.level = 2; }
  if (type === 'text') b.body = 'Écris ton texte ici…';
  if (type === 'stat') { b.label = 'Production solaire'; b.value = '0'; b.unit = 'kWh'; b.size = 'lg'; }
  if (type === 'image') { b.media = ''; b.src = ''; b.caption = ''; }
  if (type === 'video') { b.media = ''; b.embedUrl = ''; b.caption = ''; }
  if (type === 'embed') { b.src = ''; b.height = 480; }
  return b;
}

// --- Blocs : mise à jour (avec upload éventuel) ---
app.post(
  ADMIN_PATH + '/pages/:id/blocks/:bid',
  requireAdmin,
  upload.single('media'),
  (req, res) => {
    store.update((cfg) => {
      const page = store.pageById(req.params.id, cfg);
      if (!page) return;
      const b = page.blocks.find((x) => x.id === req.params.bid);
      if (!b) return;
      applyBlockFields(b, req.body, req.file);
    });
    res.redirect(ADMIN_PATH + '/pages/' + req.params.id + '?saved=bloc#b-' + req.params.bid);
  }
);

function applyBlockFields(b, body, file) {
  if (b.type === 'heading') {
    b.text = (body.text || '').slice(0, 300);
    b.level = body.level === '1' ? 1 : 2;
  } else if (b.type === 'text') {
    b.body = (body.body || '').slice(0, 8000);
  } else if (b.type === 'stat') {
    b.label = (body.label || '').slice(0, 200);
    b.value = (body.value || '').slice(0, 500);
    b.unit = (body.unit || '').slice(0, 40);
    b.size = ['md', 'lg', 'xl'].includes(body.size) ? body.size : 'lg';
  } else if (b.type === 'image') {
    b.caption = (body.caption || '').slice(0, 300);
    b.src = (body.src || '').trim().slice(0, 2000);
    if (file) { removeBlockMedia(b); b.media = file.filename; }
    else if (body.removeMedia === '1') { removeBlockMedia(b); b.media = ''; }
  } else if (b.type === 'video') {
    b.caption = (body.caption || '').slice(0, 300);
    b.embedUrl = (body.embedUrl || '').trim().slice(0, 2000);
    if (file) { removeBlockMedia(b); b.media = file.filename; }
    else if (body.removeMedia === '1') { removeBlockMedia(b); b.media = ''; }
  } else if (b.type === 'embed') {
    b.src = (body.src || '').trim().slice(0, 2000);
    b.height = Math.min(1200, Math.max(120, parseInt(body.height, 10) || 480));
  }
}

// --- Blocs : déplacer / supprimer ---
app.post(ADMIN_PATH + '/pages/:id/blocks/:bid/move', requireAdmin, (req, res) => {
  store.update((cfg) => {
    const page = store.pageById(req.params.id, cfg);
    if (!page) return;
    const i = page.blocks.findIndex((x) => x.id === req.params.bid);
    const j = req.body.dir === 'up' ? i - 1 : i + 1;
    if (i === -1 || j < 0 || j >= page.blocks.length) return;
    const tmp = page.blocks[i];
    page.blocks[i] = page.blocks[j];
    page.blocks[j] = tmp;
  });
  res.redirect(ADMIN_PATH + '/pages/' + req.params.id + '#b-' + req.params.bid);
});
app.post(ADMIN_PATH + '/pages/:id/blocks/:bid/delete', requireAdmin, (req, res) => {
  store.update((cfg) => {
    const page = store.pageById(req.params.id, cfg);
    if (!page) return;
    const idx = page.blocks.findIndex((x) => x.id === req.params.bid);
    if (idx !== -1) { removeBlockMedia(page.blocks[idx]); page.blocks.splice(idx, 1); }
  });
  res.redirect(ADMIN_PATH + '/pages/' + req.params.id + '?saved=bloc supprimé');
});

// --- Sources de données live : CRUD ---
app.post(ADMIN_PATH + '/sources', requireAdmin, (req, res) => {
  const name = slugName(req.body.name);
  const url = (req.body.url || '').trim();
  if (!name || !url) return res.redirect(ADMIN_PATH + '?saved=source invalide');
  store.update((cfg) => {
    const data = {
      name,
      url: url.slice(0, 2000),
      headers: (req.body.headers || '').slice(0, 2000),
      ttl: Math.min(3600, Math.max(2, parseInt(req.body.ttl, 10) || live.DEFAULT_TTL)),
    };
    const existing = req.body.id && cfg.sources.find((s) => s.id === req.body.id);
    if (existing) Object.assign(existing, data);
    else cfg.sources.push(Object.assign({ id: store.newId() }, data));
  });
  res.redirect(ADMIN_PATH + '?saved=source');
});
app.post(ADMIN_PATH + '/sources/:id/delete', requireAdmin, (req, res) => {
  store.update((cfg) => {
    const idx = cfg.sources.findIndex((s) => s.id === req.params.id);
    if (idx !== -1) cfg.sources.splice(idx, 1);
  });
  res.redirect(ADMIN_PATH + '?saved=source supprimée');
});

function slugName(s) {
  return String(s || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40);
}

// --- Aperçu des variables d'une source (JSON) ---
app.get(ADMIN_PATH + '/sources/:id/preview', requireAdmin, async (req, res) => {
  const cfg = store.get();
  const source = cfg.sources.find((s) => s.id === req.params.id);
  if (!source) return res.status(404).json({ error: 'introuvable' });
  const r = await live.getData(source);
  const vars = live.flatten(r.json || {}).map((v) => ({
    path: v.path, preview: v.preview, token: '{{' + source.name + '.' + v.path + '}}',
  }));
  res.json({ ok: r.ok, error: r.error || null, name: source.name, vars });
});

// --- Toutes les variables disponibles (pour la palette de l'éditeur) ---
app.get(ADMIN_PATH + '/vars', requireAdmin, async (req, res) => {
  const cfg = store.get();
  const out = await Promise.all(
    cfg.sources.map(async (s) => {
      const r = await live.getData(s);
      const vars = live.flatten(r.json || {}).map((v) => ({
        path: v.path, preview: v.preview, token: '{{' + s.name + '.' + v.path + '}}',
      }));
      return { id: s.id, name: s.name, ok: r.ok, error: r.error || null, vars };
    })
  );
  res.json({ sources: out });
});

// --- Balises NFC / QR ---
app.post(ADMIN_PATH + '/points', requireAdmin, (req, res) => {
  const cfg = store.get();
  if (!store.pageById(req.body.pageId, cfg)) return res.redirect(ADMIN_PATH);
  store.update((c) => {
    c.points.push({
      id: store.newId(), label: (req.body.label || 'Balise').slice(0, 120),
      pageId: req.body.pageId, note: (req.body.note || '').slice(0, 500),
    });
  });
  res.redirect(ADMIN_PATH + '?saved=balise');
});
app.post(ADMIN_PATH + '/points/:id/delete', requireAdmin, (req, res) => {
  store.update((cfg) => {
    const idx = cfg.points.findIndex((p) => p.id === req.params.id);
    if (idx !== -1) cfg.points.splice(idx, 1);
  });
  res.redirect(ADMIN_PATH + '?saved=balise');
});
app.get(ADMIN_PATH + '/qr/:id.png', requireAdmin, async (req, res) => {
  const cfg = store.get();
  const point = cfg.points.find((p) => p.id === req.params.id);
  if (!point) return res.status(404).send('Balise introuvable');
  try {
    const png = await QRCode.toBuffer(pointUrl(req, point), {
      type: 'png', width: 800, margin: 2, errorCorrectionLevel: 'M',
    });
    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', 'attachment; filename="qr-' + slugify(point.label) + '.png"');
    res.send(png);
  } catch (err) {
    res.status(500).send('Erreur QR : ' + err.message);
  }
});
app.get(ADMIN_PATH + '/tags', requireAdmin, async (req, res) => {
  const cfg = store.get();
  const points = await Promise.all(
    cfg.points.map(async (p) => {
      const page = store.pageById(p.pageId, cfg);
      const url = pointUrl(req, p);
      return {
        ...p, pageTitle: page ? page.title : '—', url,
        dataUrl: await QRCode.toDataURL(url, { width: 320, margin: 1 }),
      };
    })
  );
  res.render('tags', { cfg, points, adminPath: ADMIN_PATH });
});

// ---- Divers ------------------------------------------------------------
app.get('/healthz', (req, res) => res.type('text').send('ok'));

function notFound(req, res) {
  if (auth.isVisitorAuthed(req)) {
    const cfg = store.get();
    return res.status(404).render('notfound', { cfg, nav: navFor(cfg, null) });
  }
  return res.status(404).render('login', { title: store.get().siteTitle, next: '/', error: false });
}
app.use((req, res) => notFound(req, res));

// Gestion d'erreur (ex: upload trop gros / type refusé)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(400).send('Erreur : ' + (err.message || 'requête invalide'));
});

app.listen(PORT, () => {
  console.log('Site en ligne sur http://localhost:' + PORT);
  console.log('Admin (non liee) : ' + ADMIN_PATH);
});
