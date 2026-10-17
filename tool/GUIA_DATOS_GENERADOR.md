# Guía de datos para el generador

El generador convierte un CSV UTF-8 en un índice de países y un JSON por país. Lee los campos por el nombre exacto de la cabecera; mantené los nombres de columna de la plantilla.

## Estructura del CSV

- La primera fila contiene las cabeceras.
- Cada fila siguiente representa una ciudad.
- Repetí en cada ciudad los datos generales del país para que cada fila se pueda leer y revisar por separado.
- `country_id` debe ser un identificador estable en minúsculas, sin espacios ni acentos, por ejemplo `finland`, `belgium` o `france`. Se usa como ID y nombre del archivo JSON.
- `country_name` es el nombre que se muestra en la app, por ejemplo `Finlandia`.
- `city_name` debe tener un valor para que esa fila genere una ciudad. Una fila sin ciudad no añade una entrada al itinerario.
- Los campos vacíos se guardan vacíos; las columnas de servicios y enlaces son opcionales.

## Columnas

| Columna | Uso |
| --- | --- |
| `country_id` | ID estable del país y nombre del archivo generado. |
| `country_name` | Nombre visible del país. |
| `flag` | Emoji de la bandera. |
| `spotify_url` | URL de la playlist del país. |
| `bg_image` | Ruta de la imagen del país, por ejemplo `img/finland.jpg`. |
| `servicios_consulados` | URL del consulado o servicio equivalente. |
| `servicios_farmacias` | URL para buscar farmacias. |
| `servicios_lavanderias` | URL para buscar lavanderías. |
| `servicios_supermercados` | URL para buscar supermercados. |
| `city_name` | Nombre de la ciudad o etapa. |
| `city_dates` | Fechas de esa estadía. |
| `hotel_name` | Nombre del alojamiento. |
| `hotel_url` | Enlace de reserva. |
| `hotel_map` | Enlace de ubicación del alojamiento. |
| `como_llegar` | Indicaciones para llegar. |
| `activities` | Actividades separadas con el formato indicado abajo. |
| `gastronomia` | Lugares o comidas separadas con el mismo formato. |
| `drive_folder_url` | Enlace opcional a la carpeta de Drive del país. |

## Actividades y gastronomía

Separá elementos con `||`. Para cada elemento, poné el nombre, un solo `|` y opcionalmente el enlace del mapa. Si no tiene mapa, escribí solo el nombre.

```text
Museo|https://maps.google.com/?q=Museo||Plaza central|https://maps.google.com/?q=Plaza
```

Eso genera dos objetos con `nombre` y `mapa`. El generador usa el primer `|` de cada elemento como separador entre nombre y enlace.

## Comas y comillas del CSV

Como el separador de columnas es la coma, encerrá entre comillas cualquier celda que contenga comas. Si dentro del texto necesitás una comilla, duplicala.

```csv
"Desde el aeropuerto, tomá el tren hasta el centro."
"Hotel ""Aurora"", edificio norte"
```

## Ejemplo completo

La forma más segura es copiar `tool/templates/input-template.csv` y reemplazar sus ejemplos:

```csv
country_id,country_name,flag,spotify_url,bg_image,servicios_consulados,servicios_farmacias,servicios_lavanderias,servicios_supermercados,city_name,city_dates,hotel_name,hotel_url,hotel_map,como_llegar,activities,gastronomia,drive_folder_url
france,Francia,🇫🇷,https://open.spotify.com/playlist/ejemplo,img/france.jpg,https://maps.google.com/?q=Consulado+Francia,https://maps.google.com/?q=Farmacias+Paris,https://maps.google.com/?q=Lavanderias+Paris,https://maps.google.com/?q=Supermercados+Paris,París,01/06/2027 - 04/06/2027,Hotel Central,https://example.com/hotel,https://maps.google.com/?q=Hotel+Central,"Desde el aeropuerto, tomá el tren al centro.","Museo|https://maps.google.com/?q=Museo||Jardín|https://maps.google.com/?q=Jardin","Panadería local|https://maps.google.com/?q=Boulangerie",https://drive.google.com/drive/folders/ejemplo
```

## Generar archivos

Guardá los datos reales en `tool/input.csv`; ese archivo está excluido de Git. Desde la raíz del proyecto, generá primero en una carpeta de salida:

```bash
node tool/generate-data.js tool/input.csv --output tool/output
```

Se crean `tool/output/country.json` y un archivo por país, como `tool/output/france.json`. Esos JSON generados también están excluidos de Git.

El generador combina países y agrega ciudades a los JSON existentes del destino. Para evitar duplicados al volver a ejecutarlo, usá una carpeta de salida nueva o revisá los archivos generados antes de repetirlo.

`--in-place` escribe directamente en `frontend/data/` y combina con los archivos existentes. No lo uses si solo querés revisar la salida; mantené los datos reales locales y no subas los JSON con enlaces privados.