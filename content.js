/* Extension ContactosSex -> CCText
   Agrega automaticamente un boton flotante "BAJAR MIS CHATS" en contactossex.com.
   Un clic descarga contactossex_<cuenta>_CCText.sql con chats, perfiles y foto principal.
   No maneja tu contrasena: usa tu sesion ya iniciada. */
(function () {
  'use strict';

  function addButton() {
    if (document.getElementById('csExportBtn')) return;
    if (!document.body) return;

    var box = document.createElement('div');
    box.id = 'csExportBox';
    box.style.cssText = 'position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:2147483647;background:#111;color:#fff;font:14px/1.5 Arial;padding:10px 16px;border-radius:8px;max-width:460px;box-shadow:0 4px 16px rgba(0,0,0,.5);display:none;text-align:center';
    document.body.appendChild(box);

    var btn = document.createElement('button');
    btn.id = 'csExportBtn';
    btn.textContent = '📥 Bajar mis chats';
    btn.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;background:#20c997;color:#fff;border:3px solid #fff;font:bold 16px Arial;padding:14px 20px;border-radius:12px;cursor:pointer;box-shadow:0 4px 18px rgba(0,0,0,.5)';

    // Campo de limite: cuantas charlas (mas viejas) procesar. 0 = sin limite.
    var ctrl = document.createElement('div');
    ctrl.id = 'csExportCtrl';
    ctrl.style.cssText = 'position:fixed;right:18px;bottom:72px;z-index:2147483647;background:#fff;color:#111;font:12px Arial;padding:6px 8px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.3)';
    ctrl.appendChild(document.createTextNode('Límite (0=todo): '));
    var inp = document.createElement('input');
    inp.id = 'csLimite'; inp.type = 'number'; inp.min = '0'; inp.step = '10';
    inp.style.cssText = 'width:64px;font:12px Arial;padding:2px 4px';
    inp.value = localStorage.getItem('csLimite') || '50';
    inp.title = '0 = sin límite. Toma las N charlas más viejas.';
    inp.onchange = function () { localStorage.setItem('csLimite', String(parseInt(inp.value, 10) || 0)); };
    ctrl.appendChild(inp);
    var sel = document.createElement('select');
    sel.id = 'csOrden'; sel.style.cssText = 'font:12px Arial;margin-left:6px';
    sel.innerHTML = '<option value="ultimas">Últimas (viejas)</option><option value="primeras">Primeras (nuevas)</option>';
    sel.value = localStorage.getItem('csOrden') || 'ultimas';
    sel.onchange = function () { localStorage.setItem('csOrden', sel.value); };
    ctrl.appendChild(sel);

    // Dentro del dock de paneles (paneles.js): se pliega/oculta como los demas.
    // Si no esta, queda como antes, suelto abajo a la derecha.
    var panel = (typeof CSPaneles !== 'undefined') ? CSPaneles.cuerpo('descargas', 'csPanelDescargas') : null;
    if (panel) {
      ctrl.style.cssText = 'color:#ddd;font:12px Arial;margin-bottom:8px';
      btn.style.cssText = 'width:100%;background:#20c997;color:#fff;border:0;font:bold 14px Arial;padding:10px 12px;border-radius:8px;cursor:pointer';
      panel.appendChild(ctrl);
      panel.appendChild(btn);
    } else {
      document.body.appendChild(btn);
      document.body.appendChild(ctrl);
    }

    function log(t) { box.style.display = 'block'; box.textContent = t; }

    btn.onclick = async function () {
      btn.disabled = true; btn.textContent = '⏳ Bajando...';
      var BASE = '/api/members/messenger', sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
      var ta = document.createElement('textarea');
      var dec = function (s) { if (s == null) return ''; ta.innerHTML = String(s).replace(/<br\s*\/?>/gi, '\n'); return ta.value; };
      var sq = function (s) { if (s == null) return 'NULL'; return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"; };
      var nz = function (v) { return (v == null || v === '') ? 'NULL' : Number(v); };
      var bit = function (v) { return v ? 1 : 0; };
      var pad = function (n) { return String(n).padStart(2, '0'); };
      var fch = function (ms) { if (!ms) return 'NULL'; var d = new Date(ms); return "'" + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + "'"; };
      var gj = function (u) { return fetch(u, { headers: { 'Accept': 'application/json' } }).then(function (r) { return r.json(); }); };
      var infoPersonal = function (p) { var a = []; if (p.sex) a.push(p.sex); if (p.age) a.push(p.age + ' años'); if (p.sexuality) a.push(p.sexuality); if (p.maritalStatus) a.push(p.maritalStatus); return a.join(', '); };
      var ubic = function (p) { var a = []; if (p.locality) a.push(p.locality); if (p.state) a.push(p.state); if (p.country) a.push(p.country); return a.join(', '); };
      // Extrae y FORMATEA telefono / telegram / instagram / teams del texto (descripcion + chat).
      var extraer = function (txt) {
        txt = String(txt || ''); var r = { tel: '', tg: '', ig: '', team: '' }, m;
        // Instagram -> @usuario (minuscula)
        if ((m = txt.match(/instagram\.com\/([A-Za-z0-9._]{2,30})/i)) || (m = txt.match(/(?:instagram|insta)\s*[:@=]*\s*@?([A-Za-z0-9._]{3,30})/i))) r.ig = '@' + m[1].toLowerCase();
        // Telegram -> @usuario
        if ((m = txt.match(/t\.me\/([A-Za-z0-9_]{4,32})/i)) || (m = txt.match(/(?:telegram|tele|\btg\b)\s*[:@=]*\s*@?([A-Za-z0-9_]{4,32})/i))) r.tg = '@' + m[1];
        // Telefono -> solo + y digitos, formateado +54 9 351 123 4567 si es AR
        if ((m = txt.match(/(\+?\d[\d\s().\-]{7,16}\d)/))) {
          var d = m[1].replace(/[^\d+]/g, '');
          r.tel = d;
        }
        // Teams -> normalmente un email; si no, un handle
        if ((m = txt.match(/teams?\s*[:@=]*\s*([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})/i))) r.team = m[1].toLowerCase();
        else if ((m = txt.match(/teams?\s*[:@=]*\s*@?([A-Za-z0-9._@\-]{3,40})/i))) r.team = m[1];
        return r;
      };
      // Mide el tamano real de una imagen por su URL (naturalWidth se lee cross-origin).
      var dims = function (url) { return new Promise(function (res) { var img = new Image(); var done = false; img.onload = function () { if (!done) { done = true; res({ w: img.naturalWidth, h: img.naturalHeight }); } }; img.onerror = function () { if (!done) { done = true; res(null); } }; img.src = url; setTimeout(function () { if (!done) { done = true; res(null); } }, 8000); }); };
      // Candidatos de imagen grande a partir de la miniatura.
      var candidatos = function (thumb) { var c = [thumb]; c.push(thumb.replace('thumbs.contactossex.com', 'contactossex.com')); c.push(thumb.replace('thumbs.contactossex.com', 'media.contactossex.com')); c.push(thumb.replace('thumbs.contactossex.com', 'img.contactossex.com')); c.push(thumb.replace('/photos/', '/photos/original/')); c.push(thumb.replace(/\.webp$/, '.jpg')); return c.filter(function (v, i, a) { return a.indexOf(v) === i; }); };
      // No asume un host fijo (media. no es seguro): mide TODAS las candidatas y elige.
      // Devuelve la mas grande (para bajar) y la "completa" = la mas grande que NO es la
      // miniatura thumbs y que realmente carga (verificada por tamano).
      var bestUrl = async function (p) {
        var thumb = p.profilePictureUrl; if (!thumb) return null;
        var cs = candidatos(thumb);
        var big = { url: thumb, w: 0, h: 0 }, bigArea = 0, comp = null, compArea = 0;
        for (var i = 0; i < cs.length; i++) {
          var d = await dims(cs[i]); if (!d) continue;
          var area = d.w * d.h;
          if (area > bigArea) { bigArea = area; big = { url: cs[i], w: d.w, h: d.h }; }
          if (cs[i].indexOf('thumbs.contactossex.com') === -1 && area > compArea) { compArea = area; comp = cs[i]; }
        }
        return { url: big.url, w: big.w, h: big.h, completa: comp };
      };
      // Baja la imagen de una URL por el service worker (sin CORS) y la pasa a JPG.
      var bajarImg = async function (url) { if (!url) return null; try { var resp = await chrome.runtime.sendMessage({ type: 'fetchImg', url: url }); if (resp && resp.ok && resp.d) return { d: resp.d, w: resp.w, h: resp.h, mime: resp.mime, url: url }; } catch (e) { } return null; };
      try {
        log('Bajando conversaciones...');
        var cur = null, convs = [], seen = {}, g = 0;
        while (true) { var u = BASE + '/conversations' + (cur != null ? '?cursor=' + encodeURIComponent(cur) : ''); var r = await gj(u); if (!r.items || !r.items.length) break; for (var i = 0; i < r.items.length; i++) { var it = r.items[i]; if (!seen[it.peerId]) { seen[it.peerId] = 1; convs.push(it); } } if (r.nextCursor == null || r.nextCursor === cur) break; cur = r.nextCursor; if (++g > 500) break; await sleep(60); }
        if (convs.length === 0) { log('Esta cuenta no tiene conversaciones (o es gratuita con mensajeria limitada).'); btn.disabled = false; btn.textContent = '📥 Bajar mis chats'; return; }
        var limite = parseInt((document.getElementById('csLimite') && document.getElementById('csLimite').value) || localStorage.getItem('csLimite') || '50', 10);
        if (isNaN(limite) || limite < 0) limite = 0;
        var totalConv = convs.length;
        var orden = (document.getElementById('csOrden') && document.getElementById('csOrden').value) || localStorage.getItem('csOrden') || 'ultimas';
        // La lista viene de mas nueva a mas vieja: "primeras"=nuevas (inicio), "ultimas"=viejas (final).
        if (limite > 0 && convs.length > limite) convs = (orden === 'primeras') ? convs.slice(0, limite) : convs.slice(-limite);
        log((limite > 0 ? ('Limite ' + limite + ' (' + (orden === 'primeras' ? 'primeras/nuevas' : 'ultimas/viejas') + '): ') : 'Sin limite: ') + convs.length + ' de ' + totalConv + ' contactos. Perfiles y fotos...');
        for (var i = 0; i < convs.length; i++) {
          try { convs[i].perfil = await gj('/api/members/profile/' + encodeURIComponent(convs[i].peerUsername)); } catch (e) { convs[i].perfil = null; }
          try { convs[i].bu = await bestUrl(convs[i].perfil || {}); } catch (e) { convs[i].bu = null; }
          try { convs[i].big = (convs[i].bu && convs[i].bu.url) ? await bajarImg(convs[i].bu.url) : null; } catch (e) { convs[i].big = null; }
          if ((i + 1) % 5 === 0 || i === convs.length - 1) log('Perfiles/fotos ' + (i + 1) + '/' + convs.length);
          await sleep(40);
        }
        log('Bajando mensajes...');
        var todos = [];
        for (var i = 0; i < convs.length; i++) { var pid = convs[i].peerId, c = null, gg = 0; while (true) { var u = BASE + '/conversations/' + pid + '/messages' + (c != null ? '?cursor=' + encodeURIComponent(c) : ''); var r; try { r = await gj(u); } catch (e) { break; } if (!r.items || !r.items.length) break; for (var k = 0; k < r.items.length; k++) todos.push({ pid: pid, m: r.items[k] }); if (r.nextCursor == null || r.nextCursor === c) break; c = r.nextCursor; if (++gg > 1000) break; await sleep(40); } if ((i + 1) % 10 === 0 || i === convs.length - 1) log('Mensajes ' + (i + 1) + '/' + convs.length + ' (' + todos.length + ' msgs)'); await sleep(25); }
        var myId = null; { var cnt = {}; for (var t = 0; t < todos.length; t++) { var mm = todos[t].m, pp = todos[t].pid; var cand = (mm.senderId === pp) ? mm.receiverId : mm.senderId; cnt[cand] = (cnt[cand] || 0) + 1; } var bestc = -1; for (var kk in cnt) { if (cnt[kk] > bestc) { bestc = cnt[kk]; myId = Number(kk); } } }
        if (!myId) { log('No hay mensajes para deducir tu cuenta.'); btn.disabled = false; btn.textContent = '📥 Bajar mis chats'; return; }
        var myUsername = null;
        try { var lo = document.querySelector('a[href$="/logout"]'); var pe = lo && lo.parentElement; for (var q = 0; q < 6 && pe && !myUsername; q++) { var aa = pe.querySelector('a[href*="/members/profile/"]'); if (aa) myUsername = decodeURIComponent(aa.getAttribute('href').split('/members/profile/')[1].split(/[\/?#]/)[0]); pe = pe.parentElement; } } catch (e) { }
        if (!myUsername) { try { var a2 = document.querySelector('nav a[href*="/members/profile/"], header a[href*="/members/profile/"]'); if (a2) myUsername = decodeURIComponent(a2.getAttribute('href').split('/members/profile/')[1].split(/[\/?#]/)[0]); } catch (e) { } }
        if (!myUsername) myUsername = 'cuenta_' + myId;
        log('Cuenta ' + myUsername + '. Generando archivo...');
        var L = [];
        // Fecha/hora real de la DESCARGA (momento del clic) y usuario que exporta.
        var _d = new Date();
        var fdesc = _d.getFullYear() + '-' + pad(_d.getMonth() + 1) + '-' + pad(_d.getDate()) + ' ' + pad(_d.getHours()) + ':' + pad(_d.getMinutes()) + ':' + pad(_d.getSeconds());
        var fcompact = '' + _d.getFullYear() + pad(_d.getMonth() + 1) + pad(_d.getDate()) + pad(_d.getHours()) + pad(_d.getMinutes()) + pad(_d.getSeconds());
        L.push('-- ContactosSex -> CCText');
        L.push('-- Usuario (ID): ' + myId + '   usuario: ' + myUsername);
        L.push('-- Descargado: ' + fdesc);
        L.push('CREATE DATABASE IF NOT EXISTS CCText CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;');
        L.push('USE CCText;');
        L.push('SET NAMES utf8mb4;');
        L.push('CREATE TABLE IF NOT EXISTS cuentas (cuenta_id BIGINT PRIMARY KEY, username VARCHAR(255), exportado DATETIME) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;');
        L.push('CREATE TABLE IF NOT EXISTS conversaciones (cuenta_id BIGINT, peer_id BIGINT, peer_username VARCHAR(255), no_leidos INT DEFAULT 0, activo TINYINT DEFAULT 1, sync_ts DATETIME, PRIMARY KEY(cuenta_id, peer_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;');
        L.push('CREATE TABLE IF NOT EXISTS perfiles (peer_id BIGINT PRIMARY KEY, username VARCHAR(255), info_personal VARCHAR(255), sexo VARCHAR(50), edad INT, sexualidad VARCHAR(80), estado_civil VARCHAR(80), ubicacion VARCHAR(255), pais VARCHAR(100), provincia VARCHAR(120), localidad VARCHAR(120), seguidores INT, seguidos INT, visitas INT, buscando TEXT, bloqueando VARCHAR(255), descripcion TEXT, gold TINYINT(1), conectado TINYINT(1), foto_url VARCHAR(500), foto_completa VARCHAR(500), bloqueado TINYINT(1), telefono VARCHAR(60), telegram VARCHAR(120), instagram VARCHAR(120), team VARCHAR(120)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;');
        L.push('CREATE TABLE IF NOT EXISTS foto_principal (peer_id BIGINT PRIMARY KEY, username VARCHAR(255), foto_url VARCHAR(500), ancho INT, alto INT, mime VARCHAR(60), foto_base64 LONGTEXT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;');
        L.push('CREATE TABLE IF NOT EXISTS medios (peer_id BIGINT, media_id BIGINT, tipo INT, likes INT, hash VARCHAR(60), zoom_url VARCHAR(255), url_thumb VARCHAR(500), url_completa VARCHAR(500), PRIMARY KEY(peer_id, media_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;');
        L.push('CREATE TABLE IF NOT EXISTS mensajes (id BIGINT PRIMARY KEY, cuenta_id BIGINT, peer_id BIGINT, sender_id BIGINT, receiver_id BIGINT, es_mio TINYINT(1), mensaje TEXT, fecha DATETIME, leido TINYINT(1), activo TINYINT DEFAULT 1, sync_ts DATETIME, INDEX(cuenta_id, peer_id), FULLTEXT(mensaje)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;');
        // Agrega columnas nuevas si la base ya existia (idempotente, sin DROP). Compatible con MySQL 5.7.
        var altcol = function (t, c, d) { return "SET @e:=(SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='CCText' AND TABLE_NAME='" + t + "' AND COLUMN_NAME='" + c + "');\nSET @s:=IF(@e=0,'ALTER TABLE " + t + " ADD COLUMN " + c + " " + d + "','DO 0');\nPREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;"; };
        L.push(altcol('perfiles', 'foto_url', 'VARCHAR(500)'));
        L.push(altcol('perfiles', 'foto_completa', 'VARCHAR(500)'));
        L.push(altcol('perfiles', 'bloqueado', 'TINYINT(1)'));
        L.push(altcol('perfiles', 'telefono', 'VARCHAR(60)'));
        L.push(altcol('perfiles', 'telegram', 'VARCHAR(120)'));
        L.push(altcol('perfiles', 'instagram', 'VARCHAR(120)'));
        L.push(altcol('perfiles', 'team', 'VARCHAR(120)'));
        L.push(altcol('mensajes', 'activo', 'TINYINT DEFAULT 1'));
        L.push(altcol('mensajes', 'sync_ts', 'DATETIME'));
        L.push(altcol('conversaciones', 'activo', 'TINYINT DEFAULT 1'));
        L.push(altcol('conversaciones', 'sync_ts', 'DATETIME'));
        L.push('INSERT INTO cuentas (cuenta_id,username,exportado) VALUES (' + myId + ',' + sq(myUsername) + ',' + sq(fdesc) + ') ON DUPLICATE KEY UPDATE username=VALUES(username),exportado=VALUES(exportado);');
        // Junta todo el texto del chat por contacto (para buscar telefono/telegram/instagram/team).
        var textoPeer = {};
        for (var tt = 0; tt < todos.length; tt++) { var pk = todos[tt].pid; textoPeer[pk] = (textoPeer[pk] || '') + ' ' + dec(todos[tt].m.message); }
        for (var i = 0; i < convs.length; i++) {
          var c = convs[i], p = c.perfil || {};
          var ex = extraer((textoPeer[c.peerId] || '') + ' ' + dec(p.text));
          L.push('INSERT INTO conversaciones (cuenta_id,peer_id,peer_username,no_leidos,activo,sync_ts) VALUES (' + myId + ',' + c.peerId + ',' + sq(dec(c.peerUsername)) + ',' + (c.unread || 0) + ',1,' + sq(fdesc) + ') ON DUPLICATE KEY UPDATE peer_username=VALUES(peer_username),no_leidos=VALUES(no_leidos),activo=1,sync_ts=VALUES(sync_ts);');
          L.push('INSERT INTO perfiles (peer_id,username,info_personal,sexo,edad,sexualidad,estado_civil,ubicacion,pais,provincia,localidad,seguidores,seguidos,visitas,buscando,bloqueando,descripcion,gold,conectado,foto_url,foto_completa,bloqueado,telefono,telegram,instagram,team) VALUES (' + c.peerId + ',' + sq(dec(c.peerUsername)) + ',' + sq(infoPersonal(p)) + ',' + sq(p.sex) + ',' + nz(p.age) + ',' + sq(p.sexuality) + ',' + sq(p.maritalStatus) + ',' + sq(ubic(p)) + ',' + sq(p.country) + ',' + sq(p.state) + ',' + sq(p.locality) + ',' + nz(p.followersCount) + ',' + nz(p.followingCount) + ',' + nz(p.visitsCount) + ',' + sq(p.looking) + ',' + sq(p.filter) + ',' + sq(dec(p.text)) + ',' + bit(p.gold) + ',' + bit(p.connected) + ',' + sq(p.profilePictureUrl) + ',' + sq(c.bu && c.bu.completa) + ',' + bit(p.blocked) + ',' + (ex.tel ? sq(ex.tel) : 'NULL') + ',' + (ex.tg ? sq(ex.tg) : 'NULL') + ',' + (ex.ig ? sq(ex.ig) : 'NULL') + ',' + (ex.team ? sq(ex.team) : 'NULL') + ') ON DUPLICATE KEY UPDATE info_personal=VALUES(info_personal),descripcion=VALUES(descripcion),foto_url=VALUES(foto_url),foto_completa=VALUES(foto_completa),bloqueado=VALUES(bloqueado),telefono=COALESCE(VALUES(telefono),telefono),telegram=COALESCE(VALUES(telegram),telegram),instagram=COALESCE(VALUES(instagram),instagram),team=COALESCE(VALUES(team),team);');
          var fu = (c.bu && c.bu.url) || p.profilePictureUrl || (c.big && c.big.url) || null;
          if (fu || c.big) L.push('INSERT INTO foto_principal (peer_id,username,foto_url,ancho,alto,mime,foto_base64) VALUES (' + c.peerId + ',' + sq(dec(c.peerUsername)) + ',' + sq(fu) + ',' + (c.big ? nz(c.big.w) : 'NULL') + ',' + (c.big ? nz(c.big.h) : 'NULL') + ',' + (c.big ? sq(c.big.mime) : 'NULL') + ',' + (c.big ? sq(c.big.d) : 'NULL') + ') ON DUPLICATE KEY UPDATE foto_url=VALUES(foto_url), foto_base64=COALESCE(VALUES(foto_base64), foto_base64);');
          // Galeria del contacto: guarda la URL de cada foto/video (miniatura + completa media.)
          if (p.mediaItems && p.mediaItems.length) {
            for (var mi = 0; mi < p.mediaItems.length; mi++) {
              var mit = p.mediaItems[mi]; var th = mit.thumbnail || '';
              var comp = th ? th.replace('thumbs.contactossex.com', 'media.contactossex.com') : '';
              var hs = mit.hash || '';
              // Ruta para abrir el medio (requiere cuenta con permiso). video-zoom confirmado; photo-zoom es estimado.
              var esVideo = (th.indexOf('/videos/') !== -1 || mit.type === 1);
              var zoom = hs ? ('https://contactossex.com/members/' + (esVideo ? 'video-zoom' : 'picture-zoom') + '?id=' + hs) : '';
              L.push('INSERT INTO medios (peer_id,media_id,tipo,likes,hash,zoom_url,url_thumb,url_completa) VALUES (' + c.peerId + ',' + (mit.id || 0) + ',' + nz(mit.type) + ',' + nz(mit.likes) + ',' + sq(hs) + ',' + sq(zoom) + ',' + sq(th) + ',' + sq(comp) + ') ON DUPLICATE KEY UPDATE hash=VALUES(hash),zoom_url=VALUES(zoom_url),url_thumb=VALUES(url_thumb),url_completa=VALUES(url_completa);');
            }
          }
        }
        var B = 500;
        for (var j = 0; j < todos.length; j += B) { var ch = todos.slice(j, j + B); var rows = ch.map(function (o) { var m = o.m, pid = o.pid; return '(' + m.id + ',' + myId + ',' + pid + ',' + m.senderId + ',' + m.receiverId + ',' + ((m.senderId === myId) ? 1 : 0) + ',' + sq(dec(m.message)) + ',' + fch(m.sentAt) + ',' + (m.readed ? 1 : 0) + ',1,' + sq(fdesc) + ')'; }); L.push('INSERT INTO mensajes (id,cuenta_id,peer_id,sender_id,receiver_id,es_mio,mensaje,fecha,leido,activo,sync_ts) VALUES\n' + rows.join(',\n') + '\nON DUPLICATE KEY UPDATE mensaje=VALUES(mensaje),activo=1,sync_ts=VALUES(sync_ts);'); }
        // Marcar como borrado (activo=0) lo NO visto en esta corrida. Se mantiene, no se borra.
        var pids = convs.map(function (c) { return c.peerId; }).join(',');
        if (pids) L.push('UPDATE mensajes SET activo=0 WHERE cuenta_id=' + myId + ' AND peer_id IN (' + pids + ') AND (sync_ts IS NULL OR sync_ts<' + sq(fdesc) + ');');
        if (limite <= 0) L.push('UPDATE conversaciones SET activo=0 WHERE cuenta_id=' + myId + ' AND (sync_ts IS NULL OR sync_ts<' + sq(fdesc) + ');');
        var blob = new Blob([L.join('\n')], { type: 'text/sql;charset=utf-8' });
        var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'CCTEX_' + myId + '_' + fcompact + '.sql'; document.body.appendChild(a); a.click(); a.remove();
        var cf = convs.filter(function (c) { return c.big; }).length;
        log('✅ LISTO ' + myUsername + ': ' + convs.length + ' contactos (' + cf + ' con foto), ' + todos.length + ' mensajes. Descargado.');
        btn.style.background = '#2e7d32'; btn.textContent = '✅ Descargado';
        setTimeout(function () { btn.style.background = '#20c997'; btn.textContent = '📥 Bajar mis chats'; btn.disabled = false; }, 8000);
      } catch (e) { log('Error: ' + e); btn.disabled = false; btn.textContent = '📥 Bajar mis chats'; }
    };
  }

  addButton();
  // Reponer el boton si la pagina (SPA) redibuja el contenido.
  setInterval(addButton, 2000);
})();
