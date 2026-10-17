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