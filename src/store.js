'use strict';

// Store de donnees base sur un fichier JSON (dans DATA_DIR, monte en volume).
//
// Schema (nouveau) :
//   siteTitle, sitePassword, homePageId
//   sources: [ { id, name, url, headers, ttl } ]           <- donnees "live"
//   pages:   [ { id, slug, title, icon, order, published, blocks:[...] } ]
//   points:  [ { id, label, pageId, note } ]               <- balises NFC/QR
//
// Un bloc = { id, type, ...champs } ; type ∈ heading|text|stat|image|video|embed|divider

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function newId() {
  return crypto.randomBytes(6).toString('hex');
}

// --- Contenu de départ (installation neuve) ---
function seedPages() {
  const home = {
    id: newId(),
    slug: 'accueil',
    title: 'Accueil',
    icon: '🏡',
    order: 0,
    published: true,
    blocks: [
      { id: newId(), type: 'heading', text: 'Bienvenue sur mon terrain', level: 1 },
      {
        id: newId(),
        type: 'text',
        body:
          "Cette page raconte les projets et les chantiers du terrain. Suis les balises " +
          "(QR code / NFC) posées sur place pour ouvrir la bonne info au bon endroit.",
      },
    ],
  };
  const carte = {
    id: newId(),
    slug: 'carte',
    title: 'Carte',
    icon: '🗺️',
    order: 1,
    published: true,
    blocks: [
      { id: newId(), type: 'heading', text: 'Carte du terrain', level: 1 },
      {
        id: newId(),
        type: 'text',
        body: "Ajoute ici une carte Google My Maps (bloc « Intégration ») ou une image.",
      },
    ],
  };
  const galerie = {
    id: newId(),
    slug: 'galerie',
    title: 'Galerie',
    icon: '🎬',
    order: 2,
    published: true,
    blocks: [{ id: newId(), type: 'heading', text: 'Galerie & time-lapse', level: 1 }],
  };
  return { pages: [home, carte, galerie], homePageId: home.id };
}

// --- Migration depuis l'ancien schema (map/gallery/intro) ---
function migrateOldContent(raw) {
  const pages = [];
  const home = {
    id: newId(),
    slug: 'accueil',
    title: 'Accueil',
    icon: '🏡',
    order: 0,
    published: true,
    blocks: [{ id: newId(), type: 'heading', text: raw.siteTitle || 'Accueil', level: 1 }],
  };
  home.blocks.push({
    id: newId(),
    type: 'text',
    body: raw.intro || 'Bienvenue sur mon terrain.',
  });
  pages.push(home);

  const map = raw.map || {};
  const carte = {
    id: newId(),
    slug: 'carte',
    title: 'Carte',
    icon: '🗺️',
    order: 1,
    published: true,
    blocks: [{ id: newId(), type: 'heading', text: 'Carte du terrain', level: 1 }],
  };
  if (map.embed) carte.blocks.push({ id: newId(), type: 'embed', src: map.embed, height: 520 });
  else if (map.image)
    carte.blocks.push({ id: newId(), type: 'image', media: map.image, caption: map.caption || '' });
  if (map.description) carte.blocks.push({ id: newId(), type: 'text', body: map.description });
  pages.push(carte);

  const galerie = {
    id: newId(),
    slug: 'galerie',
    title: 'Galerie',
    icon: '🎬',
    order: 2,
    published: true,
    blocks: [{ id: newId(), type: 'heading', text: 'Galerie & time-lapse', level: 1 }],
  };
  (raw.gallery || []).forEach((g) => {
    galerie.blocks.push({ id: newId(), type: 'heading', text: g.title || 'Sans titre', level: 2 });
    if (g.embedUrl) galerie.blocks.push({ id: newId(), type: 'video', embedUrl: g.embedUrl });
    else if (g.media && g.mediaType === 'video')
      galerie.blocks.push({ id: newId(), type: 'video', media: g.media });
    else if (g.media) galerie.blocks.push({ id: newId(), type: 'image', media: g.media, caption: '' });
    if (g.description) galerie.blocks.push({ id: newId(), type: 'text', body: g.description });
  });
  pages.push(galerie);

  const byDest = { '/': home.id, '/carte': carte.id, '/galerie': galerie.id };
  const points = (raw.points || []).map((p) => ({
    id: p.id || newId(),
    label: p.label || 'Balise',
    pageId: byDest[p.dest] || home.id,
    note: p.note || '',
  }));

  return { pages, homePageId: home.id, points };
}

function migrate(raw) {
  raw = raw || {};
  const cfg = {
    siteTitle: raw.siteTitle || 'Mon terrain',
    sitePassword: raw.sitePassword || process.env.SITE_PASSWORD || 'terrain',
    sources: Array.isArray(raw.sources) ? raw.sources : [],
    pages: Array.isArray(raw.pages) ? raw.pages : null,
    homePageId: raw.homePageId || null,
    points: Array.isArray(raw.points) ? raw.points : [],
  };

  if (!cfg.pages) {
    // Ancien schema (map/gallery/intro) OU installation neuve
    if (raw.map || raw.gallery || raw.intro) {
      const migrated = migrateOldContent(raw);
      cfg.pages = migrated.pages;
      cfg.homePageId = migrated.homePageId;
      cfg.points = migrated.points;
    } else {
      const seeded = seedPages();
      cfg.pages = seeded.pages;
      cfg.homePageId = seeded.homePageId;
    }
  }

  // Garde-fous
  cfg.pages.forEach((p, i) => {
    if (typeof p.order !== 'number') p.order = i;
    if (!Array.isArray(p.blocks)) p.blocks = [];
    if (typeof p.published !== 'boolean') p.published = true;
  });
  if (!cfg.pages.some((p) => p.id === cfg.homePageId)) {
    const first = cfg.pages.slice().sort((a, b) => a.order - b.order)[0];
    cfg.homePageId = first ? first.id : null;
  }
  // Chaque balise pointe vers une page existante
  cfg.points = cfg.points.map((p) => ({
    id: p.id || newId(),
    label: p.label || 'Balise',
    pageId: cfg.pages.some((pg) => pg.id === p.pageId) ? p.pageId : cfg.homePageId,
    note: p.note || '',
  }));
  return cfg;
}

let cache = null;

function load() {
  ensureDirs();
  let raw = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (err) {
      console.error('config.json illisible, réinitialisation :', err.message);
      raw = {};
    }
  }
  cache = migrate(raw);
  save(cache); // persiste la migration / le contenu de départ
  return cache;
}

function get() {
  if (!cache) load();
  return cache;
}

function save(next) {
  ensureDirs();
  cache = next;
  const tmp = CONFIG_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, CONFIG_PATH);
  return cache;
}

function update(mutator) {
  const cfg = get();
  mutator(cfg);
  return save(cfg);
}

// --- Helpers pages / blocs ---
function sortedPages(cfg) {
  return (cfg || get()).pages.slice().sort((a, b) => a.order - b.order);
}
function publishedPages(cfg) {
  return sortedPages(cfg).filter((p) => p.published);
}
function pageById(id, cfg) {
  return (cfg || get()).pages.find((p) => p.id === id) || null;
}
function pageBySlug(slug, cfg) {
  return (cfg || get()).pages.find((p) => p.slug === slug) || null;
}
function homePage(cfg) {
  cfg = cfg || get();
  return pageById(cfg.homePageId, cfg) || sortedPages(cfg)[0] || null;
}

module.exports = {
  DATA_DIR,
  UPLOADS_DIR,
  CONFIG_PATH,
  ensureDirs,
  migrate,
  load,
  get,
  save,
  update,
  newId,
  sortedPages,
  publishedPages,
  pageById,
  pageBySlug,
  homePage,
};
