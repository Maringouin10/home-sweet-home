'use strict';

// Petit "store" de donnees base sur un fichier JSON.
// Tout est stocke dans DATA_DIR (monte comme volume Docker) pour survivre
// aux redemarrages du conteneur.

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

function defaults() {
  return {
    siteTitle: 'Mon terrain',
    intro:
      "Bienvenue sur mon terrain. Cette page raconte les projets, les chantiers " +
      "et les coins a decouvrir. Suis les balises (QR code / NFC) posees sur place " +
      "pour ouvrir la bonne info au bon endroit.",
    // Mot de passe visiteur : modifiable depuis l'admin, initialise depuis l'env.
    sitePassword: process.env.SITE_PASSWORD || 'terrain',
    map: {
      embed: '', // URL d'iframe (ex: Google My Maps) - prioritaire si presente
      image: '', // nom de fichier uploade dans data/uploads
      caption: '',
      description: '',
    },
    // Elements de galerie / time-lapse : { id, title, description, media, mediaType, embedUrl }
    gallery: [],
    // Balises NFC / QR : { id, label, dest, note }
    points: [],
  };
}

let cache = null;

function load() {
  ensureDirs();
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      // fusion douce avec les defauts pour les champs manquants
      cache = Object.assign(defaults(), raw);
      cache.map = Object.assign(defaults().map, raw.map || {});
      cache.gallery = Array.isArray(raw.gallery) ? raw.gallery : [];
      cache.points = Array.isArray(raw.points) ? raw.points : [];
    } catch (err) {
      console.error('config.json illisible, utilisation des valeurs par defaut :', err.message);
      cache = defaults();
    }
  } else {
    cache = defaults();
    save(cache);
  }
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

// Modifie la config via une fonction et sauvegarde.
function update(mutator) {
  const cfg = get();
  mutator(cfg);
  return save(cfg);
}

function newId() {
  return crypto.randomBytes(6).toString('hex');
}

module.exports = {
  DATA_DIR,
  UPLOADS_DIR,
  CONFIG_PATH,
  ensureDirs,
  defaults,
  load,
  get,
  save,
  update,
  newId,
};
