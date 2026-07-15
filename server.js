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

const app = express();
const PORT = process.env.PORT || 3000;

// Chemin de l'admin (par defaut /admin, jamais affiche/lie sur le site).
// Peut etre change via ADMIN_PATH pour plus de discretion.
const ADMIN_PATH = (process.env.ADMIN_PATH || '/admin').replace(/\/+$/, '') || '/admin';

// Secret pour signer les cookies. Genere au demarrage si absent
// (les sessions sont alors invalidees a chaque redemarrage).
const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.warn(
    '[!] SESSION_SECRET non defini : un secret temporaire est genere. ' +
      'Definis SESSION_SECRET pour garder les sessions entre les redemarrages.'
  );
}

store.ensureDirs();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(cookieParser(SESSION_SECRET));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Fichiers statiques (CSS) et medias uploades.
app.use('/static', express.static(path.join(__dirname, 'public')));
app.use(
  '/media',
  express.static(store.UPLOADS_DIR, { maxAge: '7d', fallthrough: false })
);

// ---- Upload (multer) ---------------------------------------------------

const ALLOWED = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/webm',
]);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, store.UPLOADS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().slice(0, 8);
      cb(null, store.newId() + ext);
    },
  }),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 Mo (time-lapse video)
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

// Base URL publique (pour les QR codes). PUBLIC_URL prioritaire, sinon deduit.
function baseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  return proto + '://' + req.get('host');
}

// Destinations autorisees pour une balise.
const DESTINATIONS = [
  { value: '/', label: 'Accueil (presentation)' },
  { value: '/carte', label: 'Carte du terrain' },
  { value: '/galerie', label: 'Galerie / time-lapse' },
];

function destLabel(value) {
  const d = DESTINATIONS.find((x) => x.value === value);
  return d ? d.label : value;
}

// URL complete a encoder dans un QR / une balise NFC pour une destination.
function pointUrl(req, dest) {
  const pw = store.get().sitePassword;
  const u = new URL(baseUrl(req) + (dest || '/'));
  u.searchParams.set('k', pw);
  return u.toString();
}

// =======================================================================
// PAGES PUBLIQUES (protegees par le mot de passe visiteur)
// =======================================================================

app.get('/', auth.requireVisitor, (req, res) => {
  const cfg = store.get();
  res.render('home', { cfg, page: 'home' });
});

app.get('/carte', auth.requireVisitor, (req, res) => {
  const cfg = store.get();
  res.render('carte', { cfg, page: 'carte' });
});

app.get('/galerie', auth.requireVisitor, (req, res) => {
  const cfg = store.get();
  res.render('galerie', { cfg, page: 'galerie' });
});

// Connexion visiteur via formulaire.
app.post('/login', (req, res) => {
  const cfg = store.get();
  if (auth.safeEqual(req.body.password || '', cfg.sitePassword)) {
    auth.setVisitorCookie(req, res);
    return res.redirect(auth.sanitizeNext(req.body.next));
  }
  return res.status(401).render('login', {
    title: cfg.siteTitle,
    next: auth.sanitizeNext(req.body.next),
    error: true,
  });
});

app.get('/logout', (req, res) => {
  res.clearCookie('visitor');
  res.redirect('/');
});

// =======================================================================
// ADMIN (protege par le mot de passe admin, chemin non affiche)
// =======================================================================

function requireAdmin(req, res, next) {
  if (auth.isAdminAuthed(req)) return next();
  return res.status(401).render('admin-login', {
    adminPath: ADMIN_PATH,
    error: false,
  });
}

// Page de connexion admin + traitement du formulaire (meme URL).
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
  const points = cfg.points.map((p) => ({
    ...p,
    destLabel: destLabel(p.dest),
    url: pointUrl(req, p.dest),
  }));
  res.render('admin', {
    cfg,
    points,
    destinations: DESTINATIONS,
    adminPath: ADMIN_PATH,
    baseUrl: baseUrl(req),
    saved: req.query.saved || '',
  });
}

// --- Contenu : intro / titre ---
app.post(ADMIN_PATH + '/content', requireAdmin, (req, res) => {
  store.update((cfg) => {
    cfg.siteTitle = (req.body.siteTitle || '').slice(0, 120) || cfg.siteTitle;
    cfg.intro = (req.body.intro || '').slice(0, 5000);
  });
  res.redirect(ADMIN_PATH + '?saved=contenu');
});

// --- Mot de passe visiteur ---
app.post(ADMIN_PATH + '/password', requireAdmin, (req, res) => {
  const pw = (req.body.sitePassword || '').trim();
  if (pw.length >= 3) {
    store.update((cfg) => {
      cfg.sitePassword = pw;
    });
    // renouvelle le cookie visiteur de l'admin s'il en a un
    auth.setVisitorCookie(req, res);
  }
  res.redirect(ADMIN_PATH + '?saved=motdepasse');
});

// --- Carte ---
app.post(
  ADMIN_PATH + '/map',
  requireAdmin,
  upload.single('mapImage'),
  (req, res) => {
    store.update((cfg) => {
      cfg.map.embed = (req.body.mapEmbed || '').trim().slice(0, 2000);
      cfg.map.caption = (req.body.mapCaption || '').slice(0, 300);
      cfg.map.description = (req.body.mapDescription || '').slice(0, 3000);
      if (req.file) {
        removeUpload(cfg.map.image);
        cfg.map.image = req.file.filename;
      } else if (req.body.removeMapImage === '1') {
        removeUpload(cfg.map.image);
        cfg.map.image = '';
      }
    });
    res.redirect(ADMIN_PATH + '?saved=carte');
  }
);

// --- Galerie : ajout ---
app.post(
  ADMIN_PATH + '/gallery',
  requireAdmin,
  upload.single('media'),
  (req, res) => {
    store.update((cfg) => {
      const item = {
        id: store.newId(),
        title: (req.body.title || 'Sans titre').slice(0, 200),
        description: (req.body.description || '').slice(0, 3000),
        media: '',
        mediaType: '',
        embedUrl: (req.body.embedUrl || '').trim().slice(0, 2000),
      };
      if (req.file) {
        item.media = req.file.filename;
        item.mediaType = mediaType(req.file.mimetype);
      }
      cfg.gallery.push(item);
    });
    res.redirect(ADMIN_PATH + '?saved=galerie');
  }
);

// --- Galerie : suppression ---
app.post(ADMIN_PATH + '/gallery/:id/delete', requireAdmin, (req, res) => {
  store.update((cfg) => {
    const idx = cfg.gallery.findIndex((g) => g.id === req.params.id);
    if (idx !== -1) {
      removeUpload(cfg.gallery[idx].media);
      cfg.gallery.splice(idx, 1);
    }
  });
  res.redirect(ADMIN_PATH + '?saved=galerie');
});

// --- Points (balises NFC/QR) : ajout ---
app.post(ADMIN_PATH + '/points', requireAdmin, (req, res) => {
  const dest = req.body.dest || '/';
  if (!DESTINATIONS.some((d) => d.value === dest)) {
    return res.redirect(ADMIN_PATH);
  }
  store.update((cfg) => {
    cfg.points.push({
      id: store.newId(),
      label: (req.body.label || 'Balise').slice(0, 120),
      dest,
      note: (req.body.note || '').slice(0, 500),
    });
  });
  res.redirect(ADMIN_PATH + '?saved=balise');
});

// --- Points : suppression ---
app.post(ADMIN_PATH + '/points/:id/delete', requireAdmin, (req, res) => {
  store.update((cfg) => {
    const idx = cfg.points.findIndex((p) => p.id === req.params.id);
    if (idx !== -1) cfg.points.splice(idx, 1);
  });
  res.redirect(ADMIN_PATH + '?saved=balise');
});

// --- QR code d'une balise (PNG) ---
app.get(ADMIN_PATH + '/qr/:id.png', requireAdmin, async (req, res) => {
  const cfg = store.get();
  const point = cfg.points.find((p) => p.id === req.params.id);
  if (!point) return res.status(404).send('Balise introuvable');
  try {
    const png = await QRCode.toBuffer(pointUrl(req, point.dest), {
      type: 'png',
      width: 800,
      margin: 2,
      errorCorrectionLevel: 'M',
    });
    res.set('Content-Type', 'image/png');
    res.set(
      'Content-Disposition',
      'attachment; filename="qr-' + slug(point.label) + '.png"'
    );
    res.send(png);
  } catch (err) {
    res.status(500).send('Erreur QR : ' + err.message);
  }
});

// --- Page imprimable de toutes les balises ---
app.get(ADMIN_PATH + '/tags', requireAdmin, async (req, res) => {
  const cfg = store.get();
  const points = await Promise.all(
    cfg.points.map(async (p) => ({
      ...p,
      destLabel: destLabel(p.dest),
      url: pointUrl(req, p.dest),
      dataUrl: await QRCode.toDataURL(pointUrl(req, p.dest), {
        width: 320,
        margin: 1,
      }),
    }))
  );
  res.render('tags', { cfg, points, adminPath: ADMIN_PATH });
});

function slug(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'balise';
}

// ---- Divers ------------------------------------------------------------

app.get('/healthz', (req, res) => res.type('text').send('ok'));

app.use((req, res) => {
  res.status(404).render('login', {
    title: store.get().siteTitle,
    next: '/',
    error: false,
  });
});

app.listen(PORT, () => {
  console.log('Site en ligne sur http://localhost:' + PORT);
  console.log('Admin (non liee) : ' + ADMIN_PATH);
});
