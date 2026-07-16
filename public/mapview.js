'use strict';
// Affiche les blocs carte (Leaflet) : fond de plan / satellite, overlay KML
// (GeoJSON) et points cliquables qui mènent vers une page.

(function () {
  if (typeof L === 'undefined') return;

  var GOOGLE_SUBS = ['mt0', 'mt1', 'mt2', 'mt3'];
  function basemaps() {
    return {
      // Imagerie satellite Google (comme Google Earth)
      satellite: L.tileLayer('https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
        subdomains: GOOGLE_SUBS, maxZoom: 21, attribution: 'Imagerie &copy; Google',
      }),
      // Satellite + noms de rues / lieux (Google hybride)
      hybride: L.tileLayer('https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        subdomains: GOOGLE_SUBS, maxZoom: 21, attribution: 'Imagerie &copy; Google',
      }),
      plan: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; OpenStreetMap',
      }),
    };
  }

  function emojiIcon(emoji) {
    return L.divIcon({
      className: 'emoji-marker',
      html: '<span>' + (emoji || '📍') + '</span>',
      iconSize: [34, 34],
      iconAnchor: [17, 32],
      popupAnchor: [0, -30],
    });
  }

  function initMap(container, data) {
    var bases = basemaps();
    var map = L.map(container, { scrollWheelZoom: false });
    (bases[data.basemap] || bases.satellite).addTo(map);
    L.control.layers(
      { 'Satellite': bases.satellite, 'Satellite + noms': bases.hybride, 'Plan': bases.plan },
      {}, { position: 'topright' }
    ).addTo(map);

    var bounds = null;

    // Overlay KML (GeoJSON)
    if (data.geojson) {
      var layer = L.geoJSON(data.geojson, {
        style: { color: '#2c4d33', weight: 3, fillColor: '#3f6b48', fillOpacity: 0.15 },
        pointToLayer: function (f, latlng) { return L.marker(latlng, { icon: emojiIcon('📌') }); },
        onEachFeature: function (f, lyr) {
          var name = f.properties && (f.properties.name || f.properties.Name);
          if (name) lyr.bindPopup(String(name));
        },
      }).addTo(map);
      try { bounds = layer.getBounds(); } catch (e) {}
    }

    // Points cliquables
    (data.points || []).forEach(function (p) {
      if (!isFinite(p.lat) || !isFinite(p.lng)) return;
      var m = L.marker([p.lat, p.lng], { icon: emojiIcon(p.emoji) }).addTo(map);
      var label = p.label || 'Point';
      if (p.href) {
        var html = '<div class="map-pop"><strong>' + esc(label) + '</strong>' +
          '<a class="map-open" href="' + esc(p.href) + '">Ouvrir ' + esc(p.targetTitle || 'la page') + ' →</a></div>';
        m.bindPopup(html);
        m.bindTooltip(label, { direction: 'top', offset: [0, -30] });
        // Tap direct : va sur la page
        m.on('click', function () { window.location.href = p.href; });
      } else {
        m.bindPopup('<strong>' + esc(label) + '</strong>');
      }
      bounds = bounds ? bounds.extend([p.lat, p.lng]) : L.latLngBounds([[p.lat, p.lng]]);
    });

    // Vue initiale
    if (data.center && isFinite(data.zoom)) {
      map.setView([data.center.lat, data.center.lng], data.zoom);
    } else if (bounds && bounds.isValid()) {
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 17 });
    } else {
      map.setView([46.8, -71.2], 6); // Québec par défaut
    }

    // Corrige l'affichage si le conteneur était masqué au chargement
    setTimeout(function () { map.invalidateSize(); }, 200);
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  document.querySelectorAll('script.mapdata').forEach(function (tag) {
    var container = document.getElementById(tag.getAttribute('data-target'));
    if (!container) return;
    var data;
    try { data = JSON.parse(tag.textContent); } catch (e) { return; }
    initMap(container, data);
  });
})();
