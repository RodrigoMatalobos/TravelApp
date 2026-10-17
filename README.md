# TravelApp

## Estructura

- `frontend/`: aplicación web y PWA. Los itinerarios locales están en `frontend/data/`; son archivos privados ignorados por Git y no se copian al build.
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

Los itinerarios siguen el esquema de `tool/templates/country-template.json`. Desde la app, una cuenta administradora puede seleccionar JSON de países y `map-locations.json`; los países existentes solo se actualizan después de confirmar, y se conservan los campos heredados de vouchers.

Para descargar tickets desde Drive, configurá `VITE_GOOGLE_PICKER_API_KEY` en `.env.local` y en las variables del entorno `github-pages` de GitHub Actions. Debe ser una clave de Google Cloud del mismo proyecto con Google Picker API habilitada; restringila por HTTP referrer a los dominios local y GitHub Pages de la app. No reutilices la API key de Firebase.