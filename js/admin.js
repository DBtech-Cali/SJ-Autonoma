/* Panel del administrador: resumen, calendario, inventario, productos, trabajadores, cierre semanal y respaldo */
(function () {
  'use strict';
  const CFG = window.TSJ_CONFIG;
  const ORDEN = ['bebidas', 'mecato', 'dulces', 'sal'];
  const CATN = { bebidas: 'Bebidas', mecato: 'Mecato', dulces: 'Dulces', sal: 'Sal' };
  const TABS = [['resumen', 'Resumen'], ['calendario', 'Calendario'], ['inventario', 'Inventario'], ['productos', 'Productos'],
    ['trabajadores', 'Trabajadores'], ['consumo', 'Consumo'], ['pastoral', 'Pastoral'], ['cierre', 'Cierre de caja'], ['respaldo', 'Respaldo']];
  const esc = U.esc, money = U.money, P = U.parse;
  const hoy = () => U.fechaStr();

  let tab = 'resumen', unsub = [], tLock = null, tRef = null, repos = {}, pastoral = {}, mermas = {};
  let past = { y: new Date().getFullYear(), m: new Date().getMonth() };
  const ahora = new Date();
  let cal = { y: ahora.getFullYear(), m: ahora.getMonth() }, calDia = hoy(), diaVentas = null;
  let editId = null, anularId = null, cierreCalc = null, desdeTs = 0, cierres = [];
  let rep = { y: ahora.getFullYear(), m: ahora.getMonth() }, repDatos = null, repCodigo = null;

  /* ---------- Datos derivados ---------- */
  const prods = () => Object.entries(S.productos).map(([id, p]) => Object.assign({ id }, p))
    .sort((a, b) => (ORDEN.indexOf(a.categoria) - ORDEN.indexOf(b.categoria)) || String(a.nombre).localeCompare(String(b.nombre), 'es'));
  /* Ganancia = ventas − costo de lo vendido − mermas ± descuadre de caja (faltante resta, sobrante suma) */
  const gan = d => d ? (d.ventas || 0) - (d.costo || 0) - (d.mermas || 0) + (d.caja || 0) : 0;
  /* Dos inventarios: stock = en la tienda (lo que se vende), bodega = guardado. El mínimo se mide sobre el total. */
  const totalInv = p => (p.stock || 0) + (p.bodega || 0);
  const ratio = p => (p.minimo > 0 ? totalInv(p) / p.minimo : totalInv(p));
  const urgentes = () => prods().filter(p => p.activo !== false && totalInv(p) <= (p.minimo || 0)).sort((a, b) => ratio(a) - ratio(b));
  /* Cuánto conviene pasar de bodega a tienda para volver a la cantidad fija */
  const sugerido = p => (p.surtido > 0 ? Math.max(0, Math.min(p.surtido - (p.stock || 0), p.bodega || 0)) : 0);
  const porSurtir = () => prods().filter(p => p.activo !== false && sugerido(p) > 0);
  function suma(filtro) {
    const r = { ventas: 0, costo: 0, mermas: 0, caja: 0, nVentas: 0 };
    Object.entries(S.resumen).forEach(([f, d]) => {
      if (!filtro(f)) return;
      r.ventas += d.ventas || 0; r.costo += d.costo || 0; r.mermas += d.mermas || 0; r.caja += d.caja || 0; r.nVentas += d.nVentas || 0;
    });
    r.ganancia = r.ventas - r.costo - r.mermas + r.caja;
    r.invertido = 0; r.nCompras = 0;
    Object.values(repos).forEach(c => { if (c && c.fecha && filtro(c.fecha)) { r.invertido += c.total || 0; r.nCompras++; } });
    r.pastoral = 0; r.nPastoral = 0;
    pastoralesActivos().forEach(g => { if (filtro(g.fecha)) { r.pastoral += g.monto || 0; r.nPastoral++; } });
    r.disponible = r.ganancia - r.pastoral;
    return r;
  }
  const pastoralesActivos = () => Object.entries(pastoral).map(([id, g]) => Object.assign({ id }, g)).filter(g => g && g.fecha && g.estado !== 'anulado');
  /* Totales por día de compras y gastos pastorales (para el calendario) */
  function porDia(mesK) {
    const d = {};
    const de = f => d[f] || (d[f] = { compras: 0, pastoral: 0 });
    Object.values(repos).forEach(c => { if (c && c.fecha && c.fecha.startsWith(mesK)) de(c.fecha).compras += c.total || 0; });
    pastoralesActivos().forEach(g => { if (g.fecha.startsWith(mesK)) de(g.fecha).pastoral += g.monto || 0; });
    return d;
  }
  const errMsg = e => { console.error(e); toast('No se pudo guardar: ' + ((e && e.message) || e), 'error'); };

  /* ---------- Ciclo de vida ---------- */
  function entrar() {
    tab = 'resumen'; calDia = hoy(); cal = { y: new Date().getFullYear(), m: new Date().getMonth() }; diaVentas = null;
    rep = { y: cal.y, m: cal.m }; repDatos = null; past = { y: cal.y, m: cal.m };
    unsub = [
      DB.listen('resumen/dias', v => { S.resumen = v || {}; refrescar(); }, e => { console.error(e); toast('Sin permiso para leer los resúmenes.', 'error'); }),
      DB.listen('reposiciones', v => { repos = v || {}; refrescar(); }, e => { console.error(e); toast('Sin permiso para leer las compras.', 'error'); }),
      DB.listen('pastoral', v => { pastoral = v || {}; refrescar(); }, e => { console.error(e); toast('Sin permiso para leer los gastos pastorales.', 'error'); }),
      DB.listen('mermas', v => { mermas = v || {}; refrescar(); }, e => { console.error(e); })
    ];
    bloqueo(); render();
  }
  function salir() {
    unsub.forEach(u => { if (u) u(); }); unsub = [];
    clearTimeout(tLock); clearTimeout(tRef); S.resumen = {}; repos = {}; pastoral = {}; mermas = {};
  }
  function bloqueo() {
    clearTimeout(tLock);
    tLock = setTimeout(() => { if (S.vista === 'admin') { App.irTienda(); toast('El panel de administrador se cerró por inactividad.'); } }, CFG.minutosBloqueoAdmin * 60000);
  }
  ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, () => { if (S.vista === 'admin') bloqueo(); }, true));

  function refrescar() {
    if (S.vista !== 'admin') return;
    if (tab === 'cierre' || tab === 'respaldo') return;      // formularios largos: no se redibujan solos
    if (tab === 'pastoral' && ($('#gp-monto') || {}).value) return;   // no borrar un gasto a medio escribir
    const f = document.activeElement;
    if (f && f.matches && f.matches('input,select,textarea') && $('#admin-contenido').contains(f)) return;
    clearTimeout(tRef); tRef = setTimeout(render, 80);
  }

  /* ---------- Render principal ---------- */
  function render() {
    if (S.vista !== 'admin') return;
    $('#admin-tabs').innerHTML = TABS.map(([k, n]) => `<button class="admin-tab ${k === tab ? 'act' : ''}" data-accion="a:tab" data-tab="${k}">${n}</button>`).join('');
    const cont = $('#admin-contenido');
    cont.innerHTML = ({ resumen: vResumen, calendario: vCalendario, inventario: vInventario, productos: vProductos,
      trabajadores: vTrabajadores, consumo: vConsumo, pastoral: vPastoral, cierre: vCierre, respaldo: vRespaldo })[tab]();
    if (tab === 'consumo') cargarConsumo();
    if (tab === 'calendario') cargarDia();
    if (tab === 'cierre') iniciarCierre();
    if (tab === 'trabajadores') DB.get('trabajadores').then(v => { S.trabajadores = v || {}; });
  }

  /* ---------- RESUMEN ---------- */
  function tarjeta(titulo, r, conSaldo) {
    return `<div class="tarjeta"><h4>${titulo}</h4>
      <div class="t-venta">${money(r.ventas)}</div>
      <div class="det">Ventas · ${r.nVentas} venta${r.nVentas === 1 ? '' : 's'}</div>
      <div class="t-filas">
        <div><span>Ganancia</span><b class="gan-s ${r.ganancia < 0 ? 'neg' : ''}">${money(r.ganancia)}</b></div>
        ${r.mermas ? `<div class="t-sub"><span>incluye pérdidas por mermas</span><b>−${money(r.mermas)}</b></div>` : ''}
        ${r.caja ? `<div class="t-sub"><span>incluye ${r.caja < 0 ? 'faltante' : 'sobrante'} de caja</span><b class="${r.caja < 0 ? 'neg' : ''}">${r.caja > 0 ? '+' : '−'}${money(Math.abs(r.caja))}</b></div>` : ''}
        <div><span>Invertido en compras${r.nCompras ? ` <small>(${r.nCompras})</small>` : ''}</span><b class="inv-s">${money(r.invertido)}</b></div>
        <div><span>Gasto pastoral${r.nPastoral ? ` <small>(${r.nPastoral})</small>` : ''}</span><b class="past-s">${money(r.pastoral)}</b></div>
        ${conSaldo ? `<div class="t-saldo"><span>Utilidad disponible</span><b class="${r.disponible < 0 ? 'neg' : ''}">${money(r.disponible)}</b></div>` : ''}
      </div></div>`;
  }
  function listaUrgente() {
    const u = urgentes();
    if (!u.length) return '<p class="nota">✅ Nada urgente por comprar.</p>';
    return `<div class="urgentes">${u.map(p => `<div class="urg ${totalInv(p) <= 0 ? 'cero' : ''}"><b>${esc(p.nombre)}</b>
      <span>${totalInv(p) <= 0 ? '<b style="display:inline;color:var(--mal)">AGOTADO</b> · ' : ''}Tienda ${p.stock || 0} · Bodega ${p.bodega || 0} · mínimo ${p.minimo || 0}</span></div>`).join('')}</div>`;
  }
  function avisoSurtir() {
    const n = porSurtir().length;
    return n ? `<div class="alerta-caja alerta-info">📦 ${n} producto${n === 1 ? '' : 's'} por surtir en la tienda desde la bodega.
      <button class="btn btn-prim btn-peq" data-accion="a:surtir">Surtir tienda</button></div>` : '';
  }
  function vResumen() {
    const mesK = hoy().slice(0, 7);
    const h = suma(f => f === hoy()), m = suma(f => f.startsWith(mesK)), g = suma(() => true);
    const sinCosto = prods().filter(p => p.activo !== false && !(p.costo > 0));
    return `<div class="tarjetas">${tarjeta('Hoy', h)}${tarjeta('Este mes', m)}${tarjeta('Total acumulado', g, true)}</div>
      <p class="nota">Ganancia = ventas − costo de lo vendido − mermas (productos vencidos, dañados o faltantes) ± descuadres del cierre de caja. Las compras <b>no</b> restan de la ganancia: son inventario, y su costo se descuenta cuando el producto se vende. Los obsequios cuentan como gasto pastoral, no como pérdida. Invertido = total de las compras de reposición registradas. Gasto pastoral = aportes registrados en la pestaña Pastoral. Utilidad disponible = ganancia acumulada − gasto pastoral acumulado.</p>
      ${sinCosto.length ? `<div class="alerta-caja">⚠ ${sinCosto.length} producto${sinCosto.length === 1 ? '' : 's'} sin costo: la ganancia se ve más alta de lo real hasta completarlos.
        <button class="btn btn-sec btn-peq" data-accion="a:tab" data-tab="productos">Completar costos</button></div>` : ''}
      ${avisoSurtir()}
      <h3>Urgente comprar</h3>${listaUrgente()}
      <div class="barra" style="margin-top:14px"><button class="btn btn-prim" data-accion="a:compra">Registrar compra</button>
      <button class="btn btn-sec" data-accion="a:tab" data-tab="inventario">Ver inventario</button></div>`;
  }

  /* ---------- CALENDARIO ---------- */
  function vCalendario() {
    const { y, m } = cal, mesK = y + '-' + U.pad(m + 1);
    const dias = new Date(y, m + 1, 0).getDate(), off = (new Date(y, m, 1).getDay() + 6) % 7;
    const tot = suma(f => f.startsWith(mesK)), extra = porDia(mesK);
    let nombreMes = new Date(y, m, 1).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }).replace(' de ', ' ');
    nombreMes = nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1);
    let celdas = '';
    for (let i = 0; i < off; i++) celdas += '<div class="dia vacio-d"></div>';
    for (let d = 1; d <= dias; d++) {
      const f = mesK + '-' + U.pad(d), r = S.resumen[f], x = extra[f] || {};
      celdas += `<button class="dia ${f === hoy() ? 'hoy' : ''} ${f === calDia ? 'sel' : ''}" data-accion="a:dia" data-dia="${f}"><span class="n">${d}</span>
        ${r ? `<span class="v">${U.corto(r.ventas)}</span><span class="g ${gan(r) < 0 ? 'neg' : ''}">${U.corto(gan(r))}</span>` : ''}
        ${x.compras ? `<span class="c">−${U.corto(x.compras)}</span>` : ''}${x.pastoral ? `<span class="p">♥ ${U.corto(x.pastoral)}</span>` : ''}${r && r.caja < 0 ? `<span class="f">⚠ ${U.corto(r.caja)}</span>` : ''}</button>`;
    }
    return `<div class="cal-enc"><button class="btn btn-sec btn-peq" data-accion="a:calMes" data-d="-1">◀</button><h2>${esc(nombreMes)}</h2>
      <button class="btn btn-sec btn-peq" data-accion="a:calMes" data-d="1">▶</button></div>
      <p class="nota" style="margin-top:0">Mes: <b>${money(tot.ventas)}</b> en ventas · ganancia <b style="color:var(--ok)">${money(tot.ganancia)}</b> · ${tot.nVentas} venta${tot.nVentas === 1 ? '' : 's'} · compras <b style="color:var(--warn)">${money(tot.invertido)}</b> · pastoral <b style="color:var(--pastoral)">${money(tot.pastoral)}</b></p>
      <div class="cal-sem">${['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(d => `<div>${d}</div>`).join('')}</div>
      <div class="cal">${celdas}</div>
      <p class="leyenda"><span class="v">$ azul</span> = ventas · <span class="g">$ verde</span> = ganancia · <span class="c">−$ naranja</span> = compras de reposición · <span class="p">♥ $ morado</span> = gasto pastoral · <span class="f">⚠ rojo</span> = faltante en el cierre de caja. Toque un día para ver el detalle.</p>
      <div id="dia-detalle" class="panel"></div>`;
  }
  async function cargarDia() {
    const f = calDia;
    pintarDia(true);
    try {
      const v = await DB.query('ventas', { orderBy: 'fecha', equalTo: f });
      if (f !== calDia || tab !== 'calendario') return;
      diaVentas = Object.entries(v || {}).map(([id, x]) => Object.assign({ id }, x)).sort((a, b) => a.ts - b.ts);
      pintarDia(false);
    } catch (e) { console.error(e); const d = $('#dia-detalle'); if (d) d.innerHTML = '<p class="nota">No se pudieron cargar las ventas del día.</p>'; }
  }
  function pintarDia(cargando) {
    const d = $('#dia-detalle'); if (!d) return;
    const r = S.resumen[calDia] || {};
    let cuerpo;
    if (cargando && !diaVentas) cuerpo = '<p class="nota">Cargando…</p>';
    else if (!diaVentas || !diaVentas.length) cuerpo = '<p class="nota">No hubo ventas este día.</p>';
    else cuerpo = `<div style="overflow:auto"><table class="tabla"><thead><tr><th>Hora</th><th>Quién</th><th>Productos</th><th class="num">Total</th><th class="num">Ganancia</th><th></th></tr></thead><tbody>
      ${diaVentas.map(v => {
        const items = U.arr(v.items).map(i => (i.cantidad > 1 ? i.cantidad + '× ' : '') + esc(i.nombre)).join(', ');
        const an = v.estado === 'anulada';
        return `<tr class="${an ? 'anulada' : ''}"><td>${U.horaStr(v.ts)}</td><td>${esc(v.nombre)} <small class="gris">#${esc(v.codigo)}</small></td><td>${items}</td>
          <td class="num">${money(v.total)}</td><td class="num">${money(v.ganancia)}</td>
          <td class="acc">${an ? `<span class="etq mal">Anulada</span>` : `<button class="btn btn-sec btn-peq" data-accion="a:anular" data-id="${v.id}">Anular</button>`}</td></tr>`;
      }).join('')}</tbody></table></div>`;
    const compD = Object.values(repos).filter(c => c && c.fecha === calDia).sort((a, b) => a.ts - b.ts);
    const pastD = pastoralesActivos().filter(g => g.fecha === calDia).sort((a, b) => a.ts - b.ts);
    const tC = compD.reduce((a, c) => a + (c.total || 0), 0), tP = pastD.reduce((a, g) => a + (g.monto || 0), 0);
    const extraHtml = (compD.length ? `<h4 class="sub-h">Compras de reposición · <span style="color:var(--warn)">${money(tC)}</span></h4>
      <div style="overflow:auto"><table class="tabla"><tbody>${compD.map(c => `<tr><td>${U.horaStr(c.ts)}</td><td>${U.arr(c.items).map(i => i.cantidad + '× ' + esc(i.nombre)).join(', ')}${c.nota ? ` <small class="gris">· ${esc(c.nota)}</small>` : ''}</td>
        <td>${c.deCaja !== false ? '<span class="etq gris">De la caja</span>' : ''}</td><td class="num">${money(c.total)}</td></tr>`).join('')}</tbody></table></div>` : '')
      + (pastD.length ? `<h4 class="sub-h">Gastos pastorales · <span style="color:var(--pastoral)">${money(tP)}</span></h4>
      <div style="overflow:auto"><table class="tabla"><tbody>${pastD.map(g => `<tr><td>${esc(g.concepto)}${g.nota ? ` <small class="gris">· ${esc(g.nota)}</small>` : ''}</td>
        <td>${g.deCaja !== false ? '<span class="etq gris">De la caja</span>' : ''}</td><td class="num">${money(g.monto)}</td></tr>`).join('')}</tbody></table></div>` : '');
    d.innerHTML = `<h3 style="margin-top:0">${U.fechaLarga(calDia)}</h3>
      <p class="nota" style="margin-top:0">Ventas <b>${money(r.ventas)}</b> · Costo ${money(r.costo)} · Mermas ${money(r.mermas)} · Ganancia <b style="color:var(--ok)">${money(gan(r))}</b> · ${r.nVentas || 0} venta${r.nVentas === 1 ? '' : 's'}
        · Compras <b style="color:var(--warn)">${money(tC)}</b> · Pastoral <b style="color:var(--pastoral)">${money(tP)}</b>${r.caja ? ` · ${r.caja < 0 ? 'Faltante' : 'Sobrante'} de caja <b style="color:var(${r.caja < 0 ? '--mal' : '--ok'})">${money(Math.abs(r.caja))}</b>` : ''}</p>${cuerpo}${extraHtml}`;
  }
  function modalAnular(id) {
    const v = (diaVentas || []).find(x => x.id === id); if (!v) return;
    anularId = id;
    const items = U.arr(v.items).map(i => i.cantidad + '× ' + esc(i.nombre)).join(', ');
    Modal.abrir(`<h2>Anular venta</h2><p class="sub">${U.horaStr(v.ts)} · ${esc(v.nombre)} · <b>${money(v.total)}</b><br>${items}</p>
      <p class="nota">La venta queda marcada como anulada y los productos regresan al inventario. Si ya recibió el dinero, devuélvalo.</p>
      <div class="form"><label>Motivo<input id="an-motivo" value="Error en el registro" autofocus></label></div>
      <div id="m-err" class="error-msg"></div>
      <div class="acciones"><button class="btn btn-sec" data-accion="cerrar">No anular</button><button class="btn btn-mal" data-accion="a:anularOk">Sí, anular venta</button></div>`, { ancho: 480 });
  }
  async function anularOk() {
    const motivo = $('#an-motivo').value.trim() || 'Sin motivo';
    try {
      const v = await DB.get('ventas/' + anularId);
      if (!v || v.estado !== 'activa') { toast('Esa venta ya estaba anulada.', 'warn'); Modal.cerrar(); cargarDia(); return; }
      const upd = {};
      upd['ventas/' + anularId + '/estado'] = 'anulada';
      upd['ventas/' + anularId + '/anuladaTs'] = Date.now();
      upd['ventas/' + anularId + '/motivo'] = motivo;
      U.arr(v.items).forEach(i => { if (S.productos[i.id]) upd['productos/' + i.id + '/stock'] = DB.inc(i.cantidad); });
      upd['resumen/dias/' + v.fecha + '/ventas'] = DB.inc(-v.total);
      upd['resumen/dias/' + v.fecha + '/costo'] = DB.inc(-(v.costo || 0));
      upd['resumen/dias/' + v.fecha + '/nVentas'] = DB.inc(-1);
      await DB.update(upd);
      Modal.cerrar(); toast('Venta anulada y stock devuelto.', 'ok'); cargarDia();
    } catch (e) { errMsg(e); }
  }

  /* ---------- INVENTARIO ---------- */
  function vInventario() {
    let filas = '', catAct = null;
    prods().forEach(p => {
      if (p.categoria !== catAct) { catAct = p.categoria; filas += `<tr class="cat-fila"><td colspan="7">${esc(CATN[catAct] || catAct)}</td></tr>`; }
      const st = p.stock || 0, tot = totalInv(p), sug = sugerido(p);
      const estado = p.activo === false ? '<span class="etq gris">No visible</span>' : tot <= 0 ? '<span class="etq mal">Agotado</span>'
        : tot <= (p.minimo || 0) ? '<span class="etq warn">Comprar</span>' : sug > 0 ? `<span class="etq info">Surtir ${sug}</span>` : st <= 0 ? '<span class="etq warn">Tienda vacía</span>' : '<span class="etq ok">OK</span>';
      filas += `<tr class="${p.activo === false ? 'inactivo' : ''}"><td>${esc(p.nombre)}</td>
        <td class="num"><b>${st}</b></td>
        <td class="num"><input class="mini-in inp-surt" inputmode="numeric" data-id="${p.id}" value="${p.surtido || ''}" placeholder="—" aria-label="Cantidad fija en tienda de ${esc(p.nombre)}"></td>
        <td class="num"><b>${p.bodega || 0}</b></td><td class="num">${tot}</td>
        <td class="num"><input class="mini-in inp-min" inputmode="numeric" data-id="${p.id}" value="${p.minimo || 0}" aria-label="Mínimo de ${esc(p.nombre)}"></td>
        <td>${estado}</td></tr>`;
    });
    return `<div class="barra"><button class="btn btn-prim" data-accion="a:surtir">📦 Surtir tienda desde bodega</button>
      <button class="btn btn-sec" data-accion="a:compra">➕ Registrar compra</button>
      <button class="btn btn-sec" data-accion="a:merma">Registrar merma / ajuste</button></div>
      ${avisoSurtir()}
      <h3 style="margin-top:6px">🚨 Urgente comprar</h3>${listaUrgente()}
      <h3>Todo el inventario</h3>
      <p class="nota" style="margin-top:0"><b>En tienda</b>: lo que está a la vista y se vende. <b>Bodega</b>: lo guardado. <b>Fija en tienda</b>: cuántas unidades quiere tener siempre en la tienda; “Surtir tienda” completa esa cantidad desde la bodega. <b>Mínimo</b>: cuando el total (tienda + bodega) llegue a ese número, aparece en “Urgente comprar”.</p>
      <div style="overflow:auto" id="tabla-inv"><table class="tabla"><thead><tr><th>Producto</th><th class="num">En tienda</th><th class="num">Fija en tienda</th><th class="num">Bodega</th><th class="num">Total</th><th class="num">Mínimo</th><th>Estado</th></tr></thead><tbody>${filas || '<tr><td colspan="7">Sin productos.</td></tr>'}</tbody></table></div>
      <h3>Bajas registradas</h3>
      <p class="nota" style="margin-top:0">Si una baja fue en realidad un obsequio (por ejemplo, detalles para los jóvenes que colaboran), use “Fue un obsequio”: deja de ser pérdida y pasa a gasto pastoral.</p>
      ${listaBajas()}`;
  }
  /* ---------- SURTIR TIENDA (bodega → tienda) ---------- */
  function modalSurtir() {
    const lista = prods().filter(p => p.activo !== false);
    const filas = lista.map(p => { const sug = sugerido(p);
      return `<tr class="fila-surtir ${sug ? 'con-sug' : ''}" data-pid="${p.id}" data-n="${esc(String(p.nombre).toLowerCase())}">
      <td>${esc(p.nombre)}<br><small class="gris">${esc(CATN[p.categoria] || '')}</small></td>
      <td class="num">${p.stock || 0}${p.surtido > 0 ? `<small class="gris"> / ${p.surtido}</small>` : ''}</td><td class="num">${p.bodega || 0}</td>
      <td><input class="mini-in q" inputmode="numeric" value="${sug || ''}" placeholder="0"></td></tr>`; }).join('');
    const n = porSurtir().length;
    Modal.abrir(`<h2>Surtir tienda desde la bodega</h2>
      <p class="nota" style="margin-top:0">${n ? `Se sugieren las unidades que faltan para volver a la <b>cantidad fija en tienda</b> (${n} producto${n === 1 ? '' : 's'}). Puede cambiarlas.` : 'Ningún producto necesita surtido según su cantidad fija en tienda. Puede escribir cantidades a mano.'}
      Las unidades salen de la bodega y quedan disponibles para la venta.</p>
      <input id="buscar-surtir" class="buscar" placeholder="Buscar producto…">
      <div class="scroll-modal"><table class="tabla"><thead><tr><th>Producto</th><th class="num">Tienda / fija</th><th class="num">Bodega</th><th>Pasar a tienda</th></tr></thead><tbody>${filas || '<tr><td colspan="4">Sin productos.</td></tr>'}</tbody></table></div>
      <div id="m-err" class="error-msg"></div>
      <div class="acciones"><button class="btn btn-sec" data-accion="cerrar">Cancelar</button><button class="btn btn-prim" data-accion="a:surtirOk">Surtir tienda</button></div>`, { ancho: 680 });
  }
  async function surtirOk() {
    const items = [], err = $('#m-err');
    for (const tr of $$('.fila-surtir')) {
      const q = P($('.q', tr).value), p = S.productos[tr.dataset.pid];
      if (!p || !(q > 0)) continue;
      if (q > (p.bodega || 0)) { err.textContent = 'En la bodega solo hay ' + (p.bodega || 0) + ' de "' + p.nombre + '".'; return; }
      items.push({ id: tr.dataset.pid, nombre: p.nombre, cantidad: q });
    }
    if (!items.length) { err.textContent = 'Escriba la cantidad de al menos un producto.'; return; }
    const upd = {}, key = DB.newKey('traslados');
    upd['traslados/' + key] = { ts: Date.now(), fecha: hoy(), items };
    items.forEach(i => { upd['productos/' + i.id + '/stock'] = DB.inc(i.cantidad); upd['productos/' + i.id + '/bodega'] = DB.inc(-i.cantidad); });
    const n = items.reduce((a, i) => a + i.cantidad, 0);
    try { await DB.update(upd); Modal.cerrar(); toast('Tienda surtida: ' + n + ' unidad' + (n === 1 ? '' : 'es') + ' de ' + items.length + ' producto' + (items.length === 1 ? '' : 's') + '.', 'ok'); } catch (e) { errMsg(e); }
  }
  function modalCompra() {
    const filas = prods().map(p => `<tr class="fila-compra" data-pid="${p.id}" data-n="${esc(String(p.nombre).toLowerCase())}">
      <td>${esc(p.nombre)}<br><small class="gris">${esc(CATN[p.categoria] || '')}</small></td><td class="num">${p.stock || 0}</td><td class="num">${p.bodega || 0}</td>
      <td><input class="mini-in q" inputmode="numeric" placeholder="0"></td>
      <td><input class="mini-in cu" style="width:96px" inputmode="numeric" value="${p.costo > 0 ? p.costo : ''}" placeholder="costo"></td></tr>`).join('');
    Modal.abrir(`<h2>Registrar compra (reposición)</h2>
      <p class="nota" style="margin-top:0">Escriba la cantidad comprada y lo que costó <b>cada unidad</b>. Las unidades se suman al lugar elegido y el costo del producto queda actualizado.</p>
      <div class="seg-dest" role="radiogroup" aria-label="Dónde se guarda la compra">
        <label><input type="radio" name="c-dest" value="bodega" checked><span>Guardar en bodega</span></label>
        <label><input type="radio" name="c-dest" value="tienda"><span>Directo a la tienda</span></label></div>
      <input id="buscar-compra" class="buscar" placeholder="Buscar producto…">
      <div class="scroll-modal"><table class="tabla"><thead><tr><th>Producto</th><th class="num">Tienda</th><th class="num">Bodega</th><th>Cantidad</th><th>Costo unit.</th></tr></thead><tbody>${filas}</tbody></table></div>
      <div class="form" style="margin-top:10px"><label class="chk"><input type="checkbox" id="c-caja" checked> Pagué con dinero de la caja</label>
      <label>Nota (opcional)<input id="c-nota" placeholder="Ej: compra en la plaza"></label></div>
      <div id="m-err" class="error-msg"></div>
      <div class="acciones"><button class="btn btn-sec" data-accion="cerrar">Cancelar</button><button class="btn btn-prim" data-accion="a:compraOk">Guardar compra</button></div>`, { ancho: 760 });
  }
  async function compraOk() {
    const items = [], err = $('#m-err');
    for (const tr of $$('.fila-compra')) {
      const q = P($('.q', tr).value), c = P($('.cu', tr).value), p = S.productos[tr.dataset.pid];
      if (q > 0) {
        if (!(c > 0)) { err.textContent = 'Falta el costo de "' + p.nombre + '".'; return; }
        items.push({ id: tr.dataset.pid, nombre: p.nombre, cantidad: q, costo: c });
      }
    }
    if (!items.length) { err.textContent = 'Escriba la cantidad de al menos un producto.'; return; }
    const total = items.reduce((a, i) => a + i.cantidad * i.costo, 0), ts = Date.now(), key = DB.newKey('reposiciones');
    const destino = ($('input[name="c-dest"]:checked') || {}).value === 'tienda' ? 'tienda' : 'bodega', campo = destino === 'tienda' ? 'stock' : 'bodega';
    const upd = {};
    upd['reposiciones/' + key] = { ts, fecha: hoy(), items, total, destino, deCaja: $('#c-caja').checked, nota: $('#c-nota').value.trim() };
    items.forEach(i => { upd['productos/' + i.id + '/' + campo] = DB.inc(i.cantidad); upd['productos/' + i.id + '/costo'] = i.costo; });
    try { await DB.update(upd); Modal.cerrar(); toast('Compra registrada: ' + money(total), 'ok'); } catch (e) { errMsg(e); }
  }
  function modalMerma() {
    Modal.abrir(`<h2>Merma o ajuste de inventario</h2>
      <p class="nota" style="margin-top:0">Use esto para productos vencidos, dañados, faltantes en un conteo, un sobrante encontrado, o productos entregados como obsequio. Las pérdidas descuentan de la ganancia; los obsequios se registran como gasto pastoral (a su costo).</p>
      <div class="form"><label>Producto<select id="mm-prod">${prods().map(p => `<option value="${p.id}">${esc(p.nombre)} (tienda ${p.stock || 0} · bodega ${p.bodega || 0})</option>`).join('')}</select></label>
      <label>Dónde<select id="mm-lugar"><option value="tienda">En la tienda</option><option value="bodega">En la bodega</option></select></label>
      <div class="fila2"><label>Cantidad<input id="mm-cant" inputmode="numeric" placeholder="0"></label>
      <label>Motivo<select id="mm-tipo"><option value="obsequio">Obsequio / entrega pastoral (no es pérdida)</option><option value="vencido">Vencido</option><option value="dañado">Dañado</option><option value="faltante">Faltante en conteo</option><option value="sobrante">Sobrante (suma al inventario)</option></select></label></div>
      <label>Nota (opcional)<input id="mm-nota" placeholder="Ej: detalle para los jóvenes que ayudaron a organizar"></label></div>
      <div id="m-err" class="error-msg"></div>
      <div class="acciones"><button class="btn btn-sec" data-accion="cerrar">Cancelar</button><button class="btn btn-prim" data-accion="a:mermaOk">Guardar</button></div>`, { ancho: 520 });
    const sel = $('#mm-tipo'); if (sel) sel.value = 'vencido';
  }
  async function mermaOk() {
    const id = $('#mm-prod').value, q = P($('#mm-cant').value), tipo = $('#mm-tipo').value, p = S.productos[id], err = $('#m-err');
    if (!p || !(q > 0)) { err.textContent = 'Escriba una cantidad mayor a 0.'; return; }
    const suma = tipo === 'sobrante', lugar = $('#mm-lugar').value === 'bodega' ? 'bodega' : 'tienda', campo = lugar === 'bodega' ? 'bodega' : 'stock', hay = p[campo] || 0;
    if (!suma && q > hay) { err.textContent = 'La cantidad es mayor a lo que hay en la ' + lugar + ' (' + hay + ').'; return; }
    const obsequio = tipo === 'obsequio', valor = suma ? 0 : q * (p.costo || 0), perdida = obsequio ? 0 : valor, fecha = hoy(), key = DB.newKey('mermas');
    const nota = $('#mm-nota').value.trim(), upd = {};
    upd['mermas/' + key] = { ts: Date.now(), fecha, id, nombre: p.nombre, cantidad: q, tipo, lugar, costoTotal: perdida, valor, nota };
    upd['productos/' + id + '/' + campo] = DB.inc(suma ? q : -q);
    if (perdida > 0) upd['resumen/dias/' + fecha + '/mermas'] = DB.inc(perdida);
    if (obsequio) Object.assign(upd, obsequioPastoral(key, { fecha, cantidad: q, nombre: p.nombre, valor, nota }));
    try { await DB.update(upd); Modal.cerrar(); toast(suma ? 'Sobrante sumado al stock.' : obsequio ? 'Obsequio registrado como gasto pastoral (' + money(valor) + ').' : 'Merma registrada.', 'ok'); } catch (e) { errMsg(e); }
  }
  /* Un obsequio sale del inventario y se registra como gasto pastoral a su costo (no sale dinero de la caja) */
  function obsequioPastoral(mermaId, m) {
    const k = DB.newKey('pastoral');
    return { ['pastoral/' + k]: { ts: Date.now(), fecha: m.fecha, monto: m.valor, concepto: 'Obsequio: ' + m.cantidad + '× ' + m.nombre,
      nota: m.nota || '', deCaja: false, origen: 'inventario', mermaId, estado: 'activo' } };
  }
  /* Bajas de inventario registradas (para revisar y reclasificar como obsequio) */
  const TIPOS_MERMA = { vencido: 'Vencido', 'dañado': 'Dañado', faltante: 'Faltante en conteo', sobrante: 'Sobrante', obsequio: 'Obsequio' };
  function listaBajas() {
    const ls = Object.entries(mermas).map(([k, m]) => Object.assign({}, m, { mid: k })).filter(m => m && m.fecha).sort((a, b) => b.ts - a.ts).slice(0, 40);
    if (!ls.length) return '<p class="nota">Aún no hay bajas registradas.</p>';
    return `<div style="overflow:auto"><table class="tabla"><thead><tr><th>Fecha</th><th>Producto</th><th class="num">Cant.</th><th>Motivo</th><th class="num">Pérdida</th><th></th></tr></thead><tbody>
      ${ls.map(m => { const perd = m.tipo !== 'sobrante' && m.tipo !== 'obsequio' && m.costoTotal > 0;
        return `<tr><td>${esc(m.fecha)}</td><td>${esc(m.nombre)}${m.lugar ? ` <small class="gris">· ${esc(m.lugar)}</small>` : ''}${m.nota ? `<br><small class="gris">${esc(m.nota)}</small>` : ''}</td>
        <td class="num">${m.cantidad}</td><td>${m.tipo === 'obsequio' ? '<span class="etq past">Obsequio</span>' : esc(TIPOS_MERMA[m.tipo] || m.tipo)}</td>
        <td class="num">${perd ? money(m.costoTotal) : '—'}</td>
        <td class="acc">${perd ? `<button class="btn btn-sec btn-peq" data-accion="a:aObsequio" data-id="${m.mid}">Fue un obsequio</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>`;
  }
  function modalAObsequio(id) {
    const m = mermas[id]; if (!m) return; editId = id;
    Modal.abrir(`<h2>Cambiar a obsequio</h2><p class="sub">${esc(m.fecha)} · ${m.cantidad}× ${esc(m.nombre)} · ${money(m.costoTotal)}</p>
      <p class="nota">Esta baja deja de contar como pérdida (vuelve a la ganancia de ese día) y queda registrada como <b>gasto pastoral</b> por ${money(m.costoTotal)}, sin afectar la caja.</p>
      <div class="form"><label>Nota (opcional)<input id="ob-nota" value="${esc(m.nota || '')}" placeholder="Ej: detalle para los jóvenes"></label></div>
      <div class="acciones"><button class="btn btn-sec" data-accion="cerrar">Cancelar</button><button class="btn btn-prim" data-accion="a:aObsequioOk">Sí, fue un obsequio</button></div>`, { ancho: 480 });
  }
  async function aObsequioOk() {
    const id = editId, m = mermas[id]; if (!m || m.tipo === 'obsequio') { Modal.cerrar(); return; }
    const nota = $('#ob-nota').value.trim(), valor = m.costoTotal || 0, upd = {};
    upd['mermas/' + id + '/tipo'] = 'obsequio'; upd['mermas/' + id + '/tipoOriginal'] = m.tipo;
    upd['mermas/' + id + '/costoTotal'] = 0; upd['mermas/' + id + '/valor'] = valor; upd['mermas/' + id + '/nota'] = nota;
    if (valor > 0) upd['resumen/dias/' + m.fecha + '/mermas'] = DB.inc(-valor);
    Object.assign(upd, obsequioPastoral(id, { fecha: m.fecha, cantidad: m.cantidad, nombre: m.nombre, valor, nota }));
    try { await DB.update(upd); Modal.cerrar(); toast('Cambiado a obsequio: ' + money(valor) + ' pasan a gasto pastoral.', 'ok'); } catch (e) { errMsg(e); }
  }

  /* ---------- PRODUCTOS ---------- */
  function vProductos() {
    let filas = '', catAct = null;
    prods().forEach(p => {
      if (p.categoria !== catAct) { catAct = p.categoria; filas += `<tr class="cat-fila"><td colspan="7">${esc(CATN[catAct] || catAct)}</td></tr>`; }
      const marg = (p.precio || 0) - (p.costo || 0);
      filas += `<tr class="${p.activo === false ? 'inactivo' : ''}" data-n="${esc(String(p.nombre).toLowerCase())}">
        <td><span class="p-celda">${U.img(p.imagen) ? `<img class="p-mini" src="${esc(p.imagen)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="p-mini p-mini-vacia"></span>'}<span>${esc(p.nombre)} ${p.activo === false ? '<span class="etq gris">No visible</span>' : ''}</span></span></td>
        <td class="num">${money(p.precio)}</td>
        <td class="num">${p.costo > 0 ? money(p.costo) : '<span class="etq warn">Sin costo</span>'}</td>
        <td class="num">${p.costo > 0 ? money(marg) : '—'}</td><td class="num">${p.stock || 0}</td><td class="num">${p.bodega || 0}</td>
        <td class="acc"><button class="btn btn-sec btn-peq" data-accion="a:editProd" data-id="${p.id}">Editar</button>
        <button class="btn btn-sec btn-peq" data-accion="a:delProd" data-id="${p.id}">🗑</button></td></tr>`;
    });
    return `<div class="barra"><button class="btn btn-prim" data-accion="a:nuevoProd">➕ Nuevo producto</button>
      <input id="buscar-prod" class="buscar" style="max-width:280px;margin:0" placeholder="Buscar…"><span class="espacio"></span></div>
      ${!prods().length ? `<div class="alerta-caja">Aún no hay productos. <button class="btn btn-prim btn-peq" data-accion="a:seed">Cargar los productos iniciales</button></div>` : ''}
      <div style="overflow:auto"><table class="tabla"><thead><tr><th>Producto</th><th class="num">Precio</th><th class="num">Costo</th><th class="num">Ganancia unid.</th><th class="num">Tienda</th><th class="num">Bodega</th><th></th></tr></thead><tbody>${filas}</tbody></table></div>`;
  }
  function modalProducto(id) {
    editId = id || null;
    const nuevo = !id, p = id ? S.productos[id] : { nombre: '', categoria: 'bebidas', precio: '', costo: '', stock: 0, bodega: 0, surtido: '', minimo: 5, activo: true };
    if (!p) return;
    Modal.abrir(`<h2>${nuevo ? 'Nuevo producto' : 'Editar producto'}</h2><div class="form">
      <label>Nombre<input id="f-nombre" value="${esc(p.nombre)}" autofocus></label>
      <div class="f-imagen"><span class="f-prev" id="f-prev">${U.img(p.imagen) ? `<img src="${esc(p.imagen)}" alt="" referrerpolicy="no-referrer">` : ''}</span>
      <label>Imagen (enlace, opcional)<input id="f-img" type="url" inputmode="url" placeholder="https://…/foto.jpg" value="${esc(p.imagen || '')}"></label></div>
      <label>Categoría<select id="f-cat">${ORDEN.map(c => `<option value="${c}" ${p.categoria === c ? 'selected' : ''}>${CATN[c]}</option>`).join('')}</select></label>
      <div class="fila2"><label>Precio de venta<input id="f-precio" inputmode="numeric" value="${p.precio === '' ? '' : (p.precio || 0)}"></label>
      <label>Costo (lo que cuesta)<input id="f-costo" inputmode="numeric" value="${p.costo === '' ? '' : (p.costo || 0)}"></label></div>
      <div class="fila2">${nuevo ? `<label>Cantidad inicial en tienda<input id="f-stock" inputmode="numeric" value="0"></label><label>Cantidad inicial en bodega<input id="f-bodega" inputmode="numeric" value="0"></label>`
        : `<label>En tienda<input value="${p.stock || 0}" disabled></label><label>En bodega<input value="${p.bodega || 0}" disabled></label>`}</div>
      <div class="fila2"><label>Cantidad fija en tienda<input id="f-surt" inputmode="numeric" value="${p.surtido || ''}" placeholder="Ej: 10"></label>
      <label>Mínimo total (avisar compra)<input id="f-min" inputmode="numeric" value="${p.minimo == null ? 5 : p.minimo}"></label></div>
      <label class="chk"><input type="checkbox" id="f-activo" ${p.activo !== false ? 'checked' : ''}> Visible en la tienda</label></div>
      ${nuevo ? '' : '<p class="nota">Las cantidades cambian con “Registrar compra”, “Surtir tienda” o “Merma / ajuste” para que todo quede registrado.</p>'}
      <div id="m-err" class="error-msg"></div>
      <div class="acciones"><button class="btn btn-sec" data-accion="cerrar">Cancelar</button><button class="btn btn-prim" data-accion="a:guardarProd">Guardar</button></div>`, { ancho: 520 });
  }
  async function guardarProd() {
    const nombre = $('#f-nombre').value.trim(), err = $('#m-err');
    if (!nombre) { err.textContent = 'Escriba el nombre del producto.'; return; }
    const dup = Object.entries(S.productos).some(([id, p]) => id !== editId && String(p.nombre).trim().toLowerCase() === nombre.toLowerCase());
    if (dup) { err.textContent = 'Ya existe un producto con ese nombre.'; return; }
    const imagen = $('#f-img').value.trim();
    if (imagen && !U.img(imagen)) { err.textContent = 'El enlace de la imagen debe empezar por https:// o http://'; return; }
    const d = { nombre, imagen: imagen || null, categoria: $('#f-cat').value, precio: P($('#f-precio').value), costo: P($('#f-costo').value), minimo: P($('#f-min').value), surtido: P($('#f-surt').value), activo: $('#f-activo').checked };
    try {
      const upd = {};
      if (!editId) { const k = DB.newKey('productos'); upd['productos/' + k] = Object.assign({}, d, { stock: P($('#f-stock').value), bodega: P($('#f-bodega').value) }); }
      else Object.entries(d).forEach(([k, v]) => { upd['productos/' + editId + '/' + k] = v; });
      await DB.update(upd); Modal.cerrar(); toast('Producto guardado.', 'ok');
    } catch (e) { errMsg(e); }
  }
  function modalEliminarProd(id) {
    const p = S.productos[id]; if (!p) return; editId = id;
    Modal.abrir(`<h2>Eliminar producto</h2><p class="sub">¿Eliminar <b>${esc(p.nombre)}</b>? Las ventas anteriores se conservan. Si solo quiere ocultarlo de la tienda, use “Editar” y quite la marca “Visible”.</p>
      <div class="acciones"><button class="btn btn-sec" data-accion="cerrar">Cancelar</button><button class="btn btn-mal" data-accion="a:delProdOk">Sí, eliminar</button></div>`, { ancho: 460 });
  }

  /* ---------- TRABAJADORES ---------- */
  function vTrabajadores() {
    const lista = Object.entries(S.trabajadores).map(([c, t]) => Object.assign({ codigo: c }, t)).sort((a, b) => a.codigo.localeCompare(b.codigo));
    return `<div class="barra"><button class="btn btn-prim" data-accion="a:nuevoTrab">➕ Nuevo trabajador</button><span class="espacio"></span><span class="nota">${lista.length} registrados</span></div>
      <div style="overflow:auto"><table class="tabla"><thead><tr><th>Código</th><th>Nombre</th><th>Tipo</th><th></th></tr></thead><tbody>
      ${lista.map(t => `<tr class="${t.activo === false ? 'inactivo' : ''}"><td><b>${esc(t.codigo)}</b></td><td>${esc(t.nombre)}</td>
        <td>${t.tipo === 'visita' ? '<span class="etq gris">Visita</span>' : 'Trabajador'}${t.activo === false ? ' <span class="etq warn">Inactivo</span>' : ''}</td>
        <td class="acc"><button class="btn btn-sec btn-peq" data-accion="a:editTrab" data-id="${t.codigo}">Editar</button>
        <button class="btn btn-sec btn-peq" data-accion="a:delTrab" data-id="${t.codigo}">🗑</button></td></tr>`).join('') || '<tr><td colspan="4">Aún no hay trabajadores.</td></tr>'}</tbody></table></div>
      <p class="nota">Cada persona digita su código de 3 dígitos en la tienda. La pantalla le muestra su nombre para confirmar.</p>`;
  }
  function modalTrab(codigo) {
    editId = codigo || null;
    let t = codigo ? S.trabajadores[codigo] : null;
    if (!codigo) { const al = aliasCodigos(); let n = 1; while (S.trabajadores[String(n).padStart(3, '0')] || al[String(n).padStart(3, '0')]) n++; t = { nombre: '', tipo: 'trabajador', activo: true, _c: String(n).padStart(3, '0') }; }
    Modal.abrir(`<h2>${codigo ? 'Editar' : 'Nuevo'} trabajador</h2><div class="form">
      <div class="fila2"><label>Código (3 dígitos)<input id="t-cod" inputmode="numeric" maxlength="3" value="${codigo || t._c}"></label>
      <label>Tipo<select id="t-tipo"><option value="trabajador" ${t.tipo !== 'visita' ? 'selected' : ''}>Trabajador</option><option value="visita" ${t.tipo === 'visita' ? 'selected' : ''}>Visita</option></select></label></div>
      <label>Nombre<input id="t-nom" value="${esc(t.nombre)}" autofocus></label>
      <label class="chk"><input type="checkbox" id="t-act" ${t.activo !== false ? 'checked' : ''}> Activo</label></div>
      ${codigo ? '<p class="nota">Para cambiar el código, escriba el nuevo. Desde ese momento la persona debe usar el código nuevo; el anterior deja de funcionar. Su historial de compras se conserva.</p>' : ''}
      <div id="m-err" class="error-msg"></div>
      <div class="acciones"><button class="btn btn-sec" data-accion="cerrar">Cancelar</button><button class="btn btn-prim" data-accion="a:guardarTrab">Guardar</button></div>`, { ancho: 460 });
  }
  async function guardarTrab() {
    const cod = $('#t-cod').value.trim(), nom = $('#t-nom').value.trim(), err = $('#m-err');
    if (!/^\d{3}$/.test(cod)) { err.textContent = 'El código debe tener exactamente 3 dígitos.'; return; }
    if (!nom) { err.textContent = 'Escriba el nombre.'; return; }
    const cambia = !editId || cod !== editId;
    try {
      if (cambia) {
        const ya = await DB.get('trabajadores/' + cod); if (ya) { err.textContent = 'Ese código ya está en uso por ' + (ya.nombre || 'otra persona') + '.'; return; }
        const dueño = aliasCodigos()[cod];
        if (dueño && dueño !== editId) { err.textContent = 'Ese código lo usó antes ' + ((S.trabajadores[dueño] || {}).nombre || 'otra persona') + '. Elija otro para no mezclar historiales.'; return; }
      }
      const previo = editId ? (S.trabajadores[editId] || {}) : {};
      const datos = { nombre: nom, tipo: $('#t-tipo').value, activo: $('#t-act').checked };
      let anteriores = U.arr(previo.anteriores);
      if (editId && cambia) anteriores = anteriores.filter(c => c !== cod).concat([editId]);
      if (anteriores.length) datos.anteriores = anteriores;
      const upd = { ['trabajadores/' + cod]: datos };
      if (editId && cambia) upd['trabajadores/' + editId] = null;
      await DB.update(upd);
      if (editId && cambia) delete S.trabajadores[editId];
      S.trabajadores[cod] = datos;
      Modal.cerrar(); toast(editId && cambia ? 'Código cambiado: ahora es ' + cod + '.' : 'Guardado.', 'ok'); render();
    } catch (e) { errMsg(e); }
  }
  /* Códigos anteriores → código actual (para no partir el historial cuando se cambia el código) */
  function aliasCodigos() {
    const al = {};
    Object.entries(S.trabajadores).forEach(([c, t]) => U.arr(t && t.anteriores).forEach(a => { if (!S.trabajadores[a]) al[a] = c; }));
    return al;
  }

  /* ---------- CONSUMO POR TRABAJADOR (reporte mensual) ---------- */
  const mesClave = () => rep.y + '-' + U.pad(rep.m + 1);
  function nombreMesRep() {
    const t = new Date(rep.y, rep.m, 1).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }).replace(' de ', ' ');
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  /* Categoría de un ítem vendido: la guardada en la venta o, para ventas anteriores, la del producto actual */
  const catItem = i => i.categoria || (S.productos[i.id] || {}).categoria || 'otros';
  const catNombre = c => CATN[c] || 'Otros';
  function agruparConsumo(ventas) {
    const personas = {}, al = aliasCodigos();
    ventas.forEach(v => {
      const k = al[v.codigo] || v.codigo || '?', actual = S.trabajadores[k];
      const p = personas[k] || (personas[k] = { codigo: k, nombre: v.nombre, tipo: v.tipo, total: 0, nCompras: 0, cats: {}, productos: {} });
      p.nombre = (actual && actual.nombre) || v.nombre || p.nombre; p.nCompras++;
      U.arr(v.items).forEach(i => {
        const c = catItem(i), sub = (i.precio || 0) * (i.cantidad || 0);
        p.cats[c] = (p.cats[c] || 0) + sub; p.total += sub;
        const pr = p.productos[i.id || i.nombre] || (p.productos[i.id || i.nombre] = { nombre: i.nombre, categoria: c, cantidad: 0, total: 0 });
        pr.cantidad += i.cantidad || 0; pr.total += sub;
      });
    });
    return Object.values(personas).sort((a, b) => b.total - a.total);
  }
  function vConsumo() {
    return `<div class="cal-enc"><button class="btn btn-sec btn-peq" data-accion="a:repMes" data-d="-1" aria-label="Mes anterior">◀</button><h2>${esc(nombreMesRep())}</h2>
      <button class="btn btn-sec btn-peq" data-accion="a:repMes" data-d="1" aria-label="Mes siguiente">▶</button></div>
      <p class="nota" style="margin-top:0">Cuánto compró cada persona en el mes, por categoría. Toque un nombre para ver el detalle, imprimirlo o compartirlo.</p>
      <div id="rep-cont">${repDatos && repDatos.mes === mesClave() ? tablaConsumo() : '<p class="nota">Cargando…</p>'}</div>`;
  }
  async function cargarConsumo() {
    const mes = mesClave();
    try {
      const v = await DB.query('ventas', { orderBy: 'fecha', startAt: mes + '-01', endAt: mes + '-31' });
      if (mes !== mesClave() || tab !== 'consumo') return;
      const ventas = Object.values(v || {}).filter(x => x && x.estado === 'activa' && String(x.fecha).startsWith(mes));
      repDatos = { mes, personas: agruparConsumo(ventas) };
      const c = $('#rep-cont'); if (c) c.innerHTML = tablaConsumo();
    } catch (e) { console.error(e); const c = $('#rep-cont'); if (c) c.innerHTML = '<p class="nota">No se pudieron cargar las ventas del mes.</p>'; }
  }
  function columnasCat() {
    const cols = ORDEN.slice();
    if (repDatos.personas.some(p => p.cats.otros)) cols.push('otros');
    return cols;
  }
  function tablaConsumo() {
    const ps = repDatos.personas;
    if (!ps.length) return '<div class="panel"><p class="nota" style="margin:0">No hubo compras en este mes.</p></div>';
    const cols = columnasCat(), tot = { total: 0, nCompras: 0, cats: {} };
    ps.forEach(p => { tot.total += p.total; tot.nCompras += p.nCompras; cols.forEach(c => { tot.cats[c] = (tot.cats[c] || 0) + (p.cats[c] || 0); }); });
    const celda = (n, t) => `<td class="num">${n ? money(n) : '<span class="gris">—</span>'}${n && t ? `<small class="pct">${Math.round(n * 100 / t)}%</small>` : ''}</td>`;
    return `<div class="tarjetas rep-tarjetas">
        <div class="tarjeta"><h4>Total del mes</h4><div class="t-venta">${money(tot.total)}</div><div class="det">${ps.length} persona${ps.length === 1 ? '' : 's'} · ${tot.nCompras} compra${tot.nCompras === 1 ? '' : 's'}</div></div>
        ${cols.map(c => `<div class="tarjeta"><h4>${esc(catNombre(c))}</h4><div class="t-venta t-cat">${money(tot.cats[c] || 0)}</div>
          <div class="det">${tot.total ? Math.round((tot.cats[c] || 0) * 100 / tot.total) : 0}% del total</div></div>`).join('')}
      </div>
      <div style="overflow:auto;margin-top:16px"><table class="tabla tabla-rep"><thead><tr><th>Persona</th>${cols.map(c => `<th class="num">${esc(catNombre(c))}</th>`).join('')}<th class="num">Total</th><th class="num">Compras</th></tr></thead><tbody>
      ${ps.map(p => `<tr class="fila-click" data-accion="a:repDetalle" data-id="${esc(p.codigo)}"><td><b>${esc(p.nombre)}</b> <small class="gris">#${esc(p.codigo)}</small>${p.tipo === 'visita' ? ' <span class="etq gris">Visita</span>' : ''}</td>
        ${cols.map(c => celda(p.cats[c], p.total)).join('')}<td class="num"><b>${money(p.total)}</b></td><td class="num">${p.nCompras}</td></tr>`).join('')}
      <tr class="cat-fila"><td>Total</td>${cols.map(c => `<td class="num">${money(tot.cats[c] || 0)}</td>`).join('')}<td class="num">${money(tot.total)}</td><td class="num">${tot.nCompras}</td></tr>
      </tbody></table></div>
      <div class="barra" style="margin-top:14px"><button class="btn btn-sec" data-accion="a:repCsv">⬇ Descargar el mes (Excel/CSV)</button></div>`;
  }
  function modalConsumo(codigo) {
    const p = repDatos && repDatos.personas.find(x => x.codigo === codigo); if (!p) return;
    repCodigo = codigo;
    const prods = Object.values(p.productos), cats = ORDEN.concat(prods.some(x => x.categoria === 'otros') ? ['otros'] : []).filter(c => p.cats[c]);
    const max = Math.max(1, ...cats.map(c => p.cats[c]));
    Modal.abrir(`<div class="rep-detalle"><p class="eyebrow">Consumo de ${esc(nombreMesRep())}</p><h2>${esc(p.nombre)}</h2>
      <div class="gran-total"><span>Total gastado en la tienda</span><strong>${money(p.total)}</strong><small class="gris">${p.nCompras} compra${p.nCompras === 1 ? '' : 's'} en el mes</small></div>
      <div class="barras-cat">${cats.map(c => `<div class="bc-fila"><span class="bc-nom">${esc(catNombre(c))}</span>
        <span class="bc-pista"><span class="bc-barra" style="width:${Math.max(3, Math.round(p.cats[c] * 100 / max))}%"></span></span>
        <b class="bc-val">${money(p.cats[c])}</b><small class="bc-pct">${Math.round(p.cats[c] * 100 / p.total)}%</small></div>`).join('')}</div>
      <div class="scroll-modal" style="margin-top:12px"><table class="tabla"><thead><tr><th>Producto</th><th class="num">Cant.</th><th class="num">Total</th></tr></thead><tbody>
      ${cats.map(c => `<tr class="cat-fila"><td colspan="3">${esc(catNombre(c))}</td></tr>` + prods.filter(x => x.categoria === c).sort((a, b) => b.total - a.total)
        .map(x => `<tr><td>${esc(x.nombre)}</td><td class="num">${x.cantidad}</td><td class="num">${money(x.total)}</td></tr>`).join('')).join('')}
      </tbody></table></div></div>
      <div class="acciones"><button class="btn btn-sec" data-accion="a:repCsvPersona">⬇ CSV</button><button class="btn btn-sec" data-accion="a:repImprimir">Imprimir</button>
      <button class="btn btn-prim" data-accion="cerrar">Listo</button></div>`, { ancho: 560 });
  }
  function csvConsumo(soloCodigo) {
    if (!repDatos) return;
    const cols = columnasCat();
    if (soloCodigo) {
      const p = repDatos.personas.find(x => x.codigo === soloCodigo); if (!p) return;
      const filas = [['Mes', 'Código', 'Nombre', 'Categoría', 'Producto', 'Cantidad', 'Total']];
      Object.values(p.productos).forEach(x => filas.push([repDatos.mes, p.codigo, p.nombre, catNombre(x.categoria), x.nombre, x.cantidad, x.total]));
      U.descargar('consumo-' + repDatos.mes + '-' + U.slug(p.nombre) + '.csv', csv(filas), 'text/csv;charset=utf-8');
      return;
    }
    const filas = [['Mes', 'Código', 'Nombre'].concat(cols.map(catNombre), ['Total', 'Compras'])];
    repDatos.personas.forEach(p => filas.push([repDatos.mes, p.codigo, p.nombre].concat(cols.map(c => p.cats[c] || 0), [p.total, p.nCompras])));
    U.descargar('consumo-' + repDatos.mes + '.csv', csv(filas), 'text/csv;charset=utf-8');
  }

  /* ---------- GASTOS PASTORALES ---------- */
  const mesPast = () => past.y + '-' + U.pad(past.m + 1);
  function vPastoral() {
    const mesK = hoy().slice(0, 7), h = suma(f => f === hoy()), m = suma(f => f.startsWith(mesK)), g = suma(() => true);
    const mk = mesPast(), lista = Object.entries(pastoral).map(([id, x]) => Object.assign({ id }, x)).filter(x => x && String(x.fecha).startsWith(mk))
      .sort((a, b) => (b.fecha.localeCompare(a.fecha)) || (b.ts - a.ts));
    const totMes = lista.filter(x => x.estado !== 'anulado').reduce((a, x) => a + (x.monto || 0), 0);
    let nombre = new Date(past.y, past.m, 1).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }).replace(' de ', ' ');
    nombre = nombre.charAt(0).toUpperCase() + nombre.slice(1);
    const t = (titulo, r) => `<div class="tarjeta"><h4>${titulo}</h4><div class="t-venta t-past">${money(r.pastoral)}</div>
      <div class="det">${r.nPastoral} gasto${r.nPastoral === 1 ? '' : 's'} pastoral${r.nPastoral === 1 ? '' : 'es'}</div></div>`;
    return `<div class="tarjetas">${t('Hoy', h)}${t('Este mes', m)}${t('Total acumulado', g)}
        <div class="tarjeta"><h4>Utilidad disponible</h4><div class="t-venta ${g.disponible < 0 ? 'neg' : ''}">${money(g.disponible)}</div>
        <div class="det">Ganancia ${money(g.ganancia)} − pastoral ${money(g.pastoral)}</div></div></div>
      <h3>Registrar gasto pastoral</h3>
      <div class="panel"><div class="form" style="margin-top:0">
        <div class="fila2"><label>Fecha<input id="gp-fecha" type="date" value="${hoy()}" max="${hoy()}"></label>
        <label>Valor<input id="gp-monto" inputmode="numeric" placeholder="$ 0"></label></div>
        <label>Concepto<input id="gp-concepto" placeholder="Ej: Refrigerio convivencia, ayuda a familia, material catequesis"></label>
        <label>Nota (opcional)<input id="gp-nota" placeholder="Quién lo recibió, detalle, etc."></label>
        <label class="chk"><input type="checkbox" id="gp-caja" checked> Pagado con dinero de la caja</label></div>
        <div id="gp-err" class="error-msg"></div>
        <div class="barra" style="margin:4px 0 0"><button class="btn btn-prim" data-accion="a:guardarPastoral">Registrar gasto</button></div>
        <p class="nota" style="margin-bottom:0">Si se pagó con dinero de la caja, el cierre semanal lo descuenta del efectivo esperado.</p></div>
      <div class="cal-enc" style="margin-top:26px"><button class="btn btn-sec btn-peq" data-accion="a:pastMes" data-d="-1" aria-label="Mes anterior">◀</button><h2>${esc(nombre)}</h2>
        <button class="btn btn-sec btn-peq" data-accion="a:pastMes" data-d="1" aria-label="Mes siguiente">▶</button></div>
      ${lista.length ? `<div style="overflow:auto"><table class="tabla"><thead><tr><th>Fecha</th><th>Concepto</th><th></th><th class="num">Valor</th><th></th></tr></thead><tbody>
        ${lista.map(x => { const an = x.estado === 'anulado'; return `<tr class="${an ? 'anulada' : ''}"><td>${esc(x.fecha)}</td><td>${esc(x.concepto)}${x.nota ? `<br><small class="gris">${esc(x.nota)}</small>` : ''}</td>
          <td>${x.origen === 'inventario' ? '<span class="etq past">Obsequio</span>' : x.deCaja !== false ? '<span class="etq gris">De la caja</span>' : ''}</td><td class="num">${money(x.monto)}</td>
          <td class="acc">${an ? '<span class="etq mal">Anulado</span>' : `<button class="btn btn-sec btn-peq" data-accion="a:anularPastoral" data-id="${x.id}">Anular</button>`}</td></tr>`; }).join('')}
        <tr class="cat-fila"><td colspan="3">Total del mes</td><td class="num">${money(totMes)}</td><td></td></tr></tbody></table></div>`
        : '<div class="panel"><p class="nota" style="margin:0">No hay gastos pastorales en este mes.</p></div>'}`;
  }
  async function guardarPastoral() {
    const err = $('#gp-err'), fecha = $('#gp-fecha').value, monto = P($('#gp-monto').value), concepto = $('#gp-concepto').value.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || fecha > hoy()) { err.textContent = 'Elija una fecha válida (hoy o anterior).'; return; }
    if (!(monto > 0)) { err.textContent = 'Escriba el valor del gasto.'; return; }
    if (!concepto) { err.textContent = 'Escriba el concepto del gasto.'; return; }
    const key = DB.newKey('pastoral');
    try {
      await DB.update({ ['pastoral/' + key]: { ts: Date.now(), fecha, monto, concepto, nota: $('#gp-nota').value.trim(), deCaja: $('#gp-caja').checked, estado: 'activo' } });
      toast('Gasto pastoral registrado: ' + money(monto), 'ok');
      past = { y: Number(fecha.slice(0, 4)), m: Number(fecha.slice(5, 7)) - 1 }; render();
    } catch (e) { errMsg(e); }
  }
  function modalAnularPastoral(id) {
    const g = pastoral[id]; if (!g) return; editId = id;
    Modal.abrir(`<h2>Anular gasto pastoral</h2><p class="sub">${esc(g.fecha)} · ${esc(g.concepto)} · <b>${money(g.monto)}</b></p>
      <p class="nota">El gasto queda marcado como anulado y deja de contar en el resumen, el calendario y el cierre.</p>
      <div class="acciones"><button class="btn btn-sec" data-accion="cerrar">No anular</button><button class="btn btn-mal" data-accion="a:anularPastoralOk">Sí, anular</button></div>`, { ancho: 460 });
  }

  /* ---------- CIERRE SEMANAL ---------- */
  function vCierre() {
    const mesK = hoy().slice(0, 7), dm = suma(f => f.startsWith(mesK)).caja, dt = suma(() => true).caja;
    return `<h2>Cierre de caja</h2>
      <p class="nota" style="margin-top:0">Hágalo cada vez que cuente y recoja el dinero (al final del día o de la semana). El periodo empieza donde terminó el cierre anterior. <b>La base de la caja no se cuenta</b>: cuente solo el dinero que corresponde a ventas.
        Si falta dinero, el faltante queda registrado y se descuenta de la ganancia de ese día; si sobra, se suma.</p>
      <div class="tarjetas" style="margin-bottom:14px"><div class="tarjeta"><h4>Descuadre del mes</h4><div class="t-venta ${dm < 0 ? 'neg' : ''}">${dm > 0 ? '+' : ''}${money(dm)}</div><div class="det">${dm < 0 ? 'Faltante' : dm > 0 ? 'Sobrante' : 'Cuadra'}</div></div>
        <div class="tarjeta"><h4>Descuadre acumulado</h4><div class="t-venta ${dt < 0 ? 'neg' : ''}">${dt > 0 ? '+' : ''}${money(dt)}</div><div class="det">${dt < 0 ? 'Faltante' : dt > 0 ? 'Sobrante' : 'Cuadra'}</div></div></div>
      <div class="panel"><div class="fila2" style="align-items:end"><label class="form-l">Periodo desde<input type="datetime-local" id="c-desde"></label>
      <div><button class="btn btn-sec" data-accion="a:calcCierre">Recalcular</button></div></div><div id="c-res" style="margin-top:14px"></div></div>
      <h3>Cierres anteriores</h3><div id="c-hist"></div>`;
  }
  async function iniciarCierre() {
    try {
      const cs = await DB.get('cierres');
      cierres = Object.entries(cs || {}).map(([id, c]) => Object.assign({ id }, c)).sort((a, b) => b.hastaTs - a.hastaTs);
    } catch (e) { cierres = []; }
    pintarHistorial();
    const ult = cierres.find(c => c.estado !== 'anulado');
    if (ult) desdeTs = ult.hastaTs + 1;
    else { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); d.setHours(0, 0, 0, 0); desdeTs = d.getTime(); }
    const inp = $('#c-desde'); if (inp) inp.value = U.aLocalInput(desdeTs);
    calcularCierre();
  }
  function pintarHistorial() {
    const h = $('#c-hist'); if (!h) return;
    h.innerHTML = cierres.length ? `<div style="overflow:auto"><table class="tabla"><thead><tr><th>Fecha</th><th class="num">Ventas</th><th class="num">Compras caja</th><th class="num">Pastoral</th><th class="num">Esperado</th><th class="num">Contado</th><th class="num">Diferencia</th><th></th></tr></thead><tbody>
      ${cierres.slice(0, 20).map(c => `<tr class="${c.estado === 'anulado' ? 'anulada' : ''}"><td>${U.fechaHoraStr(c.hastaTs)}${c.nota ? `<br><small class="gris">${esc(c.nota)}</small>` : ''}</td><td class="num">${money(c.ventas)}</td><td class="num">${money(c.compras)}</td><td class="num">${money(c.pastoral || 0)}</td><td class="num">${money(c.esperado)}</td><td class="num">${money(c.contado)}</td>
        <td class="num"><span class="etq ${c.diferencia === 0 ? 'ok' : c.diferencia > 0 ? 'warn' : 'mal'}">${c.diferencia === 0 ? 'Cuadra' : (c.diferencia > 0 ? 'Sobran ' : 'Faltan ') + money(Math.abs(c.diferencia))}</span></td>
        <td class="acc">${c.estado === 'anulado' ? '<span class="etq mal">Anulado</span>' : `<button class="btn btn-sec btn-peq" data-accion="a:anularCierre" data-id="${c.id}">Anular</button>`}</td></tr>`).join('')}</tbody></table></div>` : '<p class="nota">Aún no hay cierres.</p>';
  }
  async function calcularCierre() {
    const res = $('#c-res'); if (!res) return;
    res.innerHTML = '<p class="nota">Calculando…</p>';
    try {
      const hasta = Date.now();
      const [v, c] = await Promise.all([DB.query('ventas', { orderBy: 'ts', startAt: desdeTs }), DB.query('reposiciones', { orderBy: 'ts', startAt: desdeTs })]);
      const ventas = Object.values(v || {}).filter(x => x.estado === 'activa' && x.ts <= hasta);
      const compras = Object.values(c || {}).filter(x => x.deCaja !== false && x.ts <= hasta);
      const pasts = pastoralesActivos().filter(g => g.deCaja !== false && g.ts >= desdeTs && g.ts <= hasta);
      cierreCalc = { desde: desdeTs, hasta, ventas: ventas.reduce((a, x) => a + x.total, 0), nVentas: ventas.length, compras: compras.reduce((a, x) => a + x.total, 0), nCompras: compras.length,
        pastoral: pasts.reduce((a, g) => a + (g.monto || 0), 0), nPastoral: pasts.length };
      res.innerHTML = `<table class="tabla"><tbody>
        <tr><td>Ventas del periodo (${cierreCalc.nVentas} compras)</td><td class="num"><b>${money(cierreCalc.ventas)}</b></td></tr>
        <tr><td>− Compras de reposición pagadas de la caja (${cierreCalc.nCompras})</td><td class="num">${money(cierreCalc.compras)}</td></tr>
        <tr><td>− Gastos pastorales pagados de la caja (${cierreCalc.nPastoral})</td><td class="num">${money(cierreCalc.pastoral)}</td></tr>
        <tr><td>− Retiros u otros movimientos de la caja<br><small class="gris">Dinero sacado que no sea reposición ni gasto pastoral registrado</small></td><td class="num"><input id="c-retiros" class="mini-in" style="width:130px" inputmode="numeric" value="0"></td></tr>
        <tr class="cat-fila"><td>Efectivo esperado (sin la base)</td><td class="num" id="c-esp">${money(cierreCalc.ventas - cierreCalc.compras - cierreCalc.pastoral)}</td></tr>
        <tr><td>Efectivo contado (sin la base)</td><td class="num"><input id="c-contado" class="mini-in" style="width:130px" inputmode="numeric" placeholder="$"></td></tr>
        <tr><td><b>Diferencia</b></td><td class="num" id="c-dif">—</td></tr></tbody></table>
        <div class="form" style="margin-top:12px"><label>Nota (opcional)<input id="c-nota2" placeholder="Observaciones del cierre"></label></div>
        <div class="acciones"><button class="btn btn-prim" data-accion="a:guardarCierre">Guardar cierre</button></div>`;
    } catch (e) { console.error(e); res.innerHTML = '<p class="nota">No se pudo calcular el periodo.</p>'; }
  }
  function actualizarDif() {
    if (!cierreCalc || !$('#c-dif')) return;
    const ret = P($('#c-retiros').value), esp = cierreCalc.ventas - cierreCalc.compras - cierreCalc.pastoral - ret;
    $('#c-esp').textContent = money(esp);
    const v = $('#c-contado').value;
    if (v === '') { $('#c-dif').innerHTML = '—'; return; }
    const dif = P(v) - esp;
    $('#c-dif').innerHTML = `<span class="etq ${dif === 0 ? 'ok' : dif > 0 ? 'warn' : 'mal'}">${dif === 0 ? 'Cuadra ✓' : (dif > 0 ? 'Sobran ' : 'Faltan ') + money(Math.abs(dif))}</span>`;
  }
  async function guardarCierre() {
    if (!cierreCalc) return;
    if ($('#c-contado').value === '') { toast('Escriba el efectivo contado.', 'warn'); return; }
    const retiros = P($('#c-retiros').value), esperado = cierreCalc.ventas - cierreCalc.compras - cierreCalc.pastoral - retiros, contado = P($('#c-contado').value);
    const key = DB.newKey('cierres'), fecha = hoy(), diferencia = contado - esperado;
    const upd = { ['cierres/' + key]: { ts: Date.now(), fecha, desdeTs: cierreCalc.desde, hastaTs: cierreCalc.hasta, ventas: cierreCalc.ventas, nVentas: cierreCalc.nVentas,
      compras: cierreCalc.compras, pastoral: cierreCalc.pastoral, retiros, esperado, contado, diferencia, estado: 'activo', nota: $('#c-nota2').value.trim() } };
    /* El descuadre queda en el resumen del día: un faltante resta de la ganancia, un sobrante suma */
    if (diferencia !== 0) upd['resumen/dias/' + fecha + '/caja'] = DB.inc(diferencia);
    try {
      await DB.update(upd);
      toast(diferencia === 0 ? 'Cierre guardado: la caja cuadra.' : 'Cierre guardado. ' + (diferencia < 0 ? 'Faltante' : 'Sobrante') + ' de ' + money(Math.abs(diferencia)) + ' registrado.', diferencia < 0 ? 'warn' : 'ok');
      setTimeout(render, 150);
    } catch (e) { errMsg(e); }
  }
  function modalAnularCierre(id) {
    const c = cierres.find(x => x.id === id); if (!c) return; editId = id;
    Modal.abrir(`<h2>Anular cierre</h2><p class="sub">${U.fechaHoraStr(c.hastaTs)} · contado ${money(c.contado)} · ${c.diferencia === 0 ? 'cuadraba' : (c.diferencia < 0 ? 'faltante ' : 'sobrante ') + money(Math.abs(c.diferencia))}</p>
      <p class="nota">Úselo si se equivocó al escribir el conteo. El descuadre deja de contar en la ganancia y el próximo cierre volverá a incluir este periodo.</p>
      <div class="acciones"><button class="btn btn-sec" data-accion="cerrar">No anular</button><button class="btn btn-mal" data-accion="a:anularCierreOk">Sí, anular</button></div>`, { ancho: 460 });
  }
  async function anularCierreOk() {
    const c = cierres.find(x => x.id === editId); if (!c || c.estado === 'anulado') { Modal.cerrar(); return; }
    const upd = { ['cierres/' + c.id + '/estado']: 'anulado', ['cierres/' + c.id + '/anuladoTs']: Date.now() };
    if (c.diferencia) upd['resumen/dias/' + c.fecha + '/caja'] = DB.inc(-c.diferencia);
    try { await DB.update(upd); Modal.cerrar(); toast('Cierre anulado.', 'ok'); setTimeout(render, 150); } catch (e) { errMsg(e); }
  }

  /* ---------- RESPALDO ---------- */
  function vRespaldo() {
    return `<h2>Respaldo y mantenimiento</h2>
      <p class="nota" style="margin-top:0">Descargue una copia todos los viernes después del cierre. Guárdela en un lugar seguro (por ejemplo, su servidor).</p>
      <div class="panel"><div class="barra">
        <button class="btn btn-prim" data-accion="a:json">⬇ Copia completa (JSON)</button>
        <button class="btn btn-sec" data-accion="a:csvVentas">⬇ Ventas (Excel/CSV)</button>
        <button class="btn btn-sec" data-accion="a:csvInv">⬇ Inventario (Excel/CSV)</button></div>
      <p class="nota">La copia JSON se puede volver a cargar desde la consola de Firebase (Realtime Database → ⋮ → Importar JSON).</p></div>
      <h3>Mantenimiento</h3><div class="panel"><div class="barra">
        <button class="btn btn-sec" data-accion="a:recalcular">Recalcular resúmenes de ventas</button>
        ${!prods().length ? '<button class="btn btn-sec" data-accion="a:seed">Cargar productos iniciales</button>' : ''}
        ${DB.modo === 'demo' ? '<button class="btn btn-mal" data-accion="a:resetDemo">Borrar datos de la demostración</button>' : ''}</div>
      <p class="nota">“Recalcular” reconstruye los totales de hoy, mes y acumulado a partir de las ventas guardadas. Úselo solo si ve números que no cuadran.</p>
      <p class="nota">Base de datos en uso: <b>${DB.modo === 'demo' ? 'MODO DEMOSTRACIÓN (solo este navegador)' : 'Firebase Realtime Database'}</b></p></div>`;
  }
  const csvCelda = v => { v = String(v == null ? '' : v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const csv = filas => '﻿' + filas.map(f => f.map(csvCelda).join(';')).join('\r\n');
  async function csvVentas() {
    const v = await DB.get('ventas'), filas = [['Fecha', 'Hora', 'Código', 'Nombre', 'Producto', 'Cantidad', 'Precio', 'Costo', 'Subtotal', 'Estado', 'Motivo anulación']];
    Object.values(v || {}).sort((a, b) => a.ts - b.ts).forEach(x => U.arr(x.items).forEach(i =>
      filas.push([x.fecha, U.horaStr(x.ts), x.codigo, x.nombre, i.nombre, i.cantidad, i.precio, i.costo, i.precio * i.cantidad, x.estado, x.motivo || ''])));
    U.descargar('ventas-' + hoy() + '.csv', csv(filas), 'text/csv;charset=utf-8');
  }
  function csvInv() {
    const filas = [['Categoría', 'Producto', 'Precio', 'Costo', 'En tienda', 'Fija en tienda', 'Bodega', 'Total', 'Mínimo', 'Visible']];
    prods().forEach(p => filas.push([CATN[p.categoria] || p.categoria, p.nombre, p.precio || 0, p.costo || 0, p.stock || 0, p.surtido || 0, p.bodega || 0, totalInv(p), p.minimo || 0, p.activo === false ? 'No' : 'Sí']));
    U.descargar('inventario-' + hoy() + '.csv', csv(filas), 'text/csv;charset=utf-8');
  }
  async function json() {
    const [pr, tr, ve, re, me, ci, pa, tl] = await Promise.all(['productos', 'trabajadores', 'ventas', 'reposiciones', 'mermas', 'cierres', 'pastoral', 'traslados'].map(p => DB.get(p)));
    const todo = { productos: pr, trabajadores: tr, ventas: ve, reposiciones: re, mermas: me, cierres: ci, pastoral: pa, traslados: tl };
    U.descargar('copia-tienda-san-jose-' + hoy() + '.json', JSON.stringify(todo, null, 1), 'application/json');
  }
  async function recalcular() {
    if (!confirm('¿Reconstruir los totales a partir de las ventas guardadas?')) return;
    try {
      const [v, m, cs] = await Promise.all([DB.get('ventas'), DB.get('mermas'), DB.get('cierres')]), dias = {};
      const d = f => dias[f] || (dias[f] = { ventas: 0, costo: 0, nVentas: 0, mermas: 0 });
      Object.values(cs || {}).forEach(c => { if (c && c.estado !== 'anulado' && c.diferencia && c.fecha) d(c.fecha).caja = (d(c.fecha).caja || 0) + c.diferencia; });
      Object.values(v || {}).filter(x => x.estado === 'activa').forEach(x => { const r = d(x.fecha); r.ventas += x.total; r.costo += x.costo || 0; r.nVentas += 1; });
      Object.values(m || {}).forEach(x => { if (x.costoTotal > 0 && x.tipo !== 'obsequio') d(x.fecha).mermas += x.costoTotal; });
      await DB.update({ 'resumen/dias': Object.keys(dias).length ? dias : null });
      toast('Resúmenes recalculados.', 'ok');
    } catch (e) { errMsg(e); }
  }
  async function seed() {
    if (prods().length && !confirm('Ya hay productos. ¿Cargar la lista inicial de todas formas?')) return;
    const upd = {};
    window.TSJ_SEED.forEach(([categoria, nombre, stock, precio]) => {
      upd['productos/' + U.slug(nombre)] = { nombre, categoria, precio, costo: 0, stock, bodega: 0, minimo: 5, activo: precio > 0 };
    });
    if (!S.trabajadores['000']) upd['trabajadores/000'] = { nombre: 'Visita', tipo: 'visita', activo: true };
    try { await DB.update(upd); S.trabajadores['000'] = S.trabajadores['000'] || { nombre: 'Visita', tipo: 'visita', activo: true }; toast('Productos iniciales cargados. Complete los costos.', 'ok'); render(); } catch (e) { errMsg(e); }
  }

  /* ---------- Acciones ---------- */
  function accion(a, el) {
    switch (a) {
      case 'salir': App.irTienda(); break;
      case 'tab': tab = el.dataset.tab; render(); break;
      case 'calMes': { const d = Number(el.dataset.d); cal.m += d; if (cal.m < 0) { cal.m = 11; cal.y--; } if (cal.m > 11) { cal.m = 0; cal.y++; } render(); break; }
      case 'dia': calDia = el.dataset.dia; diaVentas = null; $$('.dia.sel').forEach(x => x.classList.remove('sel')); el.classList.add('sel'); cargarDia(); break;
      case 'anular': modalAnular(el.dataset.id); break;
      case 'anularOk': anularOk(); break;
      case 'compra': modalCompra(); break;
      case 'surtir': modalSurtir(); break;
      case 'surtirOk': surtirOk(); break;
      case 'compraOk': compraOk(); break;
      case 'merma': modalMerma(); break;
      case 'mermaOk': mermaOk(); break;
      case 'nuevoProd': modalProducto(null); break;
      case 'editProd': modalProducto(el.dataset.id); break;
      case 'guardarProd': guardarProd(); break;
      case 'delProd': modalEliminarProd(el.dataset.id); break;
      case 'delProdOk': DB.update({ ['productos/' + editId]: null }).then(() => { Modal.cerrar(); toast('Producto eliminado.', 'ok'); }).catch(errMsg); break;
      case 'nuevoTrab': modalTrab(null); break;
      case 'editTrab': modalTrab(el.dataset.id); break;
      case 'guardarTrab': guardarTrab(); break;
      case 'delTrab': if (confirm('¿Eliminar a ' + (S.trabajadores[el.dataset.id] || {}).nombre + '? Sus ventas anteriores se conservan.')) DB.update({ ['trabajadores/' + el.dataset.id]: null }).then(() => { delete S.trabajadores[el.dataset.id]; render(); }).catch(errMsg); break;
      case 'repMes': { rep.m += Number(el.dataset.d); if (rep.m < 0) { rep.m = 11; rep.y--; } if (rep.m > 11) { rep.m = 0; rep.y++; } render(); break; }
      case 'repDetalle': modalConsumo(el.dataset.id); break;
      case 'repCsv': csvConsumo(); break;
      case 'repCsvPersona': csvConsumo(repCodigo); break;
      case 'repImprimir': window.print(); break;
      case 'guardarPastoral': guardarPastoral(); break;
      case 'anularPastoral': modalAnularPastoral(el.dataset.id); break;
      case 'anularPastoralOk': DB.update({ ['pastoral/' + editId + '/estado']: 'anulado', ['pastoral/' + editId + '/anuladoTs']: Date.now() })
        .then(() => { Modal.cerrar(); toast('Gasto pastoral anulado.', 'ok'); render(); }).catch(errMsg); break;
      case 'pastMes': { past.m += Number(el.dataset.d); if (past.m < 0) { past.m = 11; past.y--; } if (past.m > 11) { past.m = 0; past.y++; } render(); break; }
      case 'calcCierre': calcularCierre(); break;
      case 'guardarCierre': guardarCierre(); break;
      case 'anularCierre': modalAnularCierre(el.dataset.id); break;
      case 'anularCierreOk': anularCierreOk(); break;
      case 'aObsequio': modalAObsequio(el.dataset.id); break;
      case 'aObsequioOk': aObsequioOk(); break;
      case 'json': json().catch(errMsg); break;
      case 'csvVentas': csvVentas().catch(errMsg); break;
      case 'csvInv': csvInv(); break;
      case 'recalcular': recalcular(); break;
      case 'seed': seed(); break;
      case 'resetDemo': if (confirm('¿Borrar todos los datos de la demostración?')) { DB.reiniciarDemo(); S.trabajadores = {}; toast('Datos borrados.'); render(); } break;
    }
  }

  /* Eventos de formularios dentro del panel */
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.classList && t.classList.contains('inp-surt')) {
      DB.update({ ['productos/' + t.dataset.id + '/surtido']: P(t.value) || null }).then(() => toast('Cantidad fija en tienda actualizada.', 'ok')).catch(errMsg);
    } else if (t.classList && t.classList.contains('inp-min')) {
      DB.update({ ['productos/' + t.dataset.id + '/minimo']: P(t.value) }).then(() => toast('Mínimo actualizado.', 'ok')).catch(errMsg);
    } else if (t.id === 'c-desde') { const ms = new Date(t.value).getTime(); if (!isNaN(ms)) { desdeTs = ms; calcularCierre(); } }
  });
  document.addEventListener('input', e => {
    const t = e.target;
    if (t.id === 'c-retiros' || t.id === 'c-contado') actualizarDif();
    else if (t.id === 'f-img') { const v = t.value.trim(), pv = $('#f-prev'); if (pv) pv.innerHTML = U.img(v) ? `<img src="${esc(v)}" alt="" referrerpolicy="no-referrer">` : ''; }
    else if (t.id === 'buscar-prod') { const q = t.value.toLowerCase(); $$('#admin-contenido tbody tr[data-n]').forEach(tr => { tr.hidden = !tr.dataset.n.includes(q); }); }
    else if (t.id === 'buscar-surtir') { const q = t.value.toLowerCase(); $$('.fila-surtir').forEach(tr => { tr.hidden = !tr.dataset.n.includes(q); }); }
    else if (t.id === 'buscar-compra') { const q = t.value.toLowerCase(); $$('.fila-compra').forEach(tr => { tr.hidden = !tr.dataset.n.includes(q); }); }
  });

  window.Admin = { entrar, salir, refrescar, accion };
})();
