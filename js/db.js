/* Capa de datos.
   - Con Firebase configurado: usa Realtime Database (compat SDK cargado desde gstatic).
   - Sin configurar: MODO DEMO con los datos guardados en el navegador (localStorage).
   Toda la app usa solo este objeto DB, así que el resto del código no depende de Firebase. */
(function () {
  'use strict';
  const CFG = window.TSJ_CONFIG;
  const fbc = CFG.firebase || {};
  const configurado = !!(fbc.apiKey && fbc.databaseURL && !/TU-PROYECTO|PEGAR/i.test(fbc.apiKey + fbc.databaseURL));

  function cargarScript(src) {
    return new Promise((ok, mal) => {
      const s = document.createElement('script');
      s.src = src; s.onload = ok;
      s.onerror = () => mal(new Error('No se pudo cargar ' + src + '. Revise la conexión a internet.'));
      document.head.appendChild(s);
    });
  }

  /* ---------------- Firebase Realtime Database ---------------- */
  async function crearFirebase() {
    const base = 'https://www.gstatic.com/firebasejs/10.12.2/';
    await cargarScript(base + 'firebase-app-compat.js');
    await cargarScript(base + 'firebase-database-compat.js');
    if (CFG.usarAuthAnonima) await cargarScript(base + 'firebase-auth-compat.js');
    firebase.initializeApp(fbc);
    if (CFG.usarAuthAnonima) await firebase.auth().signInAnonymously();
    const database = firebase.database();
    return {
      listen(path, cb, errCb) {
        const ref = database.ref(path);
        const h = ref.on('value', s => cb(s.val()), e => { if (errCb) errCb(e); });
        return () => ref.off('value', h);
      },
      get(path) { return database.ref(path).once('value').then(s => s.val()); },
      query(path, o) {
        let q = database.ref(path);
        q = o.orderBy === '$key' ? q.orderByKey() : q.orderByChild(o.orderBy);
        if (o.equalTo !== undefined) q = q.equalTo(o.equalTo);
        else {
          if (o.startAt !== undefined) q = q.startAt(o.startAt);
          if (o.endAt !== undefined) q = q.endAt(o.endAt);
        }
        return q.once('value').then(s => s.val());
      },
      update(mapa) { return database.ref().update(mapa); },
      newKey(path) { return database.ref(path).push().key; },
      inc(n) { return firebase.database.ServerValue.increment(n); },
      onConexion(cb) { database.ref('.info/connected').on('value', s => cb(!!s.val())); }
    };
  }

  /* ---------------- Modo demostración (localStorage) ---------------- */
  function crearLocal() {
    const KEY = 'tsj_demo_db';
    let raiz = {};
    try { raiz = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { raiz = {}; }
    const oyentes = new Set();
    const clon = v => (v === undefined || v === null) ? null : JSON.parse(JSON.stringify(v));
    const partes = p => String(p).split('/').filter(Boolean);

    function leer(path) {
      let n = raiz;
      for (const k of partes(path)) {
        if (n == null || typeof n !== 'object') return null;
        n = n[k];
      }
      return n === undefined ? null : n;
    }
    function escribir(path, val) {
      const ps = partes(path);
      if (!ps.length) { raiz = clon(val) || {}; return; }
      let n = raiz; const pila = [];
      for (let i = 0; i < ps.length - 1; i++) {
        const k = ps[i];
        if (n[k] == null || typeof n[k] !== 'object') { if (val == null) return; n[k] = {}; }
        pila.push([n, k]); n = n[k];
      }
      const ult = ps[ps.length - 1];
      if (val == null) delete n[ult]; else n[ult] = clon(val);
      for (let i = pila.length - 1; i >= 0; i--) {
        const [p, k] = pila[i];
        if (p[k] && typeof p[k] === 'object' && Object.keys(p[k]).length === 0) delete p[k]; else break;
      }
    }
    function guardar() { try { localStorage.setItem(KEY, JSON.stringify(raiz)); } catch (e) { /* sin espacio */ } }
    function notificar() { oyentes.forEach(o => setTimeout(() => o.cb(clon(leer(o.path))), 0)); }

    return {
      listen(path, cb) {
        const o = { path, cb }; oyentes.add(o);
        setTimeout(() => cb(clon(leer(path))), 0);
        return () => oyentes.delete(o);
      },
      get(path) { return Promise.resolve(clon(leer(path))); },
      query(path, o) {
        const obj = leer(path) || {}; const res = {};
        for (const [k, v] of Object.entries(obj)) {
          const x = o.orderBy === '$key' ? k : (v && v[o.orderBy]);
          let ok;
          if (o.equalTo !== undefined) ok = x === o.equalTo;
          else ok = (o.startAt === undefined || x >= o.startAt) && (o.endAt === undefined || x <= o.endAt);
          if (ok && x !== undefined) res[k] = v;
        }
        return Promise.resolve(Object.keys(res).length ? clon(res) : null);
      },
      update(mapa) {
        for (const [path, val] of Object.entries(mapa)) {
          if (val && typeof val === 'object' && val.__inc !== undefined) escribir(path, (Number(leer(path)) || 0) + val.__inc);
          else escribir(path, val);
        }
        guardar(); notificar();
        return Promise.resolve();
      },
      newKey() { return 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); },
      inc(n) { return { __inc: n }; },
      onConexion(cb) { setTimeout(() => cb(true), 0); },
      reiniciarDemo() { raiz = {}; guardar(); notificar(); }
    };
  }

  const DB = window.DB = {
    modo: configurado ? 'firebase' : 'demo',
    async iniciar() {
      const impl = configurado ? await crearFirebase() : crearLocal();
      Object.assign(DB, impl);
    }
  };
})();
