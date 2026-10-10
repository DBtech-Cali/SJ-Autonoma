/* =====================================================================
   CONFIGURACIÓN DE TIENDA SAN JOSÉ
   Este es el único archivo que necesita editar para conectar la app.
   Mientras los datos de Firebase digan "PEGAR_AQUI" o "TU-PROYECTO",
   la app funciona en MODO DEMOSTRACIÓN (los datos quedan solo en el
   navegador de la tablet y sirven para probar).
   ===================================================================== */
window.TSJ_CONFIG = {
  nombreTienda: 'Tienda San José',

  // Pegue aquí los datos de su proyecto de Firebase (Configuración del proyecto > Tus apps > Web).
  // databaseURL se ve en Realtime Database (arriba de los datos).
  firebase: {
    apiKey: 'AIzaSyBBGIpDb5j5L0SlSvyAFTAmxqlWOIMNmO0',
    authDomain: 'storesj-34fcf.firebaseapp.com',
    databaseURL: 'https://storesj-34fcf-default-rtdb.firebaseio.com',
    projectId: 'storesj-34fcf',
    appId: '1:1059442165718:web:1c6c50f38ff917b1da4677'
  },

  // true  = la tablet inicia sesión anónima en Firebase (requiere activar "Anónimo" en Authentication)
  // false = no usa autenticación (las reglas de la base de datos deben permitir lectura y escritura abiertas)
  usarAuthAnonima: true,

  // Clave del administrador, guardada como código (SHA-256), no como texto.
  // Clave PROVISIONAL: tienda2026   -> cámbiela abriendo generar-clave.html
  claveAdminHash: '3e01f3708b4dda9da8b984bcd792618d6b81d88aa1182e3ba87212ada3e341c8',

  // Billetes que aparecen para calcular el cambio
  billetes: [2000, 5000, 10000, 20000, 50000],

  segundosInactividad: 60,   // vuelve a la pantalla principal si nadie toca la tablet
  segundosExito: 8,          // tiempo que se muestra "Compra registrada"
  minutosBloqueoAdmin: 5     // el panel de administrador se cierra solo tras estos minutos sin uso
};
