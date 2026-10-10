/* Utilidades generales */
(function () {
  'use strict';
  const fmtCOP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

  const U = {
    money(n) { return fmtCOP.format(Math.round(Number(n) || 0)).replace(/ /g, ' '); },
    corto(n) {
      n = Math.round(Number(n) || 0);
      const s = n < 0 ? '-' : '', a = Math.abs(n);
      if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(1).replace('.', ',') + 'M';
      if (a >= 1000) return s + '$' + (a / 1000).toFixed(a < 10000 ? 1 : 0).replace('.', ',') + 'k';
      return s + '$' + a;
    },
    esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },
    pad(n) { return String(n).padStart(2, '0'); },
    fechaStr(d) {
      d = d || new Date();
      return d.getFullYear() + '-' + U.pad(d.getMonth() + 1) + '-' + U.pad(d.getDate());
    },
    horaStr(ts) { const d = new Date(ts); return U.pad(d.getHours()) + ':' + U.pad(d.getMinutes()); },
    fechaHoraStr(ts) { return U.fechaStr(new Date(ts)) + ' ' + U.horaStr(ts); },
    aLocalInput(ts) { const d = new Date(ts); return U.fechaStr(d) + 'T' + U.horaStr(ts); },
    fechaLarga(str) {
      const [y, m, d] = str.split('-').map(Number);
      const t = new Date(y, m - 1, d).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      return t.charAt(0).toUpperCase() + t.slice(1);
    },
    /* Convierte lo que escriba la persona ("2.156", "$ 2 156") en un entero de pesos/unidades */
    parse(s) { const d = String(s == null ? '' : s).replace(/\D/g, ''); return d ? parseInt(d, 10) : 0; },
    arr(x) { if (!x) return []; return (Array.isArray(x) ? x : Object.values(x)).filter(Boolean); },
    slug(s) {
      return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    },
    async sha256(texto) {
      if (!(window.crypto && crypto.subtle)) throw new Error('Abra la app desde https:// (GitHub Pages) o desde localhost para poder verificar la clave.');
      const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
      return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
    },
    descargar(nombre, contenido, tipo) {
      const blob = new Blob([contenido], { type: tipo || 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = nombre;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    }
  };
  window.U = U;
})();
