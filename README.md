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

Los itinerarios siguen el esquema de `tool/templates/country-template.json`. Al abrir la app, una cuenta administradora compara los JSON versionados de `frontend/data/` y `map-locations.json` con Firestore; crea Alemania y cualquier país faltante, actualiza diferencias, elimina IDs heredados conocidos y sincroniza todas las paradas del globo sin mostrar un importador.

Los archivos de tickets se eligen desde la carpeta local `TravelApp` en el dispositivo de una cuenta administradora y se guardan en IndexedDB; no se suben a Firebase. Cada dispositivo administrador debe seleccionarla por separado. La estructura esperada es `TravelApp/<País>/<Ciudad>/<archivo>`.

## Cómo editar el viaje sin tocar código

Todo el contenido sale de los JSON de `frontend/data/`. Editás el archivo, subís el cambio y al abrir la app una cuenta administradora lo sincroniza solo con Firebase (escribe únicamente lo que cambió).

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
- La barra fina verde bajo el encabezado indica descargas reales en curso.