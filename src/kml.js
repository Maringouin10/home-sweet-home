'use strict';

// Conversion d'un fichier KML ou KMZ (Google Earth / My Maps) en GeoJSON,
// côté serveur, pour l'afficher sur la carte Leaflet.

const { DOMParser } = require('@xmldom/xmldom');
const tj = require('@tmcw/togeojson');
const AdmZip = require('adm-zip');

// Extrait le KML texte d'un buffer (.kml direct, ou .kmz = zip contenant un .kml).
function extractKmlString(buffer, filename) {
  const name = String(filename || '').toLowerCase();
  const looksZip = name.endsWith('.kmz') || (buffer[0] === 0x50 && buffer[1] === 0x4b); // "PK"
  if (looksZip) {
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();
    // doc.kml en priorité, sinon le premier .kml
    let entry = entries.find((e) => /(^|\/)doc\.kml$/i.test(e.entryName));
    if (!entry) entry = entries.find((e) => /\.kml$/i.test(e.entryName));
    if (!entry) throw new Error('KMZ sans fichier .kml');
    return entry.getData().toString('utf8');
  }
  return buffer.toString('utf8');
}

// Parse -> { geojson, bounds } où bounds = [[minLat,minLng],[maxLat,maxLng]] ou null.
function parse(buffer, filename) {
  const kmlString = extractKmlString(buffer, filename);
  const dom = new DOMParser({ onError: () => {} }).parseFromString(kmlString, 'text/xml');
  const geojson = tj.kml(dom);
  if (!geojson || !Array.isArray(geojson.features)) throw new Error('KML illisible');
  return { geojson, bounds: computeBounds(geojson) };
}

// Parcourt toutes les coordonnées pour calculer une emprise.
function computeBounds(geojson) {
  let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity;
  let found = false;
  const visit = (coords) => {
    if (typeof coords[0] === 'number') {
      const [lng, lat] = coords;
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        found = true;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
      }
    } else if (Array.isArray(coords)) {
      coords.forEach(visit);
    }
  };
  geojson.features.forEach((f) => {
    if (f.geometry && f.geometry.coordinates) visit(f.geometry.coordinates);
  });
  return found ? [[minLat, minLng], [maxLat, maxLng]] : null;
}

module.exports = { parse, extractKmlString, computeBounds };
