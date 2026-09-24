/* Lectura de un listado de perfiles del sitio (busqueda, visitas, etc.).
   Lo usan el panel "Perfiles de esta pagina" (perfilesLista.js) y la
   descarga automatica (autoPanel.js / auto.js) para saber que perfiles hay
   en la pagina y como pasar a la siguiente. */
var CSListado = (function () {
  'use strict';

  function enPerfil() {
    return /\/members\/profile\/[^\/?#]+/i.test(location.pathname || '');
  }

  // Perfiles enlazados en la pagina, en orden, sin repetir. Se ignoran los
  // enlaces del encabezado/menu (ahi esta tu propio perfil) y los de la extension.
  function usuarios() {
    if (enPerfil()) return [];
    var out = [], visto = {};
    var as = document.querySelectorAll('a[href*="/members/profile/"]');
    for (var i = 0; i < as.length; i++) {
      var a = as[i];
      if (a.closest('header, nav, #csDock')) continue;
      var m = (a.getAttribute('href') || '').match(/\/members\/profile\/([^\/?#]+)/i);
      if (!m) continue;
      var u;
      try { u = decodeURIComponent(m[1]); } catch (e) { u = m[1]; }
      var k = u.toLowerCase();
      if (visto[k]) continue;
      visto[k] = 1;
      out.push(u);
    }
    return out;
  }

  function visible(el) {
    var r = el.getBoundingClientRect();
    var cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  }

  function deshabilitado(el) {
    return el.disabled || el.getAttribute('aria-disabled') === 'true' ||
      /(^|\s)(disabled|is-disabled)(\s|$)/i.test(el.className || '') ||
      !!(el.parentElement && /(^|\s)disabled(\s|$)/i.test(el.parentElement.className || ''));
  }

  var TEXTO_SIG = /^(siguiente|next|sig\.?|pr[oó]xima|pr[oó]ximo|›|»|>|→|>>)(\s*[›»>→])?$/i;

  // Enlace/boton de "pagina siguiente". Devuelve el elemento o null.
  function botonSiguiente() {
    var rel = document.querySelector('a[rel="next"][href]');
    if (rel && !deshabilitado(rel)) return rel;
    // Primero dentro de un paginador; si no hay, en toda la pagina.
    var zonas = Array.prototype.slice.call(document.querySelectorAll(
      '[class*="pagin" i], [id*="pagin" i], nav[aria-label*="pag" i], [role="navigation"]'));
    zonas.push(document.body);
    for (var z = 0; z < zonas.length; z++) {
      var els = zonas[z].querySelectorAll('a, button');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (el.closest('#csDock') || !visible(el) || deshabilitado(el)) continue;
        var t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        var al = el.getAttribute('aria-label') || el.getAttribute('title') || '';
        if (TEXTO_SIG.test(t) || /siguiente|next page|p[aá]gina siguiente/i.test(al) ||
            (zonas[z] !== document.body && /(^|\s|-)next(\s|-|$)/i.test(el.className || ''))) return el;
      }
    }
    return null;
  }

  // Descripcion de la siguiente pagina: { href } si es un enlace, { click: true }
  // si es un boton, o null si no hay (ultima pagina).
  function siguiente() {
    var el = botonSiguiente();
    if (!el) return null;
    var h = el.tagName === 'A' ? el.getAttribute('href') : null;
    if (h && h !== '#' && !/^javascript:/i.test(h)) return { href: el.href, texto: (el.textContent || '').trim() };
    return { click: true, texto: (el.textContent || '').trim() };
  }

  function irSiguiente() {
    var el = botonSiguiente();
    if (!el) return false;
    el.click();
    return true;
  }

  return { enPerfil: enPerfil, usuarios: usuarios, siguiente: siguiente, irSiguiente: irSiguiente };
})();
