/* Indice de la carpeta local de videos. Lo comparten carpeta.html, el
   service worker (importScripts) y el panel del perfil (content script).
   Guarda en chrome.storage.local.csVideoFolder:
     { rootName, scannedAt, carpetas: {clave: {folder, files[], bajando[]}},
       raiz: [nombres], raizBajando: [nombres], totalFiles, totalCopias,
       totalCarpetas, vacias: [subcarpetas sin ningun video] }
   bajando = descargas sin terminar ("video.mp4.crdownload").
   Las copias bajadas dos veces ("video (1).mp4") no cuentan y se listan aparte. */
var CSIndice = (function () {
  'use strict';

  var VIDEO_EXT = /\.(mp4|webm|mkv|avi|mov|m4v|wmv|mpeg|mpg)$/i;
  var COPIA = /^(.*?)\s*\((\d+)\)(\.[^.]+)$/;
  // Descarga en curso de Chrome ("video.mp4.crdownload") o de otros gestores.
  var BAJANDO = /\.(crdownload|part|partial|download)$/i;
  var MAX_DEPTH = 2;

  function clave(s) {
    return String(s || '').toLowerCase();
  }

  // "Video (2).MP4" -> { base: "video.mp4", n: 2 }; sin sufijo n = 0.
  function partirCopia(nombre) {
    var m = String(nombre).match(COPIA);
    if (m) return { base: clave(m[1] + m[3]), n: parseInt(m[2], 10) };
    return { base: clave(nombre), n: 0 };
  }

  // Separa los que cuentan de las copias. Por cada grupo cuenta el original
  // o, si no esta, la copia de numero mas bajo.
  function contar(nombres) {
    var grupos = {}, cuenta = [], copias = [];
    (nombres || []).forEach(function (f) {
      var p = partirCopia(f);
      (grupos[p.base] = grupos[p.base] || []).push({ f: f, n: p.n });
    });
    Object.keys(grupos).sort().forEach(function (k) {
      var g = grupos[k].sort(function (a, b) { return a.n - b.n; });
      cuenta.push(g[0].f);
      for (var i = 1; i < g.length; i++) copias.push(g[i].f);
    });
    return { cuenta: cuenta, copias: copias };
  }

  // La subcarpeta kk es la del usuario k (igual, o igual sin espacios/_/-).
  function esDe(kk, k, compact) {
    return kk === k || kk.replace(/[\s_\-]+/g, '') === compact;
  }

  // Videos de un usuario: su subcarpeta + archivos de la raiz cuyo nombre
  // empieza por el usuario (seguido de fin o de un caracter no alfanumerico).
  function buscar(idx, user) {
    if (!idx || !idx.carpetas) return null;
    var k = clave(user), compact = k.replace(/[\s_\-]+/g, '');
    var nombres = [], bajando = [], folder = null;
    Object.keys(idx.carpetas).forEach(function (kk) {
      if (esDe(kk, k, compact)) {
        folder = idx.carpetas[kk].folder;
        nombres = nombres.concat(idx.carpetas[kk].files);
        bajando = bajando.concat(idx.carpetas[kk].bajando || []);
      }
    });
    function deRaiz(f) {
      var b = partirCopia(f.replace(BAJANDO, '')).base.replace(VIDEO_EXT, '');
      return b.indexOf(k) === 0 && (b.length === k.length || /[^a-z0-9]/.test(b.charAt(k.length)));
    }
    (idx.raiz || []).forEach(function (f) { if (deRaiz(f)) nombres.push(f); });
    (idx.raizBajando || []).forEach(function (f) { if (deRaiz(f)) bajando.push(f); });
    var c = contar(nombres);
    return { folder: folder, files: c.cuenta, copias: c.copias, bajando: bajando, n: c.cuenta.length };
  }

  // Videos de un perfil segun la API del sitio (/api/members/profile/X).
  // type 1 = video; si no, se reconoce por la ruta de la miniatura.
  function videosDePerfil(p) {
    var items = (p && p.mediaItems) || [], n = 0, lista = [];
    items.forEach(function (mit) {
      if (!mit) return;
      var th = String(mit.thumbnail || mit.url || '');
      if (mit.type === 1 || /\/videos\//i.test(th) || /\.(mp4|webm|mkv|m4v)(\?|$)/i.test(th)) {
        n++;
        // id = nombre del archivo en disco (<id>.mp4); hash = pagina video-zoom
        if (mit.id) lista.push({ id: mit.id, hash: mit.hash || '' });
      }
    });
    return { n: n, total: items.length, lista: lista };
  }

  // Videos del perfil (lista de videosDePerfil) cuyo "<id>.mp4" no esta en la
  // carpeta. bajandoFalta: una descarga sin terminar (.crdownload) cuenta como
  // faltante (la descarga automatica la rehace).
  function faltantes(lista, loc, bajandoFalta) {
    var s = {};
    if (loc) {
      [].concat(loc.files || [], loc.copias || [], bajandoFalta ? [] : (loc.bajando || [])).forEach(function (f) {
        var m = String(f).match(/^(\d+)/);
        if (m) s[m[1]] = 1;
      });
    }
    return (lista || []).filter(function (v) { return v.id && !s[String(v.id)]; });
  }

  // Evalua la comprobacion previa de /api/members/videos/<hash> (GET de 1 byte,
  // sin pedir JSON). r = { status, type, ct, msg? }.
  //   ok: se puede bajar | sinAcceso: el sitio lo niega | duda: bajar y revisar despues.
  function evaluarVideo(r) {
    var ct = String(r.ct || '').split(';')[0];
    var det = 'HTTP ' + r.status + (ct ? ', ' + ct : '') + (r.msg ? ', "' + String(r.msg).slice(0, 80) + '"' : '');
    if (r.type === 'opaqueredirect') return { ok: true, detalle: det };
    if ((r.status === 200 || r.status === 206) && /video|octet-stream|mp4|binary/i.test(ct)) return { ok: true, detalle: det };
    if (r.status === 401 || r.status === 402 || r.status === 403 || r.status === 404) return { sinAcceso: true, detalle: det };
    if (/json|html/i.test(ct)) return { sinAcceso: true, detalle: det };
    return { duda: true, detalle: det };
  }

  // Cache compartido de "videos en el sitio" por usuario (lo llenan el panel
  // del perfil y el de la lista): chrome.storage.local.csVideoSitio.
  async function guardarSitio(user, v) {
    var k = clave(user);
    var st = (await chrome.storage.local.get('csVideoSitio')).csVideoSitio || {};
    var ant = st[k];
    st[k] = { n: v.n, total: v.total, at: Date.now() };
    // Podar: quedarse con los 3000 mas recientes.
    var ks = Object.keys(st);
    if (ks.length > 3000) {
      ks.sort(function (a, b) { return st[a].at - st[b].at; });
      ks.slice(0, ks.length - 3000).forEach(function (x) { delete st[x]; });
    }
    if (!ant || ant.n !== v.n || ant.total !== v.total || Date.now() - ant.at > 3600000) {
      await chrome.storage.local.set({ csVideoSitio: st });
    }
  }

  async function juntarVideos(dir, out, bajando, depth) {
    for await (var ent of dir.values()) {
      if (ent.kind === 'file' && VIDEO_EXT.test(ent.name)) out.push(ent.name);
      else if (ent.kind === 'file' && BAJANDO.test(ent.name) && VIDEO_EXT.test(ent.name.replace(BAJANDO, ''))) bajando.push(ent.name);
      else if (ent.kind === 'directory' && depth < MAX_DEPTH) await juntarVideos(ent, out, bajando, depth + 1);
    }
  }

  async function leerCarpeta(ent) {
    var files = [], bajando = [];
    await juntarVideos(ent, files, bajando, 0);
    return { folder: ent.name, files: files, bajando: bajando };
  }

  // Lectura completa. Con 'user' y un indice previo, solo recorre la
  // subcarpeta de ese usuario (y lista la raiz): es rapida para releer seguido
  // mientras se estan bajando videos de ese perfil.
  async function escanear(handle, user, previo) {
    var parcial = !!(user && previo && previo.carpetas && previo.rootName === handle.name);
    var k = clave(user), compact = k.replace(/[\s_\-]+/g, '');
    var carpetas = {}, raiz = [], raizBajando = [];
    for await (var ent of handle.values()) {
      if (ent.kind === 'file' && VIDEO_EXT.test(ent.name)) {
        raiz.push(ent.name);
      } else if (ent.kind === 'file' && BAJANDO.test(ent.name) && VIDEO_EXT.test(ent.name.replace(BAJANDO, ''))) {
        raizBajando.push(ent.name);
      } else if (ent.kind === 'directory') {
        var kk = clave(ent.name);
        if (parcial && !esDe(kk, k, compact) && previo.carpetas[kk]) carpetas[kk] = previo.carpetas[kk];
        else carpetas[kk] = await leerCarpeta(ent);
      }
    }
    var total = 0, copias = 0, vacias = [];
    Object.keys(carpetas).forEach(function (k) {
      var c = contar(carpetas[k].files);
      total += c.cuenta.length; copias += c.copias.length;
      if (!carpetas[k].files.length && !(carpetas[k].bajando || []).length) vacias.push(carpetas[k].folder);
    });
    vacias.sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; });
    var cr = contar(raiz);
    total += cr.cuenta.length; copias += cr.copias.length;
    return {
      rootName: handle.name,
      scannedAt: Date.now(),
      carpetas: carpetas,
      raiz: raiz,
      raizBajando: raizBajando,
      totalFiles: total,
      totalCopias: copias,
      totalCarpetas: Object.keys(carpetas).length,
      vacias: vacias
    };
  }

  // El handle de la carpeta vive en IndexedDB del origen de la extension
  // (lo ven carpeta.html y el service worker, no la pagina del sitio).
  function abrirDb() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open('csVideosFolder', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }

  async function idbGet(key) {
    var db = await abrirDb();
    return new Promise(function (res, rej) {
      var q = db.transaction('kv').objectStore('kv').get(key);
      q.onsuccess = function () { res(q.result); };
      q.onerror = function () { rej(q.error); };
    });
  }

  async function idbSet(key, val) {
    var db = await abrirDb();
    return new Promise(function (res, rej) {
      var q = db.transaction('kv', 'readwrite').objectStore('kv').put(val, key);
      q.onsuccess = function () { res(); };
      q.onerror = function () { rej(q.error); };
    });
  }

  // Relee la carpeta guardada sin pedir nada al usuario. Si Chrome no tiene
  // permiso vigente, deja estado 'sin-permiso' (hace falta un clic en carpeta.html).
  async function releer(user) {
    var estado;
    try {
      var handle = await idbGet('root');
      if (!handle) {
        estado = { estado: 'sin-carpeta' };
      } else if ((await handle.queryPermission({ mode: 'read' })) !== 'granted') {
        estado = { estado: 'sin-permiso', rootName: handle.name };
      } else {
        var previo = (await chrome.storage.local.get('csVideoFolder')).csVideoFolder;
        var payload = await escanear(handle, user, previo);
        // Solo escribir si cambio algo: asi el panel no se redibuja de balde.
        if (!previo || JSON.stringify(sinFecha(previo)) !== JSON.stringify(sinFecha(payload))) {
          await chrome.storage.local.set({ csVideoFolder: payload });
        }
        estado = { estado: 'ok', rootName: handle.name };
      }
    } catch (e) {
      estado = { estado: 'error', error: String(e) };
    }
    estado.at = Date.now();
    var ant = (await chrome.storage.local.get('csVideoEstado')).csVideoEstado;
    if (!ant || ant.estado !== estado.estado || ant.error !== estado.error || estado.at - (ant.at || 0) > 60000) {
      await chrome.storage.local.set({ csVideoEstado: estado });
    }
    return estado;
  }

  function sinFecha(p) {
    var c = Object.assign({}, p);
    delete c.scannedAt;
    return c;
  }

  return {
    VIDEO_EXT: VIDEO_EXT,
    videosDePerfil: videosDePerfil,
    evaluarVideo: evaluarVideo,
    faltantes: faltantes,
    guardarSitio: guardarSitio,
    contar: contar,
    buscar: buscar,
    escanear: escanear,
    releer: releer,
    idbGet: idbGet,
    idbSet: idbSet
  };
})();
