/* Descarga de los videos que faltan en disco (panel Videos, dentro de un perfil).
   - Faltante = video del perfil (API: mediaItems type 1) cuyo "<id>.mp4" no
     esta en la carpeta del usuario.
   - El archivo sale de /api/members/videos/<hash> (hash = mediaItems[].hash),
     con tu sesion. Si el sitio no te deja ver el video, no se baja.
   - El archivo lo guarda Chrome (chrome.downloads, en background.js) en
     <Descargas>/<carpeta>/<usuario>/<id>.mp4, de a uno. */
var CSDescarga = (function () {
  'use strict';

  var PAUSA_MS = 800;
  var MAX_ERRORES_SEGUIDOS = 3;
  var st = null;            // estado de la corrida (una por pestana)
  var aviso = function () { };

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function msg(m) {
    return new Promise(function (res, rej) {
      try {
        chrome.runtime.sendMessage(m, function (r) {
          if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
          else res(r);
        });
      } catch (e) { rej(e); }
    });
  }

  function idsEnDisco(loc) {
    var s = {};
    if (!loc) return s;
    [].concat(loc.files || [], loc.copias || [], loc.bajando || []).forEach(function (f) {
      var m = String(f).match(/^(\d+)/);
      if (m) s[m[1]] = 1;
    });
    return s;
  }

  // Videos del perfil que no estan en disco (compara por id = nombre de archivo).
  function faltantes(lista, loc) {
    var s = idsEnDisco(loc);
    return (lista || []).filter(function (v) { return v.id && !s[String(v.id)]; });
  }

  // El sitio entrega el .mp4 en /api/members/videos/<hash> (con tu sesion):
  // es la misma direccion que usa su boton de descarga. Antes de pedirselo a
  // Chrome se comprueba pidiendo 1 byte, SIN pedir JSON (si se pide JSON el
  // sitio contesta un error en vez del archivo).
  async function resolverUrl(v) {
    if (!v.hash) throw new Error('el sitio no dio el hash del video');
    var url = location.origin + '/api/members/videos/' + encodeURIComponent(v.hash);
    var r;
    try {
      r = await fetch(url, { credentials: 'include', redirect: 'manual', headers: { 'Range': 'bytes=0-0' } });
    } catch (e) {
      return url;   // no se pudo comprobar: que Chrome lo intente igual
    }
    var info = { status: r.status, type: r.type, ct: r.headers.get('content-type') || '' };
    if (/json/i.test(info.ct)) {
      var j = await r.json().catch(function () { return null; });
      info.msg = j && (j.message || j.error || JSON.stringify(j).slice(0, 120));
    } else if (r.body) {
      try { r.body.cancel(); } catch (e) { }
    }
    var ev = CSIndice.evaluarVideo(info);
    if (ev.sinAcceso) throw new Error('sin acceso a este video (' + ev.detalle + ')');
    return url;
  }

  async function esperar(downloadId) {
    while (true) {
      await sleep(1000);
      var r = await msg({ type: 'estadoDescarga', id: downloadId });
      if (!r) throw new Error('la descarga desapareció de Chrome');
      st.pct = r.total > 0 ? Math.round(100 * r.bytes / r.total) : null;
      aviso();
      if (r.state === 'complete') return r;
      if (r.state === 'interrupted') throw new Error('Chrome la interrumpió: ' + (r.error || ''));
      if (st.parar) {
        await msg({ type: 'cancelarDescarga', id: downloadId }).catch(function () { });
        throw new Error('detenida');
      }
    }
  }

  function limpiar(nombre) {
    return String(nombre).replace(/[<>:"\/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '') || 'sin_nombre';
  }

  // o = { user, raiz, carpeta, items: [{id, hash}], soloUno }
  async function iniciar(o, onCambio) {
    if (st && st.activo) return;
    aviso = onCambio || aviso;
    var items = o.soloUno ? o.items.slice(0, 1) : o.items.slice();
    st = { user: o.user.toLowerCase(), total: items.length, hechos: 0, errores: [], activo: true,
      parar: false, actual: null, pct: null, ultimo: null, prueba: !!o.soloUno };
    aviso();
    var seguidos = 0;
    for (var i = 0; i < items.length && !st.parar; i++) {
      var v = items[i];
      st.actual = v.id; st.pct = null; aviso();
      try {
        var url = await resolverUrl(v);
        var r = await msg({ type: 'descargar', url: url,
          filename: limpiar(o.raiz) + '/' + limpiar(o.carpeta) + '/' + v.id + '.mp4' });
        if (!r || !r.ok) throw new Error((r && r.err) || 'Chrome no aceptó la descarga');
        var fin = await esperar(r.id);
        if (fin.mime && /json|html|text/i.test(fin.mime)) {
          throw new Error('se guardó algo que no es video (' + fin.mime + '): revisá ' + fin.filename);
        }
        st.hechos++; st.ultimo = fin.filename; seguidos = 0;
      } catch (e) {
        st.errores.push({ id: v.id, msg: String((e && e.message) || e) });
        if (st.parar || ++seguidos >= MAX_ERRORES_SEGUIDOS) break;
      }
      aviso();
      await sleep(PAUSA_MS);
    }
    st.activo = false; st.actual = null; st.pct = null;
    aviso();
  }

  return {
    faltantes: faltantes,
    iniciar: iniciar,
    detener: function () { if (st) st.parar = true; },
    estado: function () { return st; }
  };
})();
