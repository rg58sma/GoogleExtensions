/* Service worker de la extension.
   Baja imagenes (incluso de otro dominio, ej. thumbs.contactossex.com) SIN el
   bloqueo CORS que tiene la pagina, y las convierte a JPG (tamano original).
   El content.js le pide {type:'fetchImg', url} y responde {ok, d(dataURL jpg), w, h}. */

function bytesToBase64(bytes) {
  var bin = '', chunk = 0x8000;
  for (var i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

async function fetchImgAsJpeg(url) {
  try {
    var r = await fetch(url, { credentials: 'include' });
    if (!r.ok) return { ok: false, status: r.status };
    var blob = await r.blob();
    if (blob.type && blob.type.indexOf('text/') === 0) return { ok: false, reason: 'no-image' };
    if (!blob.size) return { ok: false, reason: 'empty' };
    var bmp = await createImageBitmap(blob);
    var canvas = new OffscreenCanvas(bmp.width, bmp.height);
    canvas.getContext('2d').drawImage(bmp, 0, 0);
    var jpg = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
    var buf = await jpg.arrayBuffer();
    var b64 = bytesToBase64(new Uint8Array(buf));
    return { ok: true, d: 'data:image/jpeg;base64,' + b64, w: bmp.width, h: bmp.height, mime: 'image/jpeg' };
  } catch (e) {
    return { ok: false, err: String(e) };
  }
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg && msg.type === 'fetchImg' && msg.url) {
    fetchImgAsJpeg(msg.url).then(sendResponse).catch(function (e) {
      sendResponse({ ok: false, err: String(e) });
    });
    return true; // respuesta asincrona
  }
  if (msg && msg.type === 'openCarpeta') {
    chrome.tabs.create({ url: chrome.runtime.getURL('carpeta.html') });
    sendResponse({ ok: true });
  }
});

chrome.action.onClicked.addListener(function () {
  chrome.tabs.create({ url: chrome.runtime.getURL('carpeta.html') });
});

/* Relectura automatica de la carpeta de videos (ver indice.js). */
importScripts('indice.js', 'auto.js');

var RELEER_CADA_MIN = 0.5;   // alarma: cada 30 s (minimo que admite Chrome)
var RELEER_MIN_MS = 10000;   // lectura completa: no mas de una cada 10 s
var RELEER_USER_MS = 2000;   // subcarpeta de un perfil abierto: cada 2 s
var releyendo = null, ultimaLectura = 0, ultimaUser = {};

// user = perfil abierto: relee solo su subcarpeta (rapido, para ver en vivo
// los videos que se van bajando). Sin user: lectura completa.
function releerCarpeta(forzar, user) {
  if (releyendo) return releyendo;
  var k = user ? String(user).toLowerCase() : '';
  var ult = k ? (ultimaUser[k] || 0) : ultimaLectura;
  if (!forzar && Date.now() - ult < (k ? RELEER_USER_MS : RELEER_MIN_MS)) return Promise.resolve({ estado: 'reciente' });
  releyendo = CSIndice.releer(user).then(function (st) {
    if (k) ultimaUser[k] = Date.now(); else ultimaLectura = Date.now();
    releyendo = null;
    // Si el service worker no puede leer el disco, que lo haga carpeta.html
    // (si esta abierta tiene el permiso de Chrome).
    if (st.estado === 'sin-permiso' || st.estado === 'error') {
      chrome.runtime.sendMessage({ type: 'releerEnPagina', user: user || null }).catch(function () { });
    }
    return st;
  }, function (e) {
    releyendo = null;
    return { estado: 'error', error: String(e) };
  });
  return releyendo;
}

chrome.alarms.get('csReleer', function (a) {
  if (!a) chrome.alarms.create('csReleer', { periodInMinutes: RELEER_CADA_MIN });
});
chrome.alarms.onAlarm.addListener(function (a) {
  if (a.name === 'csReleer') { releerCarpeta(false); CSAuto.vigilar(); }
});

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg && msg.type === 'releerCarpeta') {
    releerCarpeta(!!msg.forzar, msg.user || null).then(sendResponse);
    return true;
  }
});

/* Descargas de videos pedidas por el panel del perfil (ver descargas.js).
   filename es relativo a la carpeta de Descargas de Chrome. */
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg) return;
  if (msg.type === 'descargar' && msg.url && msg.filename) {
    chrome.downloads.download({ url: msg.url, filename: msg.filename, conflictAction: 'uniquify', saveAs: false })
      .then(function (id) { sendResponse({ ok: true, id: id }); },
            function (e) { sendResponse({ ok: false, err: String(e) }); });
    return true;
  }
  if (msg.type === 'estadoDescarga') {
    chrome.downloads.search({ id: msg.id }).then(function (r) {
      var d = r && r[0];
      sendResponse(d ? { state: d.state, error: d.error, bytes: d.bytesReceived, total: d.totalBytes, filename: d.filename, mime: d.mime } : null);
    }, function () { sendResponse(null); });
    return true;
  }
  if (msg.type === 'cancelarDescarga') {
    chrome.downloads.cancel(msg.id).then(function () { sendResponse({ ok: true }); }, function () { sendResponse({ ok: false }); });
    return true;
  }
});

/* Descarga automatica (auto.js): ordenes del panel y retomar al despertar. */
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg && msg.type === 'autoIniciar') {
    CSAuto.iniciar(sender.tab ? sender.tab.id : null).then(sendResponse, function (e) { sendResponse({ ok: false, err: String(e) }); });
    return true;
  }
  if (msg && msg.type === 'autoOrden') {
    CSAuto.orden(msg.orden, sender.tab ? sender.tab.id : null).then(sendResponse, function (e) { sendResponse({ ok: false, err: String(e) }); });
    return true;
  }
});
CSAuto.vigilar();
