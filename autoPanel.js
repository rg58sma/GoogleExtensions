/* Panel "Descarga automatica" (dock de paneles.js) + ayudante de auto.js.
   - auto.js (service worker) recorre el listado de esta pestana: le pide los
     perfiles de la pagina y la pagina siguiente (listado.js), y hace sus
     consultas al sitio a traves de ella para que salgan con tu sesion.
   - Panel: empezar / pausar / reanudar / detener y ver el avance. La pestana
     puede quedar en segundo plano, pero no hay que cerrarla ni sacarla del listado. */
(function () {
  'use strict';

  var BODY_ID = 'csAutoPanel';
  var ultimoHtml = '';

  if (!CSPaneles.contextoOk()) return;

  // ---- Ayudante de auto.js: leer el listado y pasar de pagina ----
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg) return;
    if (msg.type === 'autoPing') {
      sendResponse({ ok: true, url: location.href });
    } else if (msg.type === 'autoOcultarPaneles') {
      // Que los paneles de la extension no salgan en la captura del perfil.
      var d = document.getElementById('csDock');
      if (d) d.style.visibility = msg.ocultar ? 'hidden' : '';
      sendResponse({ ok: true });
    } else if (msg.type === 'autoLeerPagina') {
      sendResponse({ url: location.href, usuarios: CSListado.usuarios(), siguiente: CSListado.siguiente() });
    } else if (msg.type === 'autoClickSiguiente') {
      sendResponse({ ok: CSListado.irSiguiente() });
    }
  });

  // ---- Relay de red para auto.js ----
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.type !== 'relayFetch' || !/^\/api\//.test(msg.path || '')) return;
    // video: comprobar un video pidiendo 1 byte y SIN pedir JSON (si se pide
    // JSON el sitio contesta un error en vez del archivo).
    var hdr = msg.video ? { 'Range': 'bytes=0-0' } : { 'Accept': 'application/json' };
    fetch(msg.path, { method: 'GET', credentials: 'include', redirect: 'manual', headers: hdr })
      .then(async function (r) {
        var ct = r.headers.get('content-type') || '';
        var out = { status: r.status, ok: r.ok, type: r.type, ct: ct, origin: location.origin };
        if (/json/i.test(ct)) {
          try { out.json = await r.json(); } catch (e) { }
          if (msg.video && out.json) out.msg = out.json.message || out.json.error || out.json.detail || JSON.stringify(out.json).slice(0, 120);
          if (msg.video) delete out.json;
        } else if (msg.video && /html|text/i.test(ct)) {
          try { out.msg = (await r.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120); } catch (e) { }
        } else if (msg.video && r.body) {
          try { r.body.cancel(); } catch (e) { }
        }
        sendResponse(out);
      }, function (e) {
        sendResponse({ status: 0, ok: false, err: String(e), origin: location.origin });
      });
    return true;
  });

  // ---- Panel ----
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function boton(acc, txt, color) {
    return '<button type="button" data-auto="' + acc + '" style="margin:8px 6px 0 0;background:' + color +
      ';color:#fff;border:0;font:bold 12px Arial;padding:6px 12px;border-radius:7px;cursor:pointer">' + txt + '</button>';
  }

  function duracion(ms) {
    var m = Math.round(ms / 60000);
    return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
  }

  function cifras(s) {
    return '<div style="margin-top:6px;color:#aaa;font-size:12px">' +
      '<span style="color:#51cf66">' + s.bajados + ' bajados</span> · ' +
      s.perfiles + ' perfiles con faltantes · ' + s.completos + ' completos · ' + s.sinVideos + ' sin videos · ' +
      (s.sinAcceso ? '<span style="color:#ffb300">' + s.sinAcceso + ' sin acceso</span> · ' : '') +
      s.paginas + ' páginas terminadas · ' +
      '<span style="color:' + (s.errores ? '#ff6b6b' : '#aaa') + '">' + s.errores + ' errores</span>' +
      (s.reanudadas ? ' · ' + s.reanudadas + ' descargas reanudadas' : '') +
      (s.capturas ? ' · 📷 ' + s.capturas + ' capturas' : '') +
      (s.sinCaptura ? ' · <span style="color:#ffb300">' + s.sinCaptura + ' sin captura</span>' : '') + '</div>';
  }

  function registro(a) {
    var l = (a.log || []).slice(-8).reverse();
    if (!l.length) return '';
    return '<div data-rol="log" style="margin-top:6px;max-height:120px;overflow:auto;font:11px/1.4 Consolas,monospace;color:#999;background:#0a0a0a;border-radius:6px;padding:6px">' +
      l.map(escapeHtml).join('<br>') + '</div>';
  }

  async function dibujar() {
    var st = await chrome.storage.local.get(['csAuto', 'csVideoFolder', 'csAutoCapturas']);
    var a = st.csAuto, idx = st.csVideoFolder && st.csVideoFolder.carpetas ? st.csVideoFolder : null;
    var html;
    var nLista = CSListado.usuarios().length;
    // Opcion: captura de cada perfil (apagada = modelo anterior, no abre perfiles).
    var cap = !!st.csAutoCapturas;
    var opcionCaptura = '<label style="display:block;margin-top:8px;color:#ddd;cursor:pointer">' +
      '<input type="checkbox" data-opcion="capturas"' + (cap ? ' checked' : '') + ' style="vertical-align:middle;margin:0 6px 0 0">' +
      '📷 Sacar captura de cada perfil</label>' +
      (cap ? '<div style="margin-top:2px;color:#ffb300;font-size:12px">Abre cada perfil con faltantes. Dejá la ventana a la vista y esta pestaña al frente.</div>'
           : '<div style="margin-top:2px;color:#888;font-size:12px">Sin capturas: no abre los perfiles y la ventana puede quedar minimizada.</div>');
    if (!a || a.estado === 'terminado' || a.estado === 'detenido') {
      html = '<div style="color:#ccc">' + (!idx
        ? '<span style="color:#ffb300">Primero elegí la carpeta de videos (panel Videos → Carpeta…).</span>'
        : nLista
          ? 'Recorre este listado página por página: en cada perfil <b>con videos que no coinciden con el disco</b> baja los que faltan a <b>' +
            escapeHtml(idx.rootName) + '\\&lt;perfil&gt;</b>, y cuando la página queda completa pasa a la <b>siguiente</b>.' + opcionCaptura
          : 'Andá a un listado de perfiles del sitio (búsqueda, visitas…) y apretá Empezar ahí.') + '</div>';
      if (a) {
        html += '<div style="margin-top:8px;color:' + (a.estado === 'terminado' ? '#51cf66' : '#ffb300') + '">' +
          (a.estado === 'terminado' ? '✓ Última vuelta terminada' : 'Última vuelta detenida') +
          (a.fin ? ' (' + duracion(a.fin - a.inicio) + ')' : '') + '</div>' + cifras(a.stats) + registro(a);
      }
      if (idx && nLista) html += boton('iniciar', 'Empezar en este listado (' + nLista + ' perfiles)', '#20c997');
    } else {
      var total = a.cola.length, pct = total ? Math.floor(100 * a.i / total) : 0;
      var corriendo = a.estado === 'corriendo';
      html =
        '<div style="display:flex;justify-content:space-between;color:' + (corriendo ? '#74c0fc' : '#ffb300') + '">' +
          '<b>' + (corriendo ? '● Trabajando' : '❚❚ En pausa') + '</b><span>Página ' + a.pagina + ' · ' +
            (a.fase === 'filtro' ? 'filtrando ' + Math.min(a.i + 1, total) + ' / ' + total
              : 'bajando perfil ' + Math.min(a.i + 1, total) + ' / ' + total + ' con faltantes') + '</span></div>' +
        '<div style="margin-top:6px;height:6px;background:#222;border-radius:3px;overflow:hidden">' +
          '<div style="height:100%;width:' + pct + '%;background:' + (corriendo ? '#20c997' : '#ffb300') + '"></div></div>' +
        (a.actual ? '<div style="margin-top:6px;color:#ddd">' + (a.actual.user ? escapeHtml(a.actual.user) + ': ' : '') + escapeHtml(a.actual.texto) + '</div>' : '') +
        (!corriendo && a.motivo ? '<div style="margin-top:6px;color:#ffb300">' + escapeHtml(a.motivo) + '</div>' : '') +
        cifras(a.stats) + registro(a) + opcionCaptura +
        (corriendo ? boton('pausar', 'Pausar', '#555') : boton('reanudar', 'Reanudar', '#20c997')) +
        boton('detener', 'Detener', '#8b2c2c');
    }

    var el = CSPaneles.cuerpo('auto', BODY_ID);
    if (!el || html === ultimoHtml) return;
    ultimoHtml = html;
    el.innerHTML = html;
    var chk = el.querySelector('[data-opcion="capturas"]');
    if (chk) chk.onchange = function () {
      chrome.storage.local.set({ csAutoCapturas: chk.checked }).catch(function () { });
    };
    Array.prototype.forEach.call(el.querySelectorAll('[data-auto]'), function (b) {
      b.onclick = function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var acc = b.getAttribute('data-auto');
        if (acc === 'detener' && !confirm('¿Detener la descarga automática? Lo que ya bajó queda guardado.')) return;
        b.disabled = true;
        chrome.runtime.sendMessage(acc === 'iniciar' ? { type: 'autoIniciar' } : { type: 'autoOrden', orden: acc }, function (r) {
          if (chrome.runtime.lastError) return;
          if (r && !r.ok && r.err) alert(r.err);
        });
      };
    });
  }

  function refrescar() {
    if (!CSPaneles.contextoOk()) return;
    dibujar().catch(function () { });
  }

  refrescar();
  // El texto de inicio depende de si esta pagina es un listado.
  setInterval(refrescar, 3000);
  chrome.storage.onChanged.addListener(function (ch, area) {
    if (area === 'local' && (ch.csAuto || ch.csVideoFolder || ch.csAutoCapturas)) refrescar();
  });
})();
