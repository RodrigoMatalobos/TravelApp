# Generador de JSON para TravelApp

 Esta carpeta permite generar archivos JSON desde un CSV local sin tocar los datos principales por defecto.

## Único template de entrada

Usá como base este archivo:

- [tool/templates/input-template.csv](tool/templates/input-template.csv)

Este es el único CSV de entrada. `country-template.json` queda como referencia del JSON generado.

## Uso seguro por defecto

Por defecto, el generador NO pisa los JSON de la app. Genera todo en una carpeta separada:

```bash
node tool/generate-data.js tool/templates/input-template.csv --output output
```

Esto crea archivos en:

- `output/country.json`
- `output/spain.json`
- `output/france.json`

## Si querés escribir directamente en data/

Solo cuando lo decidas explícitamente:

```bash
node tool/generate-data.js tool/templates/input-template.csv --in-place
```

> Con `--in-place` sí escribe en `data/`, pero hace merge de países existentes en lugar de borrar todo.

## Estructura esperada del CSV

Las columnas principales son:

- `country_id`
- `country_name`
- `flag`
- `spotify_url`
- `bg_image`
- `servicios_consulados`
- `servicios_farmacias`
- `servicios_lavanderias`
- `city_name`
- `city_dates`
- `hotel_name`
- `hotel_url`
- `hotel_map`
- `como_llegar`
- `activities`
- `gastronomia`
- `drive_folder_url` (opcional; enlace compartido directo a la carpeta de tickets del país)

Cada fila representa una ciudad. Repetí los datos generales del país en sus filas y completá `drive_folder_url` con el enlace de su subcarpeta de Drive. Los nombres de carpetas no alcanzan para construir los enlaces, porque Drive identifica cada carpeta con un ID. Si el campo queda vacío, no se muestra el botón.

## Administrar enlaces desde la PC

Ejecutá desde la carpeta del proyecto:

```bash
node tool/manage-drive-folders.js
```

El programa guarda la URL raíz de `Viaje Europa 2026` en `tool/drive-config.json` y permite cargar la URL compartida de cada subcarpeta por país. Solo actualiza los enlaces en `data/country.json` y en los JSON de esos países después de confirmar escribiendo `SI`. Enter conserva el valor actual; `-` lo quita.

Los tickets pueden contener datos personales. Mantené las carpetas restringidas a las cuentas autorizadas; la app no agrega autenticación propia a Drive.

### Cómo escribir actividades y gastronomía

Usá este formato dentro del CSV:

```text
"Abadía de Montserrat|https://maps.google.com/?q=Abadia+de+Montserrat||Sagrada Familia|https://maps.google.com/?q=Basílica+de+la+Sagrada+Familia"
```

Esto genera dos objetos:

```json
[
  { "nombre": "Abadía de Montserrat", "mapa": "https://maps.google.com/?q=Abadia+de+Montserrat" },
  { "nombre": "Sagrada Familia", "mapa": "https://maps.google.com/?q=Basílica+de+la+Sagrada+Familia" }
]
```

## Verificación

Podés probar el generador y el administrador sin instalar dependencias extra con:

```bash
node --test tool/generate-data.test.js tool/manage-drive-folders.test.js
```

## Nota

Si un campo queda vacío, el generador lo conserva como vacío y la app no se rompe.
