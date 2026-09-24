/* Descarga automatica por LISTADO (corre en el service worker; background.js
   lo carga). Se arranca desde una pagina del sitio que lista perfiles:
     1. Reanuda las descargas de Chrome que quedaron cortadas en la carpeta.
     2. Toma los perfiles de la pagina. Fase 1 (filtro): se queda SOLO con los
        que tienen videos y no coinciden con el disco. Fase 2: a cada uno lo
        abre en la pestana, le saca una captura (perfil_AAAA-MM-DD.png) y le
        baja los "<id>.mp4" que faltan a
        <carpeta>/<usuario>/ (crea la carpeta si no existe). Los que no tienen
        videos o ya estan completos se saltean (con el cache, sin consultar).
     3. Cuando la pagina no tiene mas perfiles pendientes, pasa a la pagina
        siguiente (enlace o boton "siguiente") y repite. Termina en la ultima.
   La pestana del listado solo informa y navega (listado.js / autoPanel.js);
   el trabajo lo hace el service worker, asi que la pestana puede quedar en
   segundo plano. Las consultas al sitio salen por esa pestana (tu sesion).
   Estado en chrome.storage.local.csAuto (si Chrome duerme el service worker,
   la alarma de background.js lo retoma). Ordenes del panel en csAutoOrden. */
var CSAuto = (function () {
  'use strict';

  var SITIO = 'https://www.contactossex.com';
  var PAUSA_PERFIL_MS = 1200;
  var PAUSA_VIDEO_MS = 800;
  var CACHE_OK_MS = 12 * 3600 * 1000;
  var ESPERA_429_MS = 60000;
  var ESPERA_PAGINA_MS = 25000;
  var MAX_ERRORES_SEGUIDOS = 10;
  var LATIDO_MUERTO_MS = 45000;
  var corriendo = false;
  var DETENER = { detener: true };

  function espera(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // Espera sin que Chrome considere al service worker inactivo.
  async function dormir(ms) {
    var fin = Date.now() + ms;
    while (Date.now() < fin) {
      await espera(Math.min(10000, fin - Date.now()));
      await chrome.runtime.getPlatformInfo();
    }
  }

  function hora() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function log(a, t) {
    a.log = a.log || [];
    a.log.push(hora() + ' ' + t);
    if (a.log.length > 80) a.log.splice(0, a.log.length - 80);
  }

  async function leer() {
    return (await chrome.storage.local.get('csAuto')).csAuto || null;
  }

  async function guardar(a) {
    a.latido = Date.now();
    await chrome.storage.local.set({ csAuto: a });
  }

  function pausar(a, motivo) {
    a.estado = 'pausado';
    a.motivo = motivo;
    a.actual = null;
    log(a, 'Pausa: ' + motivo);
  }

  // Aplica una orden pendiente del panel. Devuelve true si hay que cortar.
  async function revisarOrden(a) {
    var o = (await chrome.storage.local.get('csAutoOrden')).csAutoOrden;
    if (!o) return false;
    await chrome.storage.local.remove('csAutoOrden');
    if (o === 'pausar') pausar(a, 'Pausado por vos.');
    else if (o === 'detener') { a.estado = 'detenido'; a.fin = Date.now(); a.actual = null; log(a, 'Detenido'); }
    else return false;
    await guardar(a);
    return true;
  }

  // ---- La pestana del listado ----
  async function aPestana(a, m) {
    try { return await chrome.tabs.sendMessage(a.tabId, m); } catch (e) { return null; }
  }

  async function pestanaViva(a) {
    try { await chrome.tabs.get(a.tabId); return true; } catch (e) { return false; }
  }

  // Lee la pagina actual del listado (espera a que la pestana responda).
  async function leerPagina(a) {
    var fin = Date.now() + ESPERA_PAGINA_MS;
    while (Date.now() < fin) {
      var r = await aPestana(a, { type: 'autoLeerPagina' });
      if (r) return r;
      if (!(await pestanaViva(a))) return null;
      await espera(1000);
    }
    return null;
  }

  // Pasa a la pagina siguiente y espera a que muestre otros perfiles.
  async function irSiguiente(a) {
    var antes = (a.pagUsuarios || a.cola).join('\n');
    var sig = a.siguiente;
    if (sig && sig.href) {
      await chrome.tabs.update(a.tabId, { url: sig.href });
    } else {
      var ok = await aPestana(a, { type: 'autoClickSiguiente' });
      if (!ok || !ok.ok) return null;
    }
    var fin = Date.now() + ESPERA_PAGINA_MS;
    while (Date.now() < fin) {
      await espera(1500);
      var tab = null;
      try { tab = await chrome.tabs.get(a.tabId); } catch (e) { return null; }
      if (tab.status !== 'complete') continue;
      var r = await aPestana(a, { type: 'autoLeerPagina' });
      if (r && r.usuarios && r.usuarios.length && r.usuarios.join('\n') !== antes) return r;
    }
    return { usuarios: [], siguiente: null, url: sig && sig.href };
  }

  // ---- Red: por la pestana del listado (u otra del sitio) o directo ----
  // video: comprobacion previa de un video (1 byte, sin pedir JSON).
  async function pedir(a, path, video) {
    var m = { type: 'relayFetch', path: path, video: !!video };
    var r = await aPestana(a, m);
    if (r) return r;
    var ts = await chrome.tabs.query({ url: ['https://www.contactossex.com/*', 'https://contactossex.com/*'] });
    for (var i = 0; i < ts.length; i++) {
      if (ts[i].id === a.tabId || ts[i].discarded) continue;
      try { r = await chrome.tabs.sendMessage(ts[i].id, m); if (r) return r; } catch (e) { }
    }
    try {
      var res = await fetch(SITIO + path, {
        credentials: 'include', redirect: 'manual',
        headers: video ? { 'Range': 'bytes=0-0' } : { 'Accept': 'application/json' }
      });
      var ct = res.headers.get('content-type') || '';
      var out = { status: res.status, ok: res.ok, type: res.type, ct: ct, origin: SITIO };
      if (/json/i.test(ct)) {
        var j = await res.json().catch(function () { return null; });
        if (video) out.msg = j && (j.message || j.error || JSON.stringify(j).slice(0, 120));
        else out.json = j;
      } else if (res.body) {
        try { res.body.cancel(); } catch (e) { }
      }
      return out;
    } catch (e) {
      return { status: 0, ok: false, err: String(e) };
    }
  }

  // ---- Descarga de un archivo con chrome.downloads, esperando que termine ----
  async function bajar(url, filename, a) {
    var id = await chrome.downloads.download({ url: url, filename: filename, conflictAction: 'uniquify', saveAs: false });
    a.descargaId = id;
    await guardar(a);
    return esperarDescarga(id);
  }

  async function esperarDescarga(id) {
    while (true) {
      await espera(2000);
      var d = (await chrome.downloads.search({ id: id }))[0];
      if (!d) return { ok: false, error: 'la descarga desapareció de Chrome' };
      if (d.state === 'complete') {
        if (d.mime && /json|html|text/i.test(d.mime)) return { ok: false, error: 'se guardó algo que no es video (' + d.mime + '): ' + d.filename };
        return { ok: true, filename: d.filename };
      }
      if (d.state === 'interrupted') return { ok: false, error: 'Chrome la interrumpió: ' + (d.error || '') };
    }
  }

  function limpiar(nombre) {
    return String(nombre).replace(/[<>:"\/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '') || 'sin_nombre';
  }

  // ---- Abrir paginas en la pestana del listado (navegacion simple) ----
  // Espera a que la pestana termine de cargar una pagina que cumpla "prueba"
  // y a que el script de la extension responda en ella.
  async function esperarCarga(a, prueba) {
    var fin = Date.now() + 30000;
    while (Date.now() < fin) {
      await espera(700);
      var t;
      try { t = await chrome.tabs.get(a.tabId); } catch (e) { return false; }
      if (t.status !== 'complete' || (prueba && !prueba(t.url || ''))) continue;
      if (await aPestana(a, { type: 'autoPing' })) return true;
    }
    return false;
  }

  function mismaUrl(url) {
    return function (u) { return u.split('#')[0] === url.split('#')[0]; };
  }

  async function irA(a, url, prueba) {
    try { await chrome.tabs.update(a.tabId, { url: url }); } catch (e) { return false; }
    return esperarCarga(a, prueba || mismaUrl(url));
  }

  function esPerfil(user) {
    var k = '/members/profile/' + user.toLowerCase();
    return function (u) {
      var d = u;
      try { d = decodeURIComponent(u); } catch (e) { }
      d = d.toLowerCase().split(/[?#]/)[0].replace(/\/+$/, '');
      var i = d.indexOf(k);
      return i !== -1 && (i + k.length === d.length || d.charAt(i + k.length) === '/');
    };
  }

  async function volverAlListado(a) {
    if (!a.urlPagina) return true;
    var t = null;
    try { t = await chrome.tabs.get(a.tabId); } catch (e) { return false; }
    if (mismaUrl(a.urlPagina)(t.url || '')) return true;
    return irA(a, a.urlPagina);
  }

  function hoy() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  // ---- Captura del perfil ----
  // Abre el perfil en la pestana y guarda lo que se ve como
  // <carpeta>/<perfil>/perfil_AAAA-MM-DD.png (una por dia). Chrome solo deja
  // capturar la pestana visible: con la ventana minimizada o la pestana
  // tapada por otra, no se captura (queda en el registro) y se sigue igual.
  async function capturarPerfil(a, user, carpeta) {
    // Opcional: casilla del panel (csAutoCapturas). Apagada = no abre el perfil.
    var cfg = await chrome.storage.local.get(['csAutoCapturas', 'csCapturas']);
    if (!cfg.csAutoCapturas) return;
    var k = user.toLowerCase(), dia = hoy();
    var caps = cfg.csCapturas || {};
    if (caps[k] === dia) return;
    a.actual = { user: user, texto: 'abriendo el perfil para la captura' };
    await guardar(a);
    if (!(await irA(a, SITIO + '/members/profile/' + encodeURIComponent(user), esPerfil(user)))) {
      // Puede haber cargado igual (pagina pesada o sin respuesta del script):
      // si la pestana esta en el perfil, capturar de todos modos.
      var t0 = null;
      try { t0 = await chrome.tabs.get(a.tabId); } catch (e) { }
      if (!t0 || !esPerfil(user)(t0.url || '')) {
        log(a, user + ': no pude abrir el perfil para la captura (la pestaña quedó en ' + (t0 ? t0.url : '?') + ')');
        return;
      }
    }
    await dormir(2500);   // que terminen de cargar las fotos
    var tab, win;
    try { tab = await chrome.tabs.get(a.tabId); win = await chrome.windows.get(tab.windowId); } catch (e) { return; }
    if (win.state === 'minimized' || !tab.active) {
      a.stats.sinCaptura++;
      log(a, user + ': sin captura (' + (win.state === 'minimized' ? 'ventana minimizada' : 'la pestaña no está al frente') + ')');
      return;
    }
    await aPestana(a, { type: 'autoOcultarPaneles', ocultar: true });
    await espera(250);
    var dataUrl = null, err = '';
    try { dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }); }
    catch (e) { err = String(e && e.message || e); }
    await aPestana(a, { type: 'autoOcultarPaneles', ocultar: false });
    if (!dataUrl) { a.stats.sinCaptura++; log(a, user + ': sin captura (' + err + ')'); return; }
    try {
      var id = await chrome.downloads.download({
        url: dataUrl, filename: limpiar(a.raiz) + '/' + limpiar(carpeta) + '/perfil_' + dia + '.png',
        conflictAction: 'overwrite', saveAs: false
      });
      var fin = await esperarDescarga(id);
      if (!fin.ok) throw new Error(fin.error);
      caps[k] = dia;
      await chrome.storage.local.set({ csCapturas: caps });
      a.stats.capturas++;
      log(a, carpeta + '/perfil_' + dia + '.png 📷');
    } catch (e) {
      a.stats.sinCaptura++;
      log(a, user + ': no se pudo guardar la captura (' + (e.message || e) + ')');
    }
  }

  // ---- Paso 1: reanudar descargas cortadas dentro de la carpeta de videos ----
  async function reanudarCortadas(a) {
    var ds = await chrome.downloads.search({ state: 'interrupted' });
    var marca = ('\\' + a.raiz + '\\').toLowerCase();
    var n = 0;
    for (var i = 0; i < ds.length; i++) {
      var d = ds[i];
      if (String(d.filename).toLowerCase().indexOf(marca) === -1 || !d.canResume) continue;
      try { await chrome.downloads.resume(d.id); n++; } catch (e) { }
    }
    a.stats.reanudadas = n;
    if (n) log(a, 'Reanudadas ' + n + ' descargas cortadas');
  }

  // ---- Paso 2: un perfil del listado ----
  // filtrar = true (fase 1): solo clasifica el perfil y lo cuenta; devuelve
  //   'pendiente' si tiene videos que faltan en disco (y guarda su lista).
  // filtrar = false (fase 2): baja lo que falta de un perfil pendiente.
  // Devuelve { estado, consulto } (consulto: se le pregunto al sitio).
  async function procesar(a, user, filtrar) {
    var k = user.toLowerCase();
    var cuenta = function (campo) { if (filtrar) a.stats[campo]++; };
    try { await CSIndice.releer(user); } catch (e) { }
    var st = await chrome.storage.local.get(['csVideoFolder', 'csVideoSitio']);
    var loc = CSIndice.buscar(st.csVideoFolder, user);
    var nDisco = loc ? loc.n : 0;

    // Con el cache: sin videos, o completo hace poco -> saltear sin consultar.
    var c = (st.csVideoSitio || {})[k];
    if (c && Date.now() - c.at < CACHE_OK_MS) {
      if (!c.n) { cuenta('sinVideos'); return { estado: 'sinVideos' }; }
      if (c.n <= nDisco && !(loc && loc.bajando.length)) { cuenta('completos'); return { estado: 'completo' }; }
    }

    // En la fase 2 se usa la lista que ya trajo el filtro.
    var vp = (!filtrar && a.listas && a.listas[k]) || null;
    if (!vp) {
      a.actual = { user: user, texto: 'consultando el perfil' };
      await guardar(a);
      var r = await pedir(a, '/api/members/profile/' + encodeURIComponent(user));
    if (r.status === 429) {
      log(a, 'El sitio pide ir más despacio: espero 1 min');
      await guardar(a);
      await dormir(ESPERA_429_MS);
      r = await pedir(a, '/api/members/profile/' + encodeURIComponent(user));
    }
      if (r.status === 404) { a.stats.errores++; log(a, user + ': el perfil no existe'); return { estado: 'error', consulto: true }; }
      if (!r.json) {
        if (r.status === 401 || r.status === 403 || /html/i.test(r.ct || '') || r.type === 'opaqueredirect') {
          pausar(a, 'El sitio no respondió con tu sesión (¿se cerró la sesión?). Entrá a contactossex.com y apretá Reanudar.');
          await guardar(a);
          throw DETENER;
        }
        a.stats.errores++; a.seguidos++;
        log(a, user + ': error al consultar el perfil (' + (r.status || r.err) + ')');
        return { estado: 'error', consulto: true };
      }
      vp = CSIndice.videosDePerfil(r.json);
      await CSIndice.guardarSitio(user, vp);
    }
    a.seguidos = 0;
    if (!vp.n) { cuenta('sinVideos'); return { estado: 'sinVideos', consulto: true }; }

    var activas = {};
    (await chrome.downloads.search({ state: 'in_progress' })).forEach(function (d) {
      var m = String(d.filename).match(/[\\\/](\d+)\.mp4$/i);
      if (m) activas[m[1]] = 1;
    });
    a.hechos = a.hechos || {};
    var falt = CSIndice.faltantes(vp.lista, loc, true).filter(function (v) {
      return !activas[String(v.id)] && !a.hechos[String(v.id)];
    });
    if (!falt.length) { cuenta('completos'); return { estado: 'completo', consulto: true }; }

    if (filtrar) {
      a.listas = a.listas || {};
      a.listas[k] = { n: vp.n, lista: vp.lista };
      a.pendientes.push(user);
      return { estado: 'pendiente', consulto: true };
    }

    var carpeta = (loc && loc.folder) || user;
    a.stats.perfiles++;
    log(a, user + ': ' + vp.n + ' en el sitio, ' + nDisco + ' en disco → bajo ' + falt.length +
      (loc && loc.folder ? '' : ' (carpeta nueva)'));
    await capturarPerfil(a, user, carpeta);

    for (var j = 0; j < falt.length; j++) {
      if (await revisarOrden(a)) throw DETENER;
      var v = falt[j];
      a.actual = { user: user, texto: 'bajando ' + v.id + '.mp4 (' + (j + 1) + '/' + falt.length + ')' };
      await guardar(a);
      if (!v.hash) { a.stats.errores++; log(a, user + '/' + v.id + ': el sitio no dio el hash'); continue; }
      var path = '/api/members/videos/' + encodeURIComponent(v.hash);
      var h = await pedir(a, path, true);
      var ev = CSIndice.evaluarVideo(h);
      if (ev.sinAcceso) {
        a.stats.sinAcceso++;
        log(a, user + '/' + v.id + ': sin acceso (' + ev.detalle + ')');
        continue;
      }
      var res = await bajar((h.origin || SITIO) + path, limpiar(a.raiz) + '/' + limpiar(carpeta) + '/' + v.id + '.mp4', a);
      a.descargaId = null;
      if (res.ok) {
        a.stats.bajados++; a.seguidos = 0;
        a.hechos[String(v.id)] = 1;
        log(a, carpeta + '/' + v.id + '.mp4 ✓');
      } else {
        a.stats.errores++; a.seguidos++;
        log(a, user + '/' + v.id + ': ' + res.error);
        if (a.seguidos >= MAX_ERRORES_SEGUIDOS) return { estado: 'error', consulto: true };
      }
      await guardar(a);
      await dormir(PAUSA_VIDEO_MS);
    }
    return { estado: 'bajado', consulto: true };
  }

  function cargarPagina(a, p) {
    a.cola = p.usuarios || [];
    a.i = 0;
    a.siguiente = p.siguiente || null;
    a.urlPagina = p.url || '';
    a.cargada = true;
    a.fase = 'filtro';
    a.pagUsuarios = a.cola.slice();
    a.pendientes = [];
    a.listas = {};
    log(a, 'Página ' + a.pagina + ': ' + a.cola.length + (a.cola.length === 1 ? ' perfil' : ' perfiles') + ' — filtrando los que tienen videos');
  }

  // ---- Bucle principal ----
  async function correr() {
    if (corriendo) return;
    corriendo = true;
    try {
      var a = await leer();
      if (!a || a.estado !== 'corriendo') return;
      if (a.descargaId) { await esperarDescarga(a.descargaId); a.descargaId = null; }
      if (a.paso === 'reanudar') {
        await reanudarCortadas(a);
        a.paso = 'listado';
        await guardar(a);
      }
      while (true) {
        if (await revisarOrden(a)) return;

        if (!a.cargada) {
          if (a.urlPagina) await volverAlListado(a);
          var p = await leerPagina(a);
          if (p && (!p.usuarios || !p.usuarios.length)) {
            pausar(a, 'La pestaña no está en un listado de perfiles. Volvé al listado y apretá Reanudar.');
            await guardar(a);
            return;
          }
          if (!p) {
            pausar(a, 'No encuentro la pestaña del listado (¿la cerraste o cambiaste de página?). Volvé al listado y apretá Reanudar.');
            await guardar(a);
            return;
          }
          cargarPagina(a, p);
          await guardar(a);
          continue;
        }

        if (a.i >= a.cola.length && a.fase === 'filtro') {
          // Filtro terminado: bajar solo los perfiles con faltantes.
          log(a, 'Página ' + a.pagina + ': ' + a.pendientes.length + ' de ' + a.pagUsuarios.length +
            ' con videos que faltan en disco' + (a.pendientes.length ? ' → ' + a.pendientes.join(', ') : ''));
          a.fase = 'bajar';
          a.cola = a.pendientes.slice();
          a.i = 0;
          await guardar(a);
          continue;
        }

        if (a.i >= a.cola.length) {
          // Pagina terminada: a la siguiente.
          a.stats.paginas++;
          if (!a.siguiente) {
            a.estado = 'terminado'; a.fin = Date.now(); a.actual = null;
            log(a, 'Última página: terminado. ' + a.stats.bajados + ' videos bajados');
            await guardar(a);
            return;
          }
          a.actual = { user: '', texto: 'pasando a la página ' + (a.pagina + 1) };
          await guardar(a);
          if (!(a.siguiente && a.siguiente.href)) await volverAlListado(a);
          var n = await irSiguiente(a);
          if (!n) {
            pausar(a, 'No pude pasar a la página siguiente. Revisá la pestaña del listado y apretá Reanudar.');
            await guardar(a);
            return;
          }
          if (!n.usuarios || !n.usuarios.length) {
            a.estado = 'terminado'; a.fin = Date.now(); a.actual = null;
            log(a, 'La página siguiente no tiene perfiles: terminado. ' + a.stats.bajados + ' videos bajados');
            await guardar(a);
            return;
          }
          a.pagina++;
          cargarPagina(a, n);
          await guardar(a);
          continue;
        }

        var res = null;
        try {
          res = await procesar(a, a.cola[a.i], a.fase === 'filtro');
        } catch (e) {
          if (e === DETENER) return;
          a.stats.errores++;
          log(a, a.cola[a.i] + ': ' + e);
        }
        if (a.seguidos >= MAX_ERRORES_SEGUIDOS) {
          a.seguidos = 0;
          pausar(a, MAX_ERRORES_SEGUIDOS + ' errores seguidos: pausé para no insistir. Mirá el registro y apretá Reanudar.');
          await guardar(a);
          return;
        }
        a.i++;
        a.actual = null;
        await guardar(a);
        await dormir(res && res.consulto ? PAUSA_PERFIL_MS : 150);
      }
    } finally {
      corriendo = false;
    }
  }

  async function iniciar(tabId) {
    var idx = (await chrome.storage.local.get('csVideoFolder')).csVideoFolder;
    if (!idx || !idx.carpetas) return { ok: false, err: 'Primero elegí la carpeta de videos.' };
    if (tabId == null) return { ok: false, err: 'Arrancalo desde una página del sitio con perfiles listados.' };
    var ant = await leer();
    if (ant && ant.estado === 'corriendo') return { ok: false, err: 'Ya está corriendo.' };
    var a = {
      estado: 'corriendo', paso: 'reanudar', raiz: idx.rootName, tabId: tabId,
      pagina: 1, cola: [], i: 0, cargada: false, siguiente: null, seguidos: 0, hechos: {},
      stats: { paginas: 0, perfiles: 0, completos: 0, sinVideos: 0, bajados: 0, sinAcceso: 0, errores: 0, reanudadas: 0, capturas: 0, sinCaptura: 0 },
      inicio: Date.now(), log: []
    };
    log(a, 'Inicio en el listado. Carpeta: ' + idx.rootName);
    await chrome.storage.local.remove('csAutoOrden');
    await guardar(a);
    correr();
    return { ok: true };
  }

  async function orden(o, tabId) {
    var a = await leer();
    if (!a) return { ok: false };
    if (o === 'reanudar') {
      if (a.estado !== 'pausado') return { ok: false };
      if (tabId != null && tabId !== a.tabId) {
        // Reanudado desde otra pestana: esa pasa a ser la del listado.
        a.tabId = tabId; a.cargada = false;
      } else if (!a.cargada || !(await pestanaViva(a))) {
        a.cargada = false;
      }
      a.estado = 'corriendo'; a.motivo = null; log(a, 'Reanudado');
      await chrome.storage.local.remove('csAutoOrden');
      await guardar(a);
      correr();
      return { ok: true };
    }
    if (corriendo) {
      await chrome.storage.local.set({ csAutoOrden: o });   // el bucle la aplica
    } else if (o === 'pausar' && a.estado === 'corriendo') {
      pausar(a, 'Pausado por vos.'); await guardar(a);
    } else if (o === 'detener' && (a.estado === 'corriendo' || a.estado === 'pausado')) {
      a.estado = 'detenido'; a.fin = Date.now(); a.actual = null; log(a, 'Detenido'); await guardar(a);
    }
    return { ok: true };
  }

  // Lo llama la alarma de background.js: si figura corriendo pero este
  // service worker no lo esta ejecutando (Chrome lo durmio), retomarlo.
  async function vigilar() {
    if (corriendo) return;
    var a = await leer();
    if (a && a.estado === 'corriendo' && (!a.latido || Date.now() - a.latido > LATIDO_MUERTO_MS)) correr();
  }

  return { iniciar: iniciar, orden: orden, vigilar: vigilar, correr: correr };
})();
