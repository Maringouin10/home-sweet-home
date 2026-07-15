'use strict';
// Bouton « Tester / voir les variables » d'une source, dans l'administration.
(function () {
  document.querySelectorAll('[data-preview]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var id = btn.getAttribute('data-preview');
      var box = document.getElementById('preview-' + id);
      if (!box) return;
      box.hidden = false;
      box.innerHTML = '<p class="muted small">Test en cours…</p>';
      var base = window.location.pathname.replace(/\/+$/, '');
      fetch(base + '/sources/' + id + '/preview', { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d.ok && d.error) {
            box.innerHTML = '<p class="error small">⚠ ' + esc(d.error) + '</p>';
          }
          if (!d.vars || !d.vars.length) {
            box.innerHTML += '<p class="muted small">Aucune variable détectée.</p>';
            return;
          }
          var html = '<p class="muted small">Variables détectées (clique pour copier le jeton) :</p><div class="chips">';
          d.vars.forEach(function (v) {
            html += '<button type="button" class="chip" data-copy="' + esc(v.token) + '" title="' + esc(v.token) + '">' +
              '<span class="chip-path">' + esc(v.path) + '</span><span class="chip-val">' + esc(v.preview) + '</span></button>';
          });
          html += '</div>';
          box.innerHTML = (box.innerHTML.indexOf('error') !== -1 ? box.innerHTML : '') + html;
          box.querySelectorAll('[data-copy]').forEach(function (c) {
            c.addEventListener('click', function () {
              var t = c.getAttribute('data-copy');
              if (navigator.clipboard) navigator.clipboard.writeText(t);
              c.classList.add('copied');
              setTimeout(function () { c.classList.remove('copied'); }, 1000);
            });
          });
        })
        .catch(function () { box.innerHTML = '<p class="error small">Erreur de test.</p>'; });
    });
  });
})();
function esc(s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}
