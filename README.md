# Compra en casa · Frontend

Interfaz en español para gestionar hogares, listas, compras y tickets desde móvil o escritorio. Angular se comunica con la [API Spring Boot].

## Arranque local

Usa una versión de Node compatible con el proyecto. La compilación se ha verificado con Node 24.15. Inicia el backend en el puerto 8002 y ejecuta desde este repositorio:

```sh
npm ci
npm start
```

Abre [Compra en casa](http://localhost:4200/). `npm start` carga [proxy.conf.json](proxy.conf.json), que reenvía las llamadas `/api/**` a `http://localhost:8002`. En un despliegue del build estático, el servidor que sirva Angular debe dirigir `/api` al backend. El proxy de desarrollo se aplica al arrancar con `npm start`.

## Dónde está el código

| Archivo | Responsabilidad |
| --- | --- |
| [main.ts](src/main.ts) | Arranque de Angular. |
| [app.ts](src/app/app.ts) | Componente raíz, tipos de datos, estado con signals, formularios, llamadas a la API y compresión de imágenes. |
| [app.html](src/app/app.html) | Inicio de sesión, hogares, listas y detalle del historial. |
| [app.css](src/app/app.css) y [styles.css](src/styles.css) | Estilos del componente y estilos globales. |
| [app.spec.ts](src/app/app.spec.ts) | Pruebas del componente raíz. |

El componente raíz concentra las pantallas. Los formularios usan `ngModel`. Los valores derivados, como el progreso de la lista y los precios que se muestran, se calculan con `computed`. El método `api()` usa `fetch` con rutas relativas y añade el token JWT guardado en `sessionStorage`. El método `run()` controla el estado de carga y muestra errores.

## Flujos de la interfaz

1. **Sesión y hogar.** Tras entrar, Angular carga los hogares del usuario, las listas y el catálogo. Para añadir a un familiar registrado, el propietario introduce el ID que ese familiar puede copiar desde **Mi cuenta**.
2. **Lista activa.** Al añadir un artículo, Angular busca el producto por nombre en el catálogo y lo crea si hace falta. El artículo guarda cantidad, unidad y nota. **Marcar todos como comprados** aplica el cambio a los pendientes de la lista activa. **Actualizar** vuelve a consultar la lista.
3. **Finalizar compra.** El historial recibe los artículos marcados. Los artículos pendientes siguen disponibles en la lista. Al abrir una compra se solicitan sus tickets y su comparación de precios.
4. **Adjuntar fotos.** **Tomar foto** solicita la cámara trasera en navegadores móviles compatibles. **Elegir archivos** permite seleccionar varias imágenes. Las dos acciones llaman a `uploadReceipts()`. El navegador prepara cada archivo con `compressReceipt()` antes de enviarlo en un `FormData` con el campo `file`.
5. **Revisar precios.** El detalle muestra las líneas leídas y sus importes directamente. **Revisar importes** permite corregirlos y vincular cada línea a un producto de esa compra. **Ver foto** descarga el comprobante aparte. Angular consulta periódicamente mientras hay tickets en cola o en análisis y deja de consultar al cerrar la compra.

La compresión limita el lado mayor a 4096 píxeles y prueba distintas calidades JPEG. Si el original está dentro de las dimensiones previstas y pesa menos que la versión generada, puede conservarse. El límite de subida es 5 MB por archivo. La clave de Gemini se configura en Spring Boot.

## Comprobaciones

```sh
npm run build
npm test -- --watch=false
```

Para comprobar el flujo completo, inicia sesión, crea un hogar y una lista, añade dos productos, marca uno y finaliza la compra. Comprueba que el otro siga pendiente. Abre la compra en el historial, adjunta un ticket JPEG o PNG, revisa los importes y confirma. Con dos compras del mismo producto, comprueba que la segunda muestra el precio anterior. Para probar la cámara, abre la app desde un móvil compatible.

Si la pantalla carga y las acciones fallan, comprueba que Spring Boot está en ejecución y que el puerto coincide con el de `proxy.conf.json`.

## Despliegue en Railway

El Dockerfile compila Angular con Node 24.15 y sirve el resultado con Caddy. Caddy escucha en PORT, conserva las rutas de Angular y reenvía /api al backend.

1. Crea o selecciona un servicio para el frontend en Railway. Conecta el repositorio Angular o vincula el servicio con railway link y ejecuta railway up desde esta carpeta.
2. En Variables del servicio, define BACKEND_URL con el origen de Spring Boot sin el sufijo /api. Si el backend vive en el mismo entorno de Railway, puedes usar http://backend.railway.internal:8002 sustituyendo el nombre y el puerto por los de tu servicio. Si está en otro alojamiento, usa su URL HTTPS.
3. En Settings → Networking, usa Generate Domain. Puedes definir /healthz como ruta de comprobación del servicio.
4. Abre el dominio generado y comprueba el inicio de sesión y la carga de listas. /healthz verifica Caddy. El inicio de sesión también verifica la conexión con Spring Boot.

Railway necesita un backend accesible desde el contenedor. El localhost de tu ordenador solo sirve para el desarrollo local.
