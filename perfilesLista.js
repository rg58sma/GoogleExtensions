/* Panel "Perfiles de esta pagina": en los listados del sitio (busqueda,
   visitas, seguidores... NO dentro de un perfil) muestra cada perfil listado:
   si ya entraste, cuantos videos tiene en el sitio y cuantos hay en disco.
   - "Visto" sale de csVideoUltimo (lo guarda perfilVideos.js al entrar).
   - Videos del sitio: cache csVideoSitio; los que faltan se consultan de a
     uno a la API del perfil, con pausa, y se guardan 12 h.
   - Videos en disco: indice de la carpeta local (indice.js). */
(function () {
  'use strict';

  var BODY_ID = 'csPerfilesLista';
  var SITIO_TTL_MS = 12 * 3600 * 1000;
  var PAUSA_MS = 400;
  var REINTENTO_MS = 5 * 60 * 1000;
  var cola = [], enCola = {}, fallo = {}, trabajando = false;
  var usuarios = [], firma = '', ultimoHtml = '', t = null;
  var filtros = { soloVideos: false, ocultarVistos: false };

  function contextoOk() {
    return CSPaneles.contextoOk();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  // ---- Consulta de videos del sitio (de a uno, con pausa) ----
  function encolar(user) {
    var k = user.toLowerCase();
    if (enCola[k] || (fallo[k] && Date.now() - fallo[k] < REINTENTO_MS)) return;
    enCola[k] = 1;
    cola.push(user);
    if (!trabajando) trabajar();
  }

  async function trabajar() {
    trabajando = true;
    while (cola.length && contextoOk()) {
      var user = cola.shift();
      // Si ya no esta en pantalla (se cambio de pagina), no gastar la consulta.
      if (usuarios.indexOf(user) === -1) { delete enCola[user.toLowerCase()]; continue; }
      try {
        var r = await fetch('/api/members/profile/' + encodeURIComponent(user), { headers: { 'Accept': 'application/json' } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        await CSIndice.guardarSitio(user, CSIndice.videosDePerfil(await r.json()));
        delete fallo[user.toLowerCase()];
      } catch (e) {
        fallo[user.toLowerCase()] = Date.now();   // no reintentar enseguida
      }
      delete enCola[user.toLowerCase()];
      schedule();
      await new Promise(function (res) { setTimeout(res, PAUSA_MS); });
    }
    trabajando = false;
  }

  // ---- Dibujo ----
  function estadoFila(sitio, disco) {
    if (!sitio) return { txt: 'consultando…', color: '#888' };
    if (!sitio.n) return { txt: 'sin videos', color: '#777' };
    if (!disco || !disco.n) return { txt: 'faltan ' + sitio.n, color: '#ff6b6b' };
    if (disco.n >= sitio.n) return { txt: 'completo', color: '#51cf66' };
    return { txt: 'faltan ' + (sitio.n - disco.n), color: '#ff6b6b' };
  }

  async function dibujar() {
    var st = await chrome.storage.local.get(['csVideoFolder', 'csVideoUltimo', 'csVideoSitio']);
    var idx = st.csVideoFolder && st.csVideoFolder.carpetas ? st.csVideoFolder : null;
    var vistos = st.csVideoUltimo || {}, sitioC = st.csVideoSitio || {};

    var filas = [], nVideos = 0, nVistos = 0, nFaltan = 0, nPend = 0;
    usuarios.forEach(function (u) {
      var k = u.toLowerCase();
      var s = sitioC[k];
      if (!s || Date.now() - s.at > SITIO_TTL_MS) {
        encolar(u);
        // Mientras tanto, si ya entraste, usar lo que se vio en el perfil.
        if (!s && vistos[k]) s = { n: vistos[k].perfil, at: vistos[k].at };
      }
      var d = idx ? CSIndice.buscar(idx, u) : null;
      var e = estadoFila(s, d);
      var visto = vistos[k];
      if (!s) nPend++;
      if (s && s.n) nVideos++;
      if (visto) nVistos++;
      if (e.txt.indexOf('faltan') === 0) nFaltan++;
      if (filtros.soloVideos && s && !s.n) return;
      if (filtros.ocultarVistos && visto) return;
      filas.push(
        '<div style="display:flex;gap:6px;align-items:baseline;padding:3px 0;border-bottom:1px solid #222">' +
          '<a href="/members/profile/' + encodeURIComponent(u) + '" style="color:#fff;text-decoration:none;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escapeHtml(u) + '">' +
            (visto ? '<span style="color:#74c0fc" title="Entraste ' + CSPaneles.hace(visto.at) + '">●</span> ' : '<span style="color:#444" title="Nunca entraste">○</span> ') +
            escapeHtml(u) + '</a>' +
          '<span style="color:#aaa;white-space:nowrap" title="videos en el sitio / en disco">' +
            (s ? s.n : '?') + ' / ' + (d ? d.n : 0) + '</span>' +
          '<span style="color:' + e.color + ';white-space:nowrap;min-width:78px;text-align:right">' + e.txt + '</span>' +
        '</div>'
      );
    });

    var chk = function (id, on, txt) {
      return '<label style="margin-right:10px;cursor:pointer"><input type="checkbox" data-filtro="' + id + '"' + (on ? ' checked' : '') +
        ' style="vertical-align:middle;margin:0 4px 0 0">' + txt + '</label>';
    };
    var html =
      '<div style="color:#aaa">' + usuarios.length + ' perfiles · <span style="color:#fff">' + nVideos + ' con videos</span> · ' +
        '<span style="color:#74c0fc">' + nVistos + ' vistos</span> · <span style="color:' + (nFaltan ? '#ff6b6b' : '#aaa') + '">' + nFaltan + ' con faltantes</span>' +
        (nPend ? ' · <span style="color:#888">consultando ' + nPend + '…</span>' : '') + '</div>' +
      (idx ? '' : '<div style="color:#ffb300;margin-top:4px">Sin carpeta elegida: el disco cuenta 0.</div>') +
      '<div style="margin:6px 0 4px;font-size:12px;color:#ccc">' +
        chk('soloVideos', filtros.soloVideos, 'Solo con videos') + chk('ocultarVistos', filtros.ocultarVistos, 'Ocultar vistos') + '</div>' +
      '<div style="color:#666;font-size:11px;display:flex;gap:6px"><span style="flex:1">● visto  ○ no visto</span><span>sitio / disco</span><span style="min-width:78px;text-align:right">estado</span></div>' +
      '<div data-rol="lista" style="max-height:260px;overflow:auto">' + (filas.join('') || '<div style="color:#777;padding:4px 0">Nada para mostrar con estos filtros.</div>') + '</div>';

    var el = CSPaneles.cuerpo('perfiles', BODY_ID);
    if (!el || html === ultimoHtml) return;
    ultimoHtml = html;
    var lista = el.querySelector('[data-rol="lista"]');
    var scroll = lista ? lista.scrollTop : 0;
    el.innerHTML = html;
    lista = el.querySelector('[data-rol="lista"]');
    if (lista) lista.scrollTop = scroll;
    Array.prototype.forEach.call(el.querySelectorAll('[data-filtro]'), function (cb) {
      cb.onchange = function () {
        filtros[cb.getAttribute('data-filtro')] = cb.checked;
        chrome.storage.local.set({ csPerfilesFiltros: filtros }).catch(function () { });
        schedule();
      };
    });
  }

  function schedule() {
    if (t) clearTimeout(t);
    t = setTimeout(function () {
      if (!contextoOk()) return;
      dibujar().catch(function () { });
    }, 200);
  }

  // Revisa la pagina cada 2 s (listados con scroll infinito / navegacion SPA).
  function revisar() {
    if (!contextoOk()) { clearInterval(timer); return; }
    var us = CSListado.usuarios();
    var f = us.join('\n');
    if (f === firma) return;
    firma = f;
    usuarios = us;
    CSPaneles.disponible('perfiles', us.length > 0);
    if (us.length) schedule();
  }

  if (!contextoOk()) return;
  chrome.storage.local.get('csPerfilesFiltros').then(function (st) {
    if (st.csPerfilesFiltros) filtros = Object.assign(filtros, st.csPerfilesFiltros);
    revisar();
  }).catch(function () { });
  var timer = setInterval(revisar, 2000);
  chrome.storage.onChanged.addListener(function (ch, area) {
    if (area === 'local' && usuarios.length && (ch.csVideoFolder || ch.csVideoUltimo || ch.csVideoSitio)) schedule();
  });
})();
