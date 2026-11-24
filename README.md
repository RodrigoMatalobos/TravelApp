# TravelApp

## Estructura

- `frontend/`: aplicación web y PWA. Los itinerarios fuente están en `frontend/data/`; una cuenta administradora los usa para sincronizar Firestore automáticamente al iniciar sesión.
- `backend/`: reglas de seguridad de Firestore. Firebase Authentication y Firestore son servicios gestionados; este proyecto no ejecuta un servidor propio.
- `tool/`: generador de itinerarios y utilidades locales de edición/sincronización.
- Raíz: configuración de npm, Vite, Firebase CLI y GitHub Actions.

## Desarrollo

```bash
npm ci
npm run dev
npm test
npm run build
```

Vite usa `frontend/` como raíz y genera el sitio en `dist/`. Firebase CLI lee `firebase.json` en la raíz, que apunta a `backend/firestore.rules`.

Los itinerarios siguen el esquema de `tool/templates/country-template.json`. Una cuenta administradora carga los JSON versionados de `frontend/data/` y `map-locations.json` en Firestore solo cuando todavía no hay países cargados. Después de esa carga inicial, Firestore es la fuente principal y la app no vuelve a sobrescribir cambios hechos desde la interfaz con los JSON locales.

Los archivos de tickets se eligen desde la carpeta local `TravelApp` en el dispositivo de una cuenta administradora y se guardan en IndexedDB; no se suben a Firebase. Cada dispositivo administrador debe seleccionarla por separado. La estructura esperada es `TravelApp/<País>/<Ciudad>/<archivo>`.

## Cómo editar el viaje sin tocar código

Los JSON de `frontend/data/` sirven como semilla inicial y respaldo. Después de cargar el itinerario, una cuenta administradora puede agregar ciudades desde el itinerario del país, marcar sus coordenadas en el mapa y usar el menú hamburguesa de cada tarjeta de ciudad para editarla o eliminarla. Al eliminarla también se borran sus actividades y sus paradas vinculadas, y se reordenan las ciudades restantes. Las actividades y la gastronomía se administran con el botón de lápiz en sus secciones. En Actividades, cada persona puede guardar marcas locales de favorita o importante; las importantes se muestran como recordatorio en la portada desde el día programado hasta marcarlas como listas. Estas marcas no sincronizan entre dispositivos.

La portada muestra hora local y clima actual por país. Durante las fechas del itinerario usa la ciudad correspondiente; fuera de esas fechas muestra la primera ciudad. El clima se consulta en Open-Meteo al cargar por primera vez cada ubicación, se muestra desde la caché local antes de revalidar y se vuelve a consultar como máximo cada seis horas. Si no hay internet, se conserva el último resultado guardado.

Las cuentas administradoras pueden agregar, editar y quitar los banners de Spotify desde el botón **Editar banners de Spotify** en cada país.

Campos de cada país (`frontend/data/<pais>.json`):

- `playlists`: lista de playlists de Spotify `{ "nombre", "url" }`. Se pueden poner N; las que no tengan `url` se ignoran.
- `servicios`: enlaces útiles (consulados, farmacias, lavanderías, supermercados).
- `ciudades`: lista de ciudades en orden del viaje.

Campos de cada ciudad:

- `fechas`: texto libre, por ejemplo `"22/12/2026 – 25/12/2026"`.
- `hotel`, `mapaHotelLink`, `comoLlegar`: alojamiento y llegada.
- `transportes`: lista de `{ "tipo", "descripcion", "fecha", "salida", "llegada" }`. `tipo` puede ser `vuelo`, `tren`, `bus` o `ferry` (cambia el ícono). Si algo no está comprado todavía, escribí `"por confirmar"` en `salida`/`llegada`.
- `transportePublico`: texto con la guía de tarjetas/apps de la ciudad.
- `guardaequipaje`: texto con dónde dejar la valija en los días de traslado.
- `actividades` y `gastronomia`: listas de `{ "dia", "nombre", "mapa" }` (`dia` agrupa por día; `mapa` es el enlace de Google Maps, puede quedar vacío).

Las coordenadas y el orden del globo están en `frontend/data/map-locations.json`. Para verificar que las paradas coincidan con las ciudades: `node tool/sync-map-locations.js --check`.

## Rendimiento y offline

- Firestore usa caché persistente en el dispositivo: la app abre offline con los últimos datos.
- Además, los datos se descargan de Firebase una vez al día por dispositivo; navegar, volver atrás o reabrir pestañas usa la caché local sin nuevas descargas.
- Una vez al día se hace una comparación en segundo plano contra Firebase; si algo cambió, la pantalla se actualiza sola.
- El botón 🔄 “Actualizar datos” del menú ☰ fuerza la descarga en el momento.
- Clima y hora usan la última respuesta guardada localmente mientras se consulta el servicio, sin bloquear la portada; los intentos de actualización se limitan a uno cada seis horas por ubicación.
- La barra fina verde bajo el encabezado indica descargas reales en curso.