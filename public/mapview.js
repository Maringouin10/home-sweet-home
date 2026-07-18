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
        style: { color: '#ff2d2d', weight: 4, fillColor: '#ff2d2d', fillOpacity: 0.12 },
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
        var isAnchor = p.href.charAt(0) === '#';
        var verb = isAnchor ? 'Aller à ' : 'Ouvrir ';
        var fallback = isAnchor ? 'la section' : 'la page';
        var html = '<div class="map-pop"><strong>' + esc(label) + '</strong>' +
          '<a class="map-open" href="' + esc(p.href) + '">' + verb + esc(p.targetTitle || fallback) + ' →</a></div>';
        m.bindPopup(html);
        m.bindTooltip(label, { direction: 'top', offset: [0, -30] });
        // Tap direct : va vers la page, ou défile jusqu'au bloc de cette page.
        m.on('click', function () {
          if (isAnchor) scrollToBlock(p.href);
          else window.location.href = p.href;
        });
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

  // Défile jusqu'à un bloc de la même page (ancre #b-…), sous le header collant,
  // et le fait clignoter brièvement pour le repérer.
  function scrollToBlock(hash) {
    var anchor = document.getElementById(hash.slice(1));
    if (!anchor) { window.location.hash = hash; return; }
    var header = document.querySelector('.site-header');
    var offset = (header ? header.getBoundingClientRect().height : 0) + 14;
    var top = anchor.getBoundingClientRect().top + window.pageYOffset - offset;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    var block = anchor.nextElementSibling;
    if (block) {
      block.classList.add('blk-flash');
      setTimeout(function () { block.classList.remove('blk-flash'); }, 1600);
    }
  }

  document.querySelectorAll('script.mapdata').forEach(function (tag) {
    var container = document.getElementById(tag.getAttribute('data-target'));
    if (!container) return;
    var data;
    try { data = JSON.parse(tag.textContent); } catch (e) { return; }
    initMap(container, data);
  });
})();
