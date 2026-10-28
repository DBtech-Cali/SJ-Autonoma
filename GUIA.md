# Tienda San José — Guía de puesta en marcha

Aplicación web (HTML, CSS y JavaScript sin frameworks) para registrar ventas, inventario y ganancias de la tienda autónoma. Funciona con Firebase **Realtime Database** (plan gratuito) y se publica en GitHub Pages.

## 1. Probarla primero (sin Firebase)

Abra `index.html` (o publíquela). Mientras `js/config.js` tenga los datos de ejemplo, la app corre en **modo demostración**: los datos quedan solo en ese navegador. Sirve para ensayar todo el flujo.

- Clave de administrador provisional: **tienda2026** (cámbiela en el paso 5).
- Administrador → Productos → **Cargar los productos iniciales** (carga la tabla entregada y el código `000` de Visita).

## 2. Crear el proyecto en Firebase

1. En <https://console.firebase.google.com> cree un proyecto (se puede desactivar Google Analytics).
2. **Build → Realtime Database → Crear base de datos.** Elija la región y comience en *modo bloqueado*.
3. En la pestaña **Reglas**, pegue el contenido de `reglas-database.json` y publique.
4. **Build → Authentication → Comenzar → Método de acceso → Anónimo → Habilitar.**
   (Si prefiere no usar autenticación, ponga `usarAuthAnonima: false` en `config.js` y en las reglas cambie `"auth != null"` por `true`; es menos protegido.)
5. **Configuración del proyecto → Tus apps → Web (`</>`)** y registre una app. Copie los datos que muestra.

## 3. Conectar la app

Abra `js/config.js` y reemplace los valores de `firebase` (`apiKey`, `authDomain`, `databaseURL`, `projectId`, `appId`). El `databaseURL` está arriba de los datos en Realtime Database; si la región no es EE. UU. tiene la forma `https://NOMBRE-default-rtdb.REGION.firebasedatabase.app`.

> Cuando los datos sean reales, el aviso amarillo de “modo demostración” desaparece.

## 4. Publicar en GitHub Pages

1. Cree un repositorio y suba **todo el contenido de esta carpeta** (con `index.html` en la raíz).
2. Settings → Pages → Branch `main` / carpeta `/ (root)` → Save.
3. Abra la dirección `https://USUARIO.github.io/REPOSITORIO/` en la tablet.

Vercel no es necesario: la app es estática. Si más adelante quiere usarlo, basta con importar el mismo repositorio.

## 5. Cambiar la clave de administrador

Abra `generar-clave.html` (desde la dirección publicada o `localhost`), escriba la clave nueva, copie el código y péguelo en `js/config.js` en `claveAdminHash`. Vuelva a subir el archivo.

## 6. Primer día de uso

1. Administrador → **Productos → Cargar los productos iniciales** (si aún no se hizo).
2. Complete el **costo** de cada producto (sin costo la ganancia aparece inflada). El resumen avisa cuántos faltan.
3. En *Inventario*, para cada producto:
   - **Fija en tienda**: cuántas unidades quiere tener siempre a la vista (ej. 10 Coca-Colas).
   - **Mínimo**: cuando el total (tienda + bodega) llegue a ese número, aparece en “Urgente comprar”.
4. Cree los trabajadores en *Trabajadores* con su código de 3 dígitos. `000` queda para Visita.
5. Producto **Café**: quedó no visible porque la tabla traía precio 0. Edítelo con su precio para mostrarlo.

## Rutina diaria (al cerrar la jornada)

Administrador → Inventario → **Surtir tienda desde bodega**. La app sugiere cuántas unidades pasar para volver a la cantidad fija en tienda (si se vendieron 3, sugiere 3). Ponga esas unidades en la tienda y confirme.

## 7. Rutina semanal (viernes, al cerrar)

1. Administrador → **Cierre de caja** (se puede hacer cada noche o cada semana, cada vez que recoja el dinero): la app calcula lo que debería haber en efectivo (ventas − compras de reposición pagadas de la caja − gastos pastorales pagados de la caja − retiros). Cuente el dinero **sin la base** y escríbalo; la app muestra la diferencia. Guarde el cierre. Si falta dinero, el faltante queda registrado y se descuenta de la ganancia de ese día (si sobra, se suma). Si se equivocó al escribir el conteo, anule ese cierre y hágalo de nuevo.
2. Administrador → **Respaldo → Copia completa (JSON)** y guárdela en un lugar seguro.

## Cómo funciona (resumen)

- **Venta:** el trabajador elige productos → Pagar → digita su código de 3 dígitos → confirma su nombre → toca los billetes con los que paga, uno por cada billete (ej. 3 toques en $5.000 = $15.000; se muestra lo que falta o el cambio) → Confirmar. Se descuenta el stock y se registra costo, precio y ganancia **vigentes en ese momento** (si el precio cambia mañana, el historial no cambia).
- **Errores:** antes de confirmar, el trabajador quita productos del carrito. Después de confirmar, solo el administrador puede **anular** la venta (Calendario → día → Anular); el stock se devuelve y queda registrada como anulada.
- **Ganancia** = ventas − costo de lo vendido − mermas ± descuadres de caja. Las compras de reposición **no** restan de la ganancia: son inventario; su costo se descuenta cuando cada producto se vende.
- **Obsequios:** los productos entregados como detalle (por ejemplo, a los jóvenes que colaboran) se registran en Inventario → Merma / ajuste → motivo “Obsequio”. Salen del inventario y cuentan como **gasto pastoral** a su costo, no como pérdida. Una baja ya registrada se puede cambiar con “Fue un obsequio” en Inventario → Bajas registradas.
- **Gastos pastorales:** las utilidades de la tienda se destinan a la pastoral. Cada aporte se registra en Administración → **Pastoral** (fecha, valor, concepto y si salió de la caja). Aparece en el resumen (hoy, mes y acumulado), en el calendario y en el cierre semanal. **Utilidad disponible** = ganancia acumulada − gasto pastoral acumulado. Un gasto registrado por error se anula; no se borra.
- **Costo:** cada compra de reposición actualiza el costo del producto al último valor pagado.
- **Dos inventarios:** *En tienda* es lo que está a la vista y lo que descuentan las ventas (es el número que ven los compradores). *Bodega* es lo guardado. Las compras entran a la bodega (o directo a la tienda si se elige). “Surtir tienda” pasa unidades de la bodega a la tienda. Las mermas se registran en el lugar donde ocurrieron.
- **Cambiar el código de un trabajador:** Trabajadores → Editar → escriba el código nuevo. El anterior deja de funcionar y su historial de consumo se conserva.
- **Sin internet:** la tienda avisa y no deja registrar compras hasta que regrese la conexión (Realtime Database no guarda ventas pendientes de forma duradera en la web).
- **Inactividad:** a los 60 segundos sin tocar la tablet se limpia la compra; el panel de administrador se cierra a los 5 minutos sin uso. Los tiempos se cambian en `config.js`.

## Seguridad (lo que conviene saber)

- La clave está en la aplicación como código (hash); detiene el uso casual, pero una persona con conocimientos técnicos podría saltársela.
- La autenticación anónima evita escrituras automáticas o accidentales desde fuera, pero **no es un control de acceso fuerte**: la configuración de Firebase de una página web es pública. Por eso la copia semanal es la defensa real.
- Dejar la tablet en modo pantalla completa/quiosco (Chrome: menú → *Añadir a la pantalla de inicio*) evita que se navegue a otras páginas.
- Los códigos de 3 dígitos no son secretos: por eso la pantalla muestra el nombre para confirmar. No se guardan cédulas.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `index.html` | La aplicación |
| `css/styles.css` | Colores y diseño (variables de color al inicio, con modo claro y oscuro) |
| `js/config.js` | **Único archivo que debe editar**: Firebase, clave, billetes, tiempos |
| `js/db.js` | Conexión a Firebase (y modo demostración) |
| `js/store.js` | Pantalla de la tienda |
| `js/admin.js` | Panel del administrador |
| `js/seed.js` | Productos iniciales |
| `generar-clave.html` | Genera el código de una clave nueva |
| `reglas-database.json` | Reglas e índices para Realtime Database |
