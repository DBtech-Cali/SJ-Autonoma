/* Núcleo: estado compartido, modal, avisos y arranque */
(function () {
  'use strict';
  const CFG = window.TSJ_CONFIG;
  const S = window.S = { productos: {}, trabajadores: {}, resumen: {}, conectado: true, vista: 'tienda', listo: false };
  window.$ = (s, r) => (r || document).querySelector(s);
  window.$$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  /* ---------- Modal ---------- */
  const Modal = window.Modal = {
    abierto: false, alCerrar: null,
    abrir(html, opts) {
      opts = opts || {};
      $('#modal-caja').innerHTML = html;
      $('#modal-caja').style.maxWidth = (opts.ancho || 520) + 'px';
      $('#modal').hidden = false; Modal.abierto = true; Modal.alCerrar = opts.alCerrar || null;
      const f = $('#modal-caja [autofocus]'); if (f) setTimeout(() => f.focus(), 40);
    },
    set(html) { $('#modal-caja').innerHTML = html; },
    cerrar() {
      if ($('#modal').hidden) return;
      $('#modal').hidden = true; $('#modal-caja').innerHTML = ''; Modal.abierto = false;
      const cb = Modal.alCerrar; Modal.alCerrar = null; if (cb) cb();
    }
  };

  /* ---------- Avisos ---------- */
  let tToast = null;
  window.toast = function (msg, tipo) {
    const t = $('#toast'); t.textContent = msg; t.className = 'toast ' + (tipo || '');
    t.hidden = false; clearTimeout(tToast); tToast = setTimeout(() => { t.hidden = true; }, 3800);
  };
  function aviso(msg, tipo) {
    const a = $('#aviso'); if (!msg) { a.hidden = true; return; }
    a.textContent = msg; a.className = 'aviso ' + (tipo || ''); a.hidden = false;
  }
  function pintarConexion() {
    ['#estado-con', '#estado-con2'].forEach(id => {
      const c = $(id); if (!c) return;
      c.className = 'chip ' + (S.conectado ? 'ok' : 'mal');
      c.textContent = S.conectado ? '● En línea' : '● Sin conexión';
    });
  }

  /* ---------- Navegación ---------- */
  const App = window.App = {
    irTienda() {
      S.vista = 'tienda'; $('#vista-tienda').hidden = false; $('#vista-admin').hidden = true;
      Modal.cerrar(); Admin.salir(); Store.reiniciar();
    },
    irAdmin() {
      S.vista = 'admin'; $('#vista-tienda').hidden = true; $('#vista-admin').hidden = false;
      Modal.cerrar(); Store.detener(); Admin.entrar();
    },
    refrescar() { if (S.vista === 'tienda') Store.render(); else Admin.refrescar(); },
    aviso
  };

  /* ---------- Eventos globales ---------- */
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-accion]'); if (!a) return;
    const acc = a.dataset.accion;
    if (acc === 'cerrar') { Modal.cerrar(); return; }
    if (acc.startsWith('s:')) Store.accion(acc.slice(2), a, e);
    else if (acc.startsWith('a:')) Admin.accion(acc.slice(2), a, e);
  });
  /* Si el enlace de una imagen de producto no carga, se oculta en lugar de mostrar un ícono roto */
  document.addEventListener('error', e => {
    const img = e.target;
    if (img.tagName !== 'IMG') return;
    const caja = img.closest('.prod-img');
    if (caja) { caja.closest('.prod').classList.remove('conImg'); caja.remove(); } else img.style.visibility = 'hidden';
  }, true);
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.dataset && e.target.dataset.enter) {
      const b = document.querySelector('[data-accion="' + e.target.dataset.enter + '"]'); if (b) b.click();
    }
  });

  /* ---------- Arranque ---------- */
  async function iniciar() {
    $('#nombre-tienda').textContent = CFG.nombreTienda;
    $('#admin-sub').textContent = CFG.nombreTienda;
    document.title = CFG.nombreTienda;
    Store.render();
    try { await DB.iniciar(); }
    catch (e) { console.error(e); aviso('No se pudo conectar con la base de datos: ' + e.message, 'error'); return; }
    if (DB.modo === 'demo') aviso('MODO DEMOSTRACIÓN: los datos se guardan solo en este navegador. Para usar la base de datos real, pegue los datos de Firebase en js/config.js.', 'demo');
    DB.onConexion(c => { S.conectado = c; pintarConexion(); });
    const err = e => { console.error(e); aviso('No hay permiso para leer la base de datos (' + ((e && e.code) || e) + '). Revise las reglas de Firebase y la autenticación anónima.', 'error'); };
    DB.listen('productos', v => { S.productos = v || {}; S.listo = true; App.refrescar(); }, err);
    DB.listen('trabajadores', v => { S.trabajadores = v || {}; }, err);
  }
  document.addEventListener('DOMContentLoaded', iniciar);
})();
