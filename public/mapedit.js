'use strict';
// Éditeur de carte (admin) : affiche la carte, l'overlay KML et les points
// existants ; clic sur la carte = nouveau point ; capture de la vue par défaut.

(function () {
  if (typeof L === 'undefined') return;

  var GOOGLE_SUBS = ['mt0', 'mt1', 'mt2', 'mt3'];
  function bases() {
    return {
      satellite: L.tileLayer('https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', { subdomains: GOOGLE_SUBS, maxZoom: 21, attribution: 'Imagerie &copy; Google' }),
      hybride: L.tileLayer('https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', { subdomains: GOOGLE_SUBS, maxZoom: 21, attribution: 'Imagerie &copy; Google' }),
      plan: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }),
    };
  }
  function emojiIcon(emoji) {
    return L.divIcon({ className: 'emoji-marker', html: '<span>' + (emoji || '📍') + '</span>', iconSize: [34, 34], iconAnchor: [17, 32] });
  }

  document.querySelectorAll('script.mapeditdata').forEach(function (tag) {
    var id = tag.getAttribute('data-target');
    var container = document.getElementById(id);
    if (!container) return;
    var data;
    try { data = JSON.parse(tag.textContent); } catch (e) { return; }
    var bid = id.replace('mapedit-', '');

    var b = bases();
    var map = L.map(container);
    (b[data.basemap] || b.satellite).addTo(map);
    L.control.layers(
      { 'Satellite': b.satellite, 'Satellite + noms': b.hybride, 'Plan': b.plan },
      {}, { position: 'topright' }
    ).addTo(map);

    var bounds = null;
    if (data.geojson) {
      var layer = L.geoJSON(data.geojson, {
        style: { color: '#2c4d33', weight: 3, fillColor: '#3f6b48', fillOpacity: 0.15 },
        pointToLayer: function (f, ll) { return L.marker(ll, { icon: emojiIcon('📌') }); },
      }).addTo(map);
      try { bounds = layer.getBounds(); } catch (e) {}
    }
    (data.points || []).forEach(function (p) {
      if (!isFinite(p.lat) || !isFinite(p.lng)) return;
      L.marker([p.lat, p.lng], { icon: emojiIcon(p.emoji) }).addTo(map).bindTooltip(p.label || 'Point', { direction: 'top', offset: [0, -28] });
      bounds = bounds ? bounds.extend([p.lat, p.lng]) : L.latLngBounds([[p.lat, p.lng]]);
    });

    if (data.center && isFinite(data.zoom)) map.setView([data.center.lat, data.center.lng], data.zoom);
    else if (bounds && bounds.isValid()) map.fitBounds(bounds, { padding: [25, 25], maxZoom: 17 });
    else map.setView([46.8, -71.2], 6);
    setTimeout(function () { map.invalidateSize(); }, 150);

    // Clic sur la carte -> remplit et affiche le formulaire d'ajout de point
    var tempMarker = null;
    map.on('click', function (e) {
      var lat = e.latlng.lat, lng = e.latlng.lng;
      var form = document.getElementById('addpoint-' + bid);
      var latEl = document.getElementById('addlat-' + bid);
      var lngEl = document.getElementById('addlng-' + bid);
      if (!form || !latEl || !lngEl) return;
      latEl.value = lat.toFixed(6);
      lngEl.value = lng.toFixed(6);
      form.hidden = false;
      form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      if (tempMarker) map.removeLayer(tempMarker);
      tempMarker = L.marker([lat, lng], { icon: emojiIcon('➕') }).addTo(map);
    });

    // Bouton « fixer la vue actuelle par défaut »
    var capture = document.querySelector('[data-capture="' + bid + '"]');
    if (capture) {
      capture.addEventListener('click', function () {
        var f = document.getElementById('mapview-' + bid);
        if (!f) return;
        var c = map.getCenter();
        f.querySelector('input[name="lat"]').value = c.lat.toFixed(6);
        f.querySelector('input[name="lng"]').value = c.lng.toFixed(6);
        f.querySelector('input[name="zoom"]').value = map.getZoom();
        f.submit();
      });
    }
  });
})();
