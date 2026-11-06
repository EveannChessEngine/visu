# VISU · Fichas de especies

App web (PWA) para practicar el reconocimiento de especies a partir de fotos.
Se muestra una imagen y hay que escribir el **nombre común**, el **nombre científico** y la **clase**;
solo cuenta como acierto si las tres respuestas son correctas (se ignoran mayúsculas y tildes,
y se toleran faltas de ortografía pequeñas avisando de ellas).

## Estructura

- `index.html`, `estilos.css`, `app.js`: la app.
- `sw.js`, `manifest.webmanifest`, `iconos/`: instalación en el móvil y uso sin conexión.
- `datos/clases.json`: índice de clases disponibles.
- `datos/<clase>/fichas.json` y `datos/<clase>/img/`: fichas e imágenes de cada clase.

## Añadir una clase nueva

Los datos se generan con `herramientas/extraer.py` (fuera de este repositorio, en la carpeta `visu`)
a partir de los PDF escaneados. Después basta con subir los cambios de `datos/`.

## Probar en local

```
python -m http.server 8765
```
y abrir http://localhost:8765
