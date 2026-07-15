'use strict';
// Palette de variables live : glisser-déposer + clic pour insérer un jeton
// {{source.chemin}} dans le dernier champ texte utilisé.

(function () {
  var palette = document.getElementById('palette');
  var body = document.getElementById('palette-body');
  if (!palette || !body) return;

  var lastField = null;

  // Mémorise le dernier champ "à jetons" utilisé.
  document.addEventListener('focusin', function (e) {
    if (e.target.matches('[data-token="1"]')) lastField = e.target;
  });

  function insertToken(field, token) {
    if (!field) return;
    var start = field.selectionStart != null ? field.selectionStart : field.value.length;
    var end = field.selectionEnd != null ? field.selectionEnd : field.value.length;
    field.value = field.value.slice(0, start) + token + field.value.slice(end);
    var pos = start + token.length;
    field.focus();
    try { field.setSelectionRange(pos, pos); } catch (_) {}
  }

  // Drop sur n'importe quel champ à jetons.
  document.addEventListener('dragover', function (e) {
    if (e.target.matches('[data-token="1"]')) { e.preventDefault(); e.target.classList.add('drop-hot'); }
  });
  document.addEventListener('dragleave', function (e) {
    if (e.target.matches('[data-token="1"]')) e.target.classList.remove('drop-hot');
  });
  document.addEventListener('drop', function (e) {
    if (e.target.matches('[data-token="1"]')) {
      e.preventDefault();
      e.target.classList.remove('drop-hot');
      var token = e.dataTransfer.getData('text/plain');
      if (token) { insertToken(e.target, token); lastField = e.target; }
    }
  });

  function chip(v) {
    var el = document.createElement('button');
    el.type = 'button';
    el.className = 'chip';
    el.draggable = true;
    el.dataset.token = v.token;
    el.title = v.token + '  =  ' + v.preview;
    el.innerHTML = '<span class="chip-path">' + escapeHtml(v.path) + '</span><span class="chip-val">' + escapeHtml(v.preview) + '</span>';
    el.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/plain', v.token); });
    el.addEventListener('click', function () {
      if (!lastField) { flash('Clique d\'abord dans un champ texte.'); return; }
      insertToken(lastField, v.token);
    });
    return el;
  }

  function render(data) {
    body.innerHTML = '';
    if (!data.sources || !data.sources.length) {
      body.innerHTML = '<p class="muted small">Aucune source. Ajoute-en une dans l\'administration (« Données live »).</p>';
      return;
    }
    data.sources.forEach(function (s) {
      var group = document.createElement('div');
      group.className = 'chip-group';
      var h = document.createElement('div');
      h.className = 'chip-group-head';
      h.textContent = s.name + (s.ok ? '' : ' ⚠');
      if (!s.ok && s.error) h.title = 'Erreur : ' + s.error;
      group.appendChild(h);
      if (!s.vars.length) {
        var p = document.createElement('p');
        p.className = 'muted small';
        p.textContent = s.ok ? 'Aucune variable.' : ('Injoignable : ' + (s.error || ''));
        group.appendChild(p);
      } else {
        s.vars.forEach(function (v) { group.appendChild(chip(v)); });
      }
      body.appendChild(group);
    });
  }

  function flash(msg) {
    var d = document.createElement('div');
    d.className = 'flash';
    d.textContent = msg;
    document.body.appendChild(d);
    setTimeout(function () { d.remove(); }, 2200);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function load() {
    fetch(palette.dataset.varsUrl, { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(render)
      .catch(function () { body.innerHTML = '<p class="muted small">Impossible de charger les variables.</p>'; });
  }

  load();
  var reload = document.createElement('button');
  reload.type = 'button';
  reload.className = 'btn-link mini';
  reload.textContent = '↻ Rafraîchir';
  reload.addEventListener('click', load);
  palette.appendChild(reload);
})();
