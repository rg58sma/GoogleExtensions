/* Paneles de la extension en el sitio. Junta los paneles de la izquierda en
   un "dock" y deja al usuario plegar (–) u ocultar (×) cada uno. Un boton ⚙
   siempre visible permite volver a mostrar los ocultos.
   Paneles: auto (autoPanel.js), perfiles (perfilesLista.js), videos (perfilVideos.js) y
   descargas (boton "Bajar mis chats" de content.js).
   Preferencias en chrome.storage.local.csPaneles = { id: {oculto, plegado} }. */
var CSPaneles = (function () {
  'use strict';

  var DOCK_ID = 'csDock';
  var NOMBRES = { auto: 'Descarga automática', perfiles: 'Perfiles de esta página', videos: 'Videos', descargas: 'Bajar mis chats' };
  var ORDEN = ['auto', 'perfiles', 'videos', 'descargas'];   // de arriba hacia abajo en el dock
  var prefs = {};
  var disponibles = {};                 // el panel tiene algo para mostrar en esta pagina

  function contextoOk() {
    try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; }
  }

  function pref(id) {
    return prefs[id] || { oculto: false, plegado: false };
  }

  function guardar(id, cambio) {
    prefs[id] = Object.assign({}, pref(id), cambio);
    aplicar();
    if (contextoOk()) chrome.storage.local.set({ csPaneles: prefs }).catch(function () { });
  }

  function dock() {
    var d = document.getElementById(DOCK_ID);
    if (d) return d;
    if (!document.body) return null;
    d = document.createElement('div');
    d.id = DOCK_ID;
    d.style.cssText = 'position:fixed;left:18px;bottom:18px;z-index:2147483646;width:340px;max-height:calc(100vh - 36px);display:flex;flex-direction:column;gap:8px;font:13px/1.45 Arial;color:#fff';
    var pila = document.createElement('div');
    pila.id = DOCK_ID + 'Pila';
    pila.style.cssText = 'display:flex;flex-direction:column;gap:8px;overflow:auto;min-height:0';
    d.appendChild(pila);
    d.appendChild(crearMenu());
    document.body.appendChild(d);
    return d;
  }

  // Tarjeta de un panel: encabezado (titulo, plegar, ocultar) + cuerpo.
  function tarjeta(id) {
    var t = document.getElementById('csPanel_' + id);
    if (t) return t;
    var d = dock();
    if (!d) return null;
    t = document.createElement('div');
    t.id = 'csPanel_' + id;
    t.style.cssText = 'background:#111;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.45);overflow:hidden;flex:none';
    var cab = document.createElement('div');
    cab.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 10px;background:#1c1c1c;cursor:pointer;user-select:none';
    cab.innerHTML = '<span data-rol="flecha" style="color:#888;width:10px">▾</span>' +
      '<span style="flex:1;font-weight:700;font-size:12px;color:#ddd">' + NOMBRES[id] + '</span>' +
      '<span data-rol="ocultar" title="Ocultar este panel (se vuelve a mostrar desde ⚙)" style="color:#888;padding:0 4px">×</span>';
    cab.onclick = function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.target.getAttribute('data-rol') === 'ocultar') guardar(id, { oculto: true });
      else guardar(id, { plegado: !pref(id).plegado });
    };
    var cuerpo = document.createElement('div');
    cuerpo.setAttribute('data-rol', 'cuerpo');
    cuerpo.style.cssText = 'padding:10px 14px 12px';
    t.appendChild(cab);
    t.appendChild(cuerpo);
    // Insertar respetando ORDEN.
    var pila = document.getElementById(DOCK_ID + 'Pila');
    var pos = ORDEN.indexOf(id), antes = null;
    for (var i = pos + 1; i < ORDEN.length && !antes; i++) antes = document.getElementById('csPanel_' + ORDEN[i]);
    pila.insertBefore(t, antes);
    aplicar();
    return t;
  }

  // Cuerpo donde cada panel dibuja su contenido. idCuerpo: id del elemento.
  function cuerpo(id, idCuerpo) {
    var t = tarjeta(id);
    if (!t) return null;
    var c = t.querySelector('[data-rol="cuerpo"]');
    if (idCuerpo && c.id !== idCuerpo) c.id = idCuerpo;
    return c;
  }

  function disponible(id, si) {
    disponibles[id] = !!si;
    aplicar();
  }

  function crearMenu() {
    var m = document.createElement('div');
    m.id = DOCK_ID + 'Menu';
    m.style.cssText = 'flex:none;align-self:flex-start';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '⚙ Paneles';
    btn.title = 'Elegir qué paneles se ven';
    btn.style.cssText = 'background:#111;color:#ccc;border:1px solid #333;border-radius:8px;font:12px Arial;padding:4px 8px;cursor:pointer;opacity:.8';
    var lista = document.createElement('div');
    lista.style.cssText = 'display:none;margin-bottom:6px;background:#111;border:1px solid #333;border-radius:8px;padding:8px 10px;font:12px Arial;color:#ddd';
    btn.onclick = function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      lista.style.display = lista.style.display === 'none' ? 'block' : 'none';
      dibujarMenu(lista);
    };
    m.appendChild(lista);
    m.appendChild(btn);
    return m;
  }

  function dibujarMenu(lista) {
    lista.innerHTML = '<div style="color:#888;margin-bottom:4px">Mostrar:</div>';
    ORDEN.forEach(function (id) {
      var l = document.createElement('label');
      l.style.cssText = 'display:block;cursor:pointer;padding:2px 0';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !pref(id).oculto;
      cb.style.cssText = 'margin-right:6px;vertical-align:middle';
      cb.onchange = function () { guardar(id, { oculto: !cb.checked, plegado: false }); };
      l.appendChild(cb);
      l.appendChild(document.createTextNode(NOMBRES[id]));
      lista.appendChild(l);
    });
  }

  // Muestra/oculta segun preferencias y disponibilidad.
  function aplicar() {
    ORDEN.forEach(function (id) {
      var t = document.getElementById('csPanel_' + id);
      if (!t) return;
      var p = pref(id);
      t.style.display = (p.oculto || disponibles[id] === false) ? 'none' : 'block';
      t.querySelector('[data-rol="cuerpo"]').style.display = p.plegado ? 'none' : 'block';
      t.querySelector('[data-rol="flecha"]').textContent = p.plegado ? '▸' : '▾';
    });
    var menu = document.getElementById(DOCK_ID + 'Menu');
    if (menu) {
      var lista = menu.firstChild;
      if (lista && lista.style.display !== 'none') dibujarMenu(lista);
    }
  }

  function hace(ms) {
    var s = Math.round((Date.now() - ms) / 1000);
    if (s < 60) return 'hace ' + s + ' s';
    if (s < 3600) return 'hace ' + Math.round(s / 60) + ' min';
    if (s < 86400) return 'hace ' + Math.round(s / 3600) + ' h';
    var d = Math.round(s / 86400);
    return 'hace ' + d + (d === 1 ? ' día' : ' días');
  }

  if (contextoOk()) {
    chrome.storage.local.get('csPaneles').then(function (st) {
      prefs = st.csPaneles || {};
      dock();
      aplicar();
    }).catch(function () { });
    chrome.storage.onChanged.addListener(function (ch, area) {
      if (area === 'local' && ch.csPaneles) { prefs = ch.csPaneles.newValue || {}; aplicar(); }
    });
  }

  return { cuerpo: cuerpo, disponible: disponible, hace: hace, contextoOk: contextoOk };
})();
