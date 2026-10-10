/* Pantalla de la tienda (trabajadores): catálogo, carrito, código de 3 dígitos, cambio y registro de la venta */
(function () {
  'use strict';
  const CFG = window.TSJ_CONFIG;
  const ORDEN = ['bebidas', 'mecato', 'dulces', 'sal'];
  const CATS = [['todos', 'Todos', '🛒'], ['bebidas', 'Bebidas', '🥤'], ['mecato', 'Mecato', '🍟'], ['dulces', 'Dulces', '🍬'], ['sal', 'Sal', '🥨']];
  const esc = U.esc, money = U.money;

  let cart = {}, cat = 'todos', flujo = null, enviando = false;
  let tIdle = null, tCuenta = null, intentosClave = 0, bloqueoClave = 0;

  /* ---------- Datos derivados ---------- */
  function lista() {
    return Object.entries(S.productos).map(([id, p]) => Object.assign({ id }, p))
      .filter(p => p.activo !== false && (cat === 'todos' || p.categoria === cat))
      .sort((a, b) => (ORDEN.indexOf(a.categoria) - ORDEN.indexOf(b.categoria)) || String(a.nombre).localeCompare(String(b.nombre), 'es'));
  }
  function lineas() {
    return Object.entries(cart).map(([id, q]) => {
      const p = S.productos[id];
      return p ? { id, nombre: p.nombre, cantidad: q, precio: p.precio || 0, costo: p.costo || 0, stock: p.stock || 0 } : null;
    }).filter(Boolean);
  }
  const total = () => lineas().reduce((a, l) => a + l.precio * l.cantidad, 0);
  function normalizar() {
    Object.keys(cart).forEach(id => {
      const p = S.productos[id];
      if (!p || p.activo === false || !(p.precio > 0) || (p.stock || 0) <= 0) delete cart[id];
      else if (cart[id] > p.stock) cart[id] = p.stock;
    });
  }

  /* ---------- Pintado ---------- */
  function card(p) {
    const q = cart[p.id] || 0, stock = p.stock || 0;
    const ago = stock <= 0, sin = !(p.precio > 0), bajo = !ago && stock <= (p.minimo || 0);
    const estado = ago ? 'Agotado' : sin ? 'Sin precio' : bajo ? 'Quedan ' + stock : '';
    const img = U.img(p.imagen) ? `<span class="prod-img"><img src="${esc(p.imagen)}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>` : '';
    return `<button class="prod ${ago || sin ? 'agotado' : ''} ${q ? 'enCarro' : ''} ${img ? 'conImg' : ''}" data-accion="s:add" data-id="${p.id}" ${ago || sin ? 'disabled' : ''}>
      ${img}<span class="prod-nombre">${esc(p.nombre)}</span>
      <span class="prod-precio">${sin ? '—' : money(p.precio)}</span>
      <span class="prod-stock ${bajo ? 'bajo' : ''}">${estado}</span>
      ${q ? `<span class="prod-cant">${q}</span>` : ''}
    </button>`;
  }
  function render() {
    normalizar();
    $('#tabs-cat').innerHTML = CATS.map(([k, n, i]) =>
      `<button class="tab-cat ${k === cat ? 'act' : ''}" data-accion="s:cat" data-cat="${k}">${i} ${n}</button>`).join('');
    const ps = lista();
    let html;
    if (!S.listo) html = '<p class="vacio">Cargando productos…</p>';
    else if (!Object.keys(S.productos).length) html = '<p class="vacio">Aún no hay productos. Entre como administrador para cargarlos.</p>';
    else if (!ps.length) html = '<p class="vacio">No hay productos en esta categoría.</p>';
    else html = ps.map(card).join('');
    $('#grid').innerHTML = html;
    pintarCarrito();
  }
  function pintarCarrito() {
    const ls = lineas(), t = total();
    $('#lineas').innerHTML = ls.length ? ls.map(l => `
      <div class="linea">
        <div class="l-nom">${esc(l.nombre)}<small>${money(l.precio)} c/u</small></div>
        <div class="l-cant"><button class="mini-btn" data-accion="s:menos" data-id="${l.id}">−</button><b>${l.cantidad}</b><button class="mini-btn" data-accion="s:mas" data-id="${l.id}">+</button></div>
        <div class="l-sub">${money(l.precio * l.cantidad)}</div>
        <button class="l-x" data-accion="s:quitar" data-id="${l.id}" aria-label="Quitar">✕</button>
      </div>`).join('') : '<p class="vacio">Toca los productos que te llevas.</p>';
    $('#total-num').textContent = money(t);
    $('#btn-pagar').disabled = !ls.length;
    $('#btn-vaciar').hidden = !ls.length;
  }

  /* ---------- Carrito ---------- */
  function sumar(id, d) {
    const p = S.productos[id]; if (!p) return;
    const q = (cart[id] || 0) + d;
    if (q <= 0) delete cart[id];
    else if (q > (p.stock || 0)) { toast('Solo quedan ' + (p.stock || 0) + ' de ' + p.nombre, 'warn'); return; }
    else cart[id] = q;
    render();
  }

  /* ---------- Flujo de pago ---------- */
  function teclado(extra) {
    const e = extra || ['limpiar', 'C'];
    return `<div class="teclado">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button class="tecla" data-accion="s:tecla" data-k="${n}">${n}</button>`).join('')}
      <button class="tecla tecla-sec" data-accion="s:tecla" data-k="borrar">⌫</button>
      <button class="tecla" data-accion="s:tecla" data-k="0">0</button>
      <button class="tecla tecla-sec" data-accion="s:tecla" data-k="${e[0]}">${e[1]}</button></div>`;
  }
  function abrirPago() {
    if (!lineas().length) return;
    if (!S.conectado) { toast('Sin conexión a internet. Espere a que regrese para registrar su compra.', 'error'); return; }
    flujo = { paso: 'codigo', codigo: '', error: '', trab: null, pago: null, otro: '', esOtro: false, resumen: null };
    pintarFlujo(true);
  }
  function pintarFlujo(abrir) {
    if (!flujo) return;
    const t = flujo.paso === 'exito' ? flujo.resumen.total : total();
    let html = '';
    if (flujo.paso === 'codigo') {
      html = `<div class="paso"><h2>Ingresa tu código</h2><p class="sub">Son 3 dígitos. Si vienes de visita, usa el código de visita.</p>
        <div class="puntos">${[0, 1, 2].map(i => `<span class="punto ${i < flujo.codigo.length ? 'lleno' : ''}">${flujo.codigo[i] || ''}</span>`).join('')}</div>
        <div class="error-msg">${esc(flujo.error)}</div>${teclado()}
        <div class="acciones"><button class="btn btn-sec" data-accion="cerrar">Cancelar</button></div></div>`;
    } else if (flujo.paso === 'nombre') {
      const visita = flujo.trab.tipo === 'visita';
      html = `<div class="paso"><h2>${visita ? 'Compra de visita' : 'Hola'}</h2>
        <div class="nombre-grande">${esc(flujo.trab.nombre)}</div>
        <p class="sub">${visita ? '¿Es correcto?' : '¿Eres tú?'}</p>
        <div class="acciones"><button class="btn btn-sec" data-accion="s:no">No, volver</button><button class="btn btn-prim" data-accion="s:si">Sí, continuar</button></div></div>`;
    } else if (flujo.paso === 'pago') {
      const pago = flujo.pago == null ? t : flujo.pago, cambio = Math.max(0, pago - t);
      html = `<div class="paso"><h2>${esc(flujo.trab.nombre)}</h2>
        <div class="lista-resumen">${lineas().map(l => `<div><span>${l.cantidad} × ${esc(l.nombre)}</span><b>${money(l.precio * l.cantidad)}</b></div>`).join('')}</div>
        <div class="gran-total"><span>Debes dejar en la caja</span><strong>${money(t)}</strong></div>
        <p class="sub" style="margin-bottom:4px">¿Con cuánto pagas? (para calcular tu cambio)</p>
        <div class="billetes">
          <button class="bill ${flujo.pago == null && !flujo.esOtro ? 'sel' : ''}" data-accion="s:pago" data-v="exacto">Pago exacto</button>
          ${CFG.billetes.map(b => `<button class="bill ${flujo.pago === b && !flujo.esOtro ? 'sel' : ''}" data-accion="s:pago" data-v="${b}" ${b < t ? 'disabled' : ''}>${money(b)}</button>`).join('')}
          <button class="bill ${flujo.esOtro ? 'sel' : ''}" data-accion="s:pago" data-v="otro">${flujo.esOtro ? money(flujo.pago) : 'Otro valor'}</button>
        </div>
        <div class="cambio ${cambio > 0 ? 'conCambio' : ''}">${cambio > 0 ? `Tu cambio: <b>${money(cambio)}</b>` : 'Sin cambio'}</div>
        <div class="error-msg">${esc(flujo.error)}</div>
        <div class="acciones"><button class="btn btn-sec" data-accion="cerrar" ${enviando ? 'disabled' : ''}>Cancelar</button>
        <button class="btn btn-prim" data-accion="s:confirmar" ${enviando ? 'disabled' : ''}>${enviando ? 'Registrando…' : 'Confirmar compra'}</button></div></div>`;
    } else if (flujo.paso === 'otro') {
      html = `<div class="paso"><h2>¿Con cuánto pagas?</h2>
        <div class="gran-total"><span>Total a pagar ${money(t)}</span><strong>${flujo.otro ? money(flujo.otro) : '$ 0'}</strong></div>
        <div class="error-msg">${esc(flujo.error)}</div>${teclado(['000', '000'])}
        <div class="acciones"><button class="btn btn-sec" data-accion="s:otroAtras">Atrás</button><button class="btn btn-prim" data-accion="s:otroListo">Listo</button></div></div>`;
    } else if (flujo.paso === 'exito') {
      const r = flujo.resumen;
      html = `<div class="paso exito"><div class="check">✓</div><h2>¡Compra registrada!</h2><p class="sub">Gracias, ${esc(r.nombre)}</p>
        <div class="gran-total"><span>Valor de tu compra</span><strong>${money(r.total)}</strong></div>
        <div class="cambio">Deja en la caja: <b>${money(r.pago)}</b></div>
        ${r.cambio > 0 ? `<div class="cambio conCambio">Toma de cambio: <b>${money(r.cambio)}</b></div>` : ''}
        <div class="acciones"><button class="btn btn-prim" data-accion="s:terminar">Terminar (<span id="cuenta">${r.seg}</span>)</button></div></div>`;
    }
    if (abrir) Modal.abrir(html, { ancho: flujo.paso === 'exito' ? 460 : 470, alCerrar: () => { if (!enviando) { flujo = null; clearInterval(tCuenta); } } });
    else Modal.set(html);
  }

  function tecla(k) {
    actividad();
    if (!flujo) return;
    if (flujo.paso === 'codigo') {
      if (k === 'borrar') flujo.codigo = flujo.codigo.slice(0, -1);
      else if (k === 'limpiar') flujo.codigo = '';
      else if (/^\d$/.test(k) && flujo.codigo.length < 3) flujo.codigo += k;
      flujo.error = '';
      if (flujo.codigo.length === 3) {
        const t = S.trabajadores[flujo.codigo];
        if (t && t.activo !== false) { flujo.trab = t; flujo.paso = 'nombre'; }
        else { flujo.error = 'Código no encontrado. Intenta de nuevo.'; flujo.codigo = ''; }
      }
      pintarFlujo();
    } else if (flujo.paso === 'otro') {
      if (k === 'borrar') flujo.otro = flujo.otro.slice(0, -1);
      else if (k === 'limpiar') flujo.otro = '';
      else if (k === '000') { if (flujo.otro) flujo.otro += '000'; }
      else if (/^\d$/.test(k)) flujo.otro += k;
      flujo.otro = flujo.otro.replace(/^0+/, '').slice(0, 7);
      flujo.error = ''; pintarFlujo();
    }
  }

  async function confirmar() {
    if (enviando || !flujo || flujo.paso !== 'pago') return;
    if (!S.conectado) { flujo.error = 'Sin conexión a internet. Espera a que regrese.'; pintarFlujo(); return; }
    const ls = lineas();
    if (!ls.length) { Modal.cerrar(); return; }
    for (const l of ls) {
      if (l.cantidad > l.stock) { cart[l.id] = Math.max(0, l.stock); normalizar(); render(); flujo.error = 'De "' + l.nombre + '" ya solo quedan ' + l.stock + '. Revisa tu compra.'; flujo.paso = 'pago'; pintarFlujo(); return; }
    }
    const t = total(), costo = ls.reduce((a, l) => a + l.costo * l.cantidad, 0);
    const pago = flujo.pago == null ? t : flujo.pago;
    if (pago < t) { flujo.error = 'El valor con el que pagas no alcanza.'; pintarFlujo(); return; }
    const fecha = U.fechaStr(), ts = Date.now(), key = DB.newKey('ventas');
    const venta = {
      fecha, ts, codigo: flujo.codigo, nombre: flujo.trab.nombre, tipo: flujo.trab.tipo || 'trabajador',
      items: ls.map(l => ({ id: l.id, nombre: l.nombre, cantidad: l.cantidad, precio: l.precio, costo: l.costo })),
      total: t, costo, ganancia: t - costo, pago, cambio: pago - t, estado: 'activa'
    };
    const upd = {};
    upd['ventas/' + key] = venta;
    ls.forEach(l => { upd['productos/' + l.id + '/stock'] = DB.inc(-l.cantidad); });
    upd['resumen/dias/' + fecha + '/ventas'] = DB.inc(t);
    upd['resumen/dias/' + fecha + '/costo'] = DB.inc(costo);
    upd['resumen/dias/' + fecha + '/nVentas'] = DB.inc(1);
    enviando = true; flujo.error = ''; pintarFlujo();
    try {
      await DB.update(upd);
      enviando = false;
      flujo.resumen = { nombre: flujo.trab.nombre, total: t, pago, cambio: pago - t, seg: CFG.segundosExito };
      flujo.paso = 'exito'; cart = {}; render(); pintarFlujo();
      clearInterval(tCuenta);
      tCuenta = setInterval(() => {
        if (!flujo || flujo.paso !== 'exito') { clearInterval(tCuenta); return; }
        flujo.resumen.seg--; const c = $('#cuenta'); if (c) c.textContent = flujo.resumen.seg;
        if (flujo.resumen.seg <= 0) reiniciar();
      }, 1000);
    } catch (e) {
      console.error(e); enviando = false;
      flujo.error = 'No se pudo registrar la compra. Revisa la conexión e intenta de nuevo.'; pintarFlujo();
    }
  }

  /* ---------- Inactividad y reinicio ---------- */
  function actividad() {
    clearTimeout(tIdle);
    if (S.vista !== 'tienda') return;
    tIdle = setTimeout(() => {
      if (enviando || (flujo && flujo.paso === 'exito')) return;
      if (Object.keys(cart).length || Modal.abierto || cat !== 'todos') reiniciar();
    }, CFG.segundosInactividad * 1000);
  }
  function reiniciar() {
    clearInterval(tCuenta); clearTimeout(tIdle);
    cart = {}; cat = 'todos'; flujo = null; enviando = false;
    Modal.cerrar(); render();
  }
  function detener() { clearInterval(tCuenta); clearTimeout(tIdle); }
  ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, () => actividad(), true));

  /* ---------- Clave de administrador ---------- */
  function pedirClave() {
    Modal.abrir(`<h2>Acceso de administrador</h2><p class="sub">Escriba la clave para administrar la tienda.</p>
      <div class="form"><label>Clave<input id="clave" type="password" autocomplete="off" data-enter="s:clave" autofocus></label></div>
      <div id="clave-err" class="error-msg"></div>
      <div class="acciones"><button class="btn btn-sec" data-accion="cerrar">Cancelar</button><button class="btn btn-prim" data-accion="s:clave">Entrar</button></div>`, { ancho: 420 });
  }
  async function verificarClave() {
    const err = $('#clave-err'); if (!err) return;
    if (Date.now() < bloqueoClave) { err.textContent = 'Demasiados intentos. Espere unos segundos.'; return; }
    try {
      const h = await U.sha256($('#clave').value);
      if (h === CFG.claveAdminHash) { intentosClave = 0; App.irAdmin(); return; }
      intentosClave++;
      if (intentosClave >= 5) { bloqueoClave = Date.now() + 30000; intentosClave = 0; }
      err.textContent = 'Clave incorrecta.'; $('#clave').value = ''; $('#clave').focus();
    } catch (e) { err.textContent = e.message; }
  }

  /* ---------- Acciones ---------- */
  function accion(a, el) {
    actividad();
    switch (a) {
      case 'cat': cat = el.dataset.cat; render(); break;
      case 'add': sumar(el.dataset.id, 1); break;
      case 'mas': sumar(el.dataset.id, 1); break;
      case 'menos': sumar(el.dataset.id, -1); break;
      case 'quitar': delete cart[el.dataset.id]; render(); break;
      case 'vaciar': cart = {}; render(); break;
      case 'pagar': abrirPago(); break;
      case 'tecla': tecla(el.dataset.k); break;
      case 'si': flujo.paso = 'pago'; flujo.pago = null; flujo.esOtro = false; pintarFlujo(); break;
      case 'no': flujo.paso = 'codigo'; flujo.codigo = ''; flujo.trab = null; pintarFlujo(); break;
      case 'pago': {
        const v = el.dataset.v, t = total();
        flujo.error = '';
        if (v === 'exacto') { flujo.pago = null; flujo.esOtro = false; pintarFlujo(); }
        else if (v === 'otro') { flujo.paso = 'otro'; flujo.otro = ''; pintarFlujo(); }
        else { flujo.pago = Number(v); flujo.esOtro = false; pintarFlujo(); }
        break;
      }
      case 'otroAtras': flujo.paso = 'pago'; flujo.error = ''; pintarFlujo(); break;
      case 'otroListo': {
        const m = U.parse(flujo.otro), t = total();
        if (m < t) { flujo.error = 'Debe ser igual o mayor a ' + money(t); pintarFlujo(); break; }
        flujo.pago = m; flujo.esOtro = true; flujo.paso = 'pago'; flujo.error = ''; pintarFlujo(); break;
      }
      case 'confirmar': confirmar(); break;
      case 'terminar': reiniciar(); break;
      case 'admin': pedirClave(); break;
      case 'clave': verificarClave(); break;
    }
  }

  /* Teclado físico (digitos) mientras se pide el código o un valor */
  document.addEventListener('keydown', e => {
    if (!flujo || e.target.matches('input,textarea,select')) return;
    if (flujo.paso === 'codigo' || flujo.paso === 'otro') {
      if (/^\d$/.test(e.key)) tecla(e.key);
      else if (e.key === 'Backspace') tecla('borrar');
      else if (e.key === 'Enter' && flujo.paso === 'otro') accion('otroListo');
    } else if (flujo.paso === 'nombre' && e.key === 'Enter') accion('si');
  });

  window.Store = { render, accion, reiniciar, detener };
})();
