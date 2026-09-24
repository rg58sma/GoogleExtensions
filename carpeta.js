/* Pagina de la extension: elegir carpeta local y armar un indice
   usuario -> cantidad de videos. Chrome no deja leer el disco desde
   el perfil; por eso el handle vive aca y el recuento se guarda en storage.
   Mientras esta pagina esta abierta, relee la carpeta sola (ver indice.js). */
(function () {
  'use strict';

  var RELEER_MS = 15000;
  var estado = document.getElementById('estado');
  var cuando = document.getElementById('cuando');
  var lista = document.getElementById('lista');

  function log(t, cls) {
    estado.className = cls || '';
    estado.textContent = t;
  }

  function lineasGrupo(label, nombres, bajando, out) {
    var c = CSIndice.contar(nombres);
    bajando = bajando || [];
    if (!c.cuenta.length && !c.copias.length && !bajando.length) {
      out.push(label + '  ->  [VACIA]');
      return;
    }
    out.push(label + '  ->  ' + c.cuenta.length + ' video(s)' +
      (c.copias.length ? '  (+' + c.copias.length + ' copia(s), no cuentan)' : '') +
      (bajando.length ? '  (' + bajando.length + ' bajando)' : ''));
    c.cuenta.forEach(function (f) { out.push('    ' + f); });
    c.copias.forEach(function (f) { out.push('    [COPIA] ' + f); });
    bajando.forEach(function (f) { out.push('    [BAJANDO] ' + f); });
  }

  function mostrar(p) {
    if (!p || !p.carpetas) return;
    var lines = [];
    Object.keys(p.carpetas).sort().forEach(function (k) {
      lineasGrupo(p.carpetas[k].folder, p.carpetas[k].files, p.carpetas[k].bajando, lines);
    });
    if ((p.raiz && p.raiz.length) || (p.raizBajando && p.raizBajando.length)) lineasGrupo('(raiz)', p.raiz, p.raizBajando, lines);
    lista.value = lines.length ? lines.join('\n') : '(no se encontraron videos)';
    var vac = p.vacias || [];
    if (vac.length) lines.unshift('CARPETAS VACIAS (' + vac.length + '): ' + vac.join(', '), '');
    log('Carpeta "' + p.rootName + '": ' + p.totalFiles + ' videos' +
      (p.totalCopias ? ' (+' + p.totalCopias + ' copias que no cuentan)' : '') +
      ', ' + (p.totalCarpetas || 0) + ' carpetas' + (vac.length ? ' (' + vac.length + ' vacías)' : '') +
      '. Se compara en cada perfil.', 'ok');
    cuando.textContent = 'Ultima lectura: ' + new Date(p.scannedAt).toLocaleString();
  }

  async function leer(handle) {
    var payload = await CSIndice.escanear(handle);
    await chrome.storage.local.set({
      csVideoFolder: payload,
      csVideoEstado: { estado: 'ok', rootName: handle.name, at: Date.now() }
    });
  }

  async function pick() {
    try {
      var handle = await window.showDirectoryPicker({ id: 'csVideos', mode: 'read' });
      await CSIndice.idbSet('root', handle);
      log('Leyendo "' + handle.name + '"...');
      await leer(handle);
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      log('No se pudo elegir la carpeta: ' + e, 'warn');
    }
  }

  // Con clic: puede pedir permiso a Chrome si se perdio (ej. al reiniciar).
  async function rescan() {
    try {
      var handle = await CSIndice.idbGet('root');
      if (!handle) { log('Primero elegí una carpeta.', 'warn'); return; }
      if ((await handle.queryPermission({ mode: 'read' })) !== 'granted' &&
          (await handle.requestPermission({ mode: 'read' })) !== 'granted') {
        log('Chrome no dio permiso de lectura. Volvé a elegir la carpeta.', 'warn');
        return;
      }
      log('Leyendo "' + handle.name + '"...');
      await leer(handle);
    } catch (e) {
      log('Error al leer: ' + e, 'warn');
    }
  }

  // Sin clic: solo si el permiso sigue vigente.
  async function auto() {
    var st = await CSIndice.releer();
    if (st.estado === 'sin-permiso') {
      log('Chrome pide permiso otra vez para leer "' + st.rootName + '": apretá "Volver a leer".', 'warn');
    }
  }

  // El service worker no pudo leer: lo hace esta pagina, que tiene el permiso.
  chrome.runtime.onMessage.addListener(function (msg) {
    if (msg && msg.type === 'releerEnPagina') CSIndice.releer(msg.user || null);
  });

  document.getElementById('btnElegir').onclick = pick;
  document.getElementById('btnRescan').onclick = rescan;

  chrome.storage.onChanged.addListener(function (ch, area) {
    if (area === 'local' && ch.csVideoFolder) mostrar(ch.csVideoFolder.newValue);
  });

  chrome.storage.local.get('csVideoFolder').then(function (st) {
    mostrar(st.csVideoFolder);
    auto();
  });
  setInterval(auto, RELEER_MS);
})();
