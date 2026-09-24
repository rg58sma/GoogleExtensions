/* Overlay: en cada perfil, comparar la cantidad de videos del sitio vs la
   carpeta local. La carpeta se elige y se lee desde carpeta.html / el service
   worker (ver indice.js); aca solo se lee el indice guardado en storage. */
(function () {
  'use strict';

  var BOX_ID = 'csVideoCmp';
  var API_TTL_MS = 60000;
  var VIVO_MS = 3000;          // con un perfil abierto, releer su carpeta cada 3 s
  var ultimaOk = 0;            // ultima relectura que el service worker confirmo
  var ultimoHtml = '';
  var lastUser = null;
  var seq = 0;
  var cacheApi = {};
  // Lo que mostro la ventanita en la visita ANTERIOR a este perfil
  // (se guarda en storage.csVideoUltimo por usuario).
  var visita = { user: null, prev: null, cargada: false };

  // Si la extension se recarga/actualiza con la pestana abierta, este script
  // queda huerfano y cualquier llamada a chrome.* tira "Extension context
  // invalidated". Se detecta, se paran los timers y se pide F5.
  var timers = [];
  function contextoOk() {
    try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; }
  }
  function detener() {
    timers.forEach(clearInterval);
    timers = [];
    var el = document.getElementById(BOX_ID);
    if (el) el.innerHTML = '<div style="color:#ffb300">La extensión se actualizó: apretá F5 para recargar la página.</div>';
  }

  function profileUsername() {
    var m = String(location.pathname || '').match(/\/members\/profile\/([^\/?#]+)/i);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function abrirCarpeta() {
    if (!contextoOk()) { detener(); return; }
    chrome.runtime.sendMessage({ type: 'openCarpeta' });
  }

  function pedirRelectura(user) {
    if (!contextoOk()) { detener(); return; }
    try {
      chrome.runtime.sendMessage({ type: 'releerCarpeta', user: user || null }, function (st) {
        if (chrome.runtime.lastError || !st) return;
        if (st.estado === 'ok' || st.estado === 'reciente') {
          var antes = ultimaOk;
          ultimaOk = Date.now();
          if (!antes || ultimaOk - antes > 10000) schedule(); // aparece el "en vivo"
        }
      });
    } catch (e) { }
  }

  function countDom() {
    var n = 0, seen = {};
    var nodes = document.querySelectorAll('a[href*="video-zoom"], a[href*="/videos/"], video, img[src*="/videos/"]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var key = el.getAttribute('href') || el.getAttribute('src') || ('n' + i);
      if (seen[key]) continue;
      seen[key] = 1;
      n++;
    }
    return n;
  }

  async function countApi(user) {
    var c = cacheApi[user];
    if (c && Date.now() - c.at < API_TTL_MS) return c.v;
    var r = await fetch('/api/members/profile/' + encodeURIComponent(user), {
      headers: { 'Accept': 'application/json' }
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    var p = await r.json();
    var vp = CSIndice.videosDePerfil(p);
    var v = { n: vp.n, total: vp.total, lista: vp.lista, source: 'api' };
    cacheApi[user] = { at: Date.now(), v: v };
    CSIndice.guardarSitio(user, v).catch(function () { });
    return v;
  }

  // El cuerpo vive en el dock de paneles (paneles.js): se puede plegar/ocultar.
  function box() {
    return CSPaneles.cuerpo('videos', BOX_ID);
  }

  function render(html) {
    var el = box();
    if (!el) return;
    if (html === ultimoHtml && el.innerHTML) return; // nada cambio: no parpadear
    ultimoHtml = html;
    var lista = el.querySelector('#csVideoLista');
    var scroll = lista ? lista.scrollTop : 0;
    el.innerHTML = html;
    lista = el.querySelector('#csVideoLista');
    if (lista) lista.scrollTop = scroll;
    Array.prototype.forEach.call(el.querySelectorAll('[data-desc]'), function (b) {
      b.onclick = function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        accionDescarga(b.getAttribute('data-desc'));
      };
    });
    var btn = el.querySelector('#csVideoElegir');
    if (btn) btn.onclick = function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      abrirCarpeta();
    };
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function botonElegir(label) {
    return '<button id="csVideoElegir" type="button" style="margin-top:8px;background:#20c997;color:#fff;border:0;font:bold 13px Arial;padding:8px 12px;border-radius:8px;cursor:pointer">' +
      escapeHtml(label) + '</button>';
  }

  function hace(ms) {
    var s = Math.round((Date.now() - ms) / 1000);
    if (s < 60) return 'hace ' + s + ' s';
    if (s < 3600) return 'hace ' + Math.round(s / 60) + ' min';
    if (s < 86400) return 'hace ' + Math.round(s / 3600) + ' h';
    var d = Math.round(s / 86400);
    return 'hace ' + d + (d === 1 ? ' día' : ' días');
  }

  function avisoEstado(st) {
    if (!st) return '';
    if (st.estado === 'sin-permiso') return '<div style="margin-top:6px;color:#ffb300">Chrome perdió el permiso de la carpeta: los números pueden estar viejos. Apretá "Carpeta…" y luego "Volver a leer".</div>';
    if (st.estado === 'error') return '<div style="margin-top:6px;color:#ff6b6b">No se pudo releer la carpeta: ' + escapeHtml(st.error || '') + '</div>';
    return '';
  }

  function refresh() {
    if (!contextoOk()) { detener(); return; }
    dibujar().catch(function (e) { if (!contextoOk()) detener(); });
  }

  async function dibujar() {
    if (!document.body) return;
    var mio = ++seq;

    var st = await chrome.storage.local.get(['csVideoFolder', 'csVideoEstado', 'csVideoUltimo']);
    var ultimos = st.csVideoUltimo || {};
    var idx = st.csVideoFolder && st.csVideoFolder.carpetas ? st.csVideoFolder : null;
    var user = profileUsername();
    var enVivo = user && Date.now() - ultimaOk < 10000;
    var pie = (idx ? '<div style="margin-top:6px;color:#888;font-size:11px">' +
        (enVivo ? '<span style="color:#51cf66">●</span> Carpeta actualizándose en vivo'
                : 'Carpeta leída ' + hace(Math.max(idx.scannedAt, ultimaOk))) + '</div>' : '') +
      (enVivo ? '' : avisoEstado(st.csVideoEstado));

    if (!user) {
      if (mio !== seq) return;
      render(
        '<div style="font-weight:700;margin-bottom:6px">Carpeta de videos</div>' +
        (idx
          ? '<div>Usando: <b>' + escapeHtml(idx.rootName) + '</b><br><span style="color:#aaa">' + (idx.totalFiles || 0) + ' videos' +
            (idx.totalCopias ? ', ' + idx.totalCopias + (idx.totalCopias > 1 ? ' copias' : ' copia') : '') + '</span>' +
            resumenCarpetas(idx) +
            '</div>'
          : '<div style="color:#ffb300">Todavía no elegiste la carpeta de descargas.</div>') +
        pie +
        botonElegir(idx ? 'Carpeta…' : 'Elegir carpeta…')
      );
      return;
    }

    var k = user.toLowerCase();
    if (visita.user !== k || !visita.cargada) {
      visita = { user: k, prev: ultimos[k] || null, cargada: true };
      // Mientras responde el sitio, mostrar ya lo de la visita anterior.
      if (visita.prev && mio === seq) {
        render(
          '<div style="font-weight:700;margin-bottom:4px">Videos de ' + escapeHtml(user) + '</div>' +
          lineaAnterior(visita.prev, null) +
          '<div style="margin-top:4px;color:#888">Actualizando…</div>' +
          botonElegir(idx ? 'Carpeta…' : 'Elegir carpeta…')
        );
      }
    }

    var perfil;
    try { perfil = await countApi(user); }
    catch (e) { perfil = { n: countDom(), total: null, source: 'dom' }; }
    if (mio !== seq) return; // llego tarde: ya se navego a otro perfil

    var loc = CSIndice.buscar(idx, user);
    var nPerfil = perfil.n;
    var nDisk = loc ? loc.n : 0;
    var falta = Math.max(0, nPerfil - nDisk);
    var sobra = Math.max(0, nDisk - nPerfil);
    var color = !idx ? '#ffb300' : (falta ? '#ff6b6b' : '#51cf66');
    var ahora = { perfil: nPerfil, disco: nDisk, copias: loc ? loc.copias.length : 0, at: Date.now() };
    var u = ultimos[k];
    // Guardar solo si cambio algo (o cada 10 min), no en cada relectura.
    if (idx && (!u || u.perfil !== ahora.perfil || u.disco !== ahora.disco || u.copias !== ahora.copias || ahora.at - u.at > 600000)) {
      ultimos[k] = ahora;
      chrome.storage.local.set({ csVideoUltimo: ultimos }).catch(function () { });
    }
    var bajando = loc ? loc.bajando : [];

    var extra = '';
    if (loc && (loc.files.length || loc.copias.length || bajando.length)) {
      var filas = bajando.map(function (f) {
        return '<span style="color:#74c0fc">[bajando] ' + escapeHtml(f) + '</span>';
      }).concat(loc.files.map(function (f) { return escapeHtml(f); }))
        .concat(loc.copias.map(function (f) {
          return '<span style="color:#ffb300">[copia] ' + escapeHtml(f) + '</span>';
        }));
      extra = '<div id="csVideoLista" style="margin-top:6px;color:#bbb;max-height:110px;overflow:auto">' +
        filas.join('<br>') + '</div>';
    }

    var cmp;
    var copiasTxt = (loc && loc.copias.length ? ' <span style="color:#ffb300">(+' + loc.copias.length + ' copia' + (loc.copias.length > 1 ? 's' : '') + ', no cuentan)</span>' : '') +
      (bajando.length ? ' <span style="color:#74c0fc">— bajando ' + bajando.length + '</span>' : '');
    if (!idx) {
      cmp = '<span style="color:#ffb300">Elegí la carpeta donde están los videos bajados.</span>';
    } else if (loc && loc.folder && !nDisk && !loc.copias.length && !bajando.length) {
      cmp = 'En <b>' + escapeHtml(idx.rootName) + '</b>: carpeta <b>' + escapeHtml(loc.folder) + '</b> <span style="color:#ffb300">VACÍA</span>' +
        (falta ? ' — <b>faltan ' + falta + '</b>' : '');
    } else if (falta === 0 && sobra === 0) {
      cmp = 'En <b>' + escapeHtml(idx.rootName) + '</b>: <b>' + nDisk + '</b> — coincide' + copiasTxt;
    } else {
      cmp = 'En <b>' + escapeHtml(idx.rootName) + '</b>: <b>' + nDisk + '</b>' +
        (falta ? ' — <b>faltan ' + falta + '</b>' : '') +
        (sobra ? ' — sobran ' + sobra : '') + copiasTxt;
    }

    render(
      '<div style="font-weight:700;margin-bottom:4px">Videos de ' + escapeHtml(user) + '</div>' +
      '<div>En el perfil: <b style="color:' + color + '">' + nPerfil + '</b>' +
        (perfil.total != null ? ' <span style="color:#888">(' + perfil.total + ' medios)</span>' : '') +
      '</div>' +
      '<div style="margin-top:4px">' + cmp + '</div>' +
      bloqueDescarga(user, perfil, loc, idx) +
      extra +
      (visita.prev ? lineaAnterior(visita.prev, ahora) : '') +
      pie +
      botonElegir(idx ? 'Carpeta…' : 'Elegir carpeta…')
    );
  }

  // ---- Descargar los videos que faltan (ver descargas.js) ----
  var descCtx = null;   // que bajar si se aprieta un boton (perfil a la vista)

  function botonDesc(acc, txt, color) {
    return '<button type="button" data-desc="' + acc + '" style="margin:6px 6px 0 0;background:' + color +
      ';color:#fff;border:0;font:bold 12px Arial;padding:6px 10px;border-radius:7px;cursor:pointer">' + txt + '</button>';
  }

  function bloqueDescarga(user, perfil, loc, idx) {
    var d = CSDescarga.estado();
    var mia = d && d.user === user.toLowerCase();
    var h = '';
    if (mia && d.activo) {
      return '<div style="margin-top:8px;color:#74c0fc">⬇ Descargando ' + Math.min(d.total, d.hechos + d.errores.length + 1) + '/' + d.total +
        (d.actual ? ' · ' + d.actual + '.mp4' : '') + (d.pct != null ? ' · ' + d.pct + '%' : '') + '</div>' +
        botonDesc('parar', 'Detener', '#555');
    }
    if (mia) {
      if (d.hechos) {
        h += '<div style="margin-top:8px;color:#51cf66">✓ ' + d.hechos + ' bajado' + (d.hechos > 1 ? 's' : '') +
          (d.ultimo ? '<br><span style="color:#aaa;font-size:11px;word-break:break-all">' + escapeHtml(d.ultimo) + '</span>' : '') + '</div>';
      }
      d.errores.slice(0, 3).forEach(function (e) {
        h += '<div style="margin-top:4px;color:#ff6b6b;font-size:12px">✗ ' + e.id + ': ' + escapeHtml(e.msg) + '</div>';
      });
    }
    descCtx = null;
    if (!idx || !perfil.lista) return h;
    var f = CSDescarga.faltantes(perfil.lista, loc);
    descCtx = { user: user, raiz: idx.rootName, carpeta: (loc && loc.folder) || user, items: f };
    if (f.length) {
      h += '<div style="margin-top:6px">' + botonDesc('uno', 'Probar con 1', '#1971c2') +
        (f.length > 1 ? botonDesc('todos', 'Descargar faltantes (' + f.length + ')', '#20c997') : '') + '</div>';
    }
    return h;
  }

  function accionDescarga(acc) {
    if (acc === 'parar') { CSDescarga.detener(); return; }
    if (!descCtx || !descCtx.items.length) return;
    CSDescarga.iniciar({
      user: descCtx.user, raiz: descCtx.raiz, carpeta: descCtx.carpeta,
      items: descCtx.items, soloUno: acc === 'uno'
    }, schedule);
  }

  // "750 carpetas (125 vacías)": solo totales, sin listar carpetas.
  function resumenCarpetas(idx) {
    var total = idx.totalCarpetas || 0, vac = (idx.vacias || []).length;
    return '<br><span style="color:#aaa">' + total + ' carpeta' + (total !== 1 ? 's' : '') + '</span>' +
      (vac ? ' <span style="color:#ffb300">(' + vac + ' vacía' + (vac !== 1 ? 's' : '') + ')</span>' : '');
  }

  // "Visita anterior (hace 2 dias): perfil 3, disco 1" y, si cambio, cuanto.
  function lineaAnterior(prev, ahora) {
    function dif(a, b) {
      if (!ahora || a === b) return '';
      return ' <span style="color:#74c0fc">(' + (b > a ? '+' : '') + (b - a) + ')</span>';
    }
    return '<div style="margin-top:6px;padding-top:6px;border-top:1px solid #333;color:#aaa">' +
      'Visita anterior (' + hace(prev.at) + '): perfil <b>' + prev.perfil + '</b>' + dif(prev.perfil, ahora && ahora.perfil) +
      ', disco <b>' + prev.disco + '</b>' + dif(prev.disco, ahora && ahora.disco) +
      (prev.copias ? ', ' + prev.copias + ' copia' + (prev.copias > 1 ? 's' : '') : '') + '</div>';
  }

  var t = null;
  function schedule() {
    if (t) clearTimeout(t);
    t = setTimeout(refresh, 250);
  }

  // Al entrar a un perfil: mostrar ya con lo guardado y pedir una relectura
  // de la carpeta; cuando termina, storage.onChanged vuelve a dibujar.
  function alCambiarPagina() {
    lastUser = profileUsername() || '';
    visita.cargada = false;
    ultimaOk = 0;
    refresh();
    pedirRelectura(profileUsername());
  }

  alCambiarPagina();
  timers.push(setInterval(function () {
    if ((profileUsername() || '') !== lastUser) alCambiarPagina();
  }, 800));
  // En vivo: mientras el perfil esta abierto y a la vista, releer su carpeta
  // (los videos que se van bajando aparecen solos).
  timers.push(setInterval(function () {
    var u = profileUsername();
    if (u && document.visibilityState === 'visible') pedirRelectura(u);
    // Si las relecturas se cortaron, apagar el "en vivo".
    if (ultimaOk && Date.now() - ultimaOk >= 10000 && ultimoHtml.indexOf('en vivo') !== -1) schedule();
  }, VIVO_MS));
  chrome.storage.onChanged.addListener(function (ch, area) {
    if (area === 'local' && (ch.csVideoFolder || ch.csVideoEstado)) schedule();
  });
})();
