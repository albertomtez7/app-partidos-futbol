# Partidos 5v5

App para organizar partidos de futbol 5 contra 5 con amigos.

## Que incluye

- Jugadores ilimitados con nivel inicial manual de 0 a 10.
- Inscripcion de exactamente 10 jugadores por partido.
- Equipos blanco y negro generados de forma aleatoria y equilibrada por nivel.
- Registro de resultado, goles por jugador y MVP.
- Actualizacion automatica de nivel con escala 0-10:
  - El resultado pesa un 80%.
  - Los goles pesan un 10%.
  - El MVP pesa un 10%.
  - La subida o bajada por resultado se ajusta segun el nivel medio del equipo rival.
- Ranking e historico de partidos guardado en el dispositivo.
- Exportar e importar datos en JSON.
- Manifest y service worker para instalarla como PWA.

## Uso en Android

1. Sube esta carpeta a un hosting estatico con HTTPS, por ejemplo GitHub Pages, Netlify o Vercel.
2. Abre la URL desde Chrome en Android.
3. En el menu de Chrome, toca `Anadir a pantalla de inicio`.

Tambien puedes abrir `index.html` directamente en un navegador para probar la app, aunque la instalacion como PWA requiere servirla desde HTTPS.

## Archivos

- `index.html`: estructura de la app.
- `styles.css`: diseno movil.
- `app.js`: logica y guardado local.
- `manifest.webmanifest`: configuracion PWA.
- `sw.js`: cache offline basica.
- `icon.svg`: icono de la app.
