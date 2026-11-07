// Service worker: permite usar la app sin conexión una vez abierta.
const VERSION = "visu-v4";
const BASICOS = ["./", "index.html", "estilos.css", "app.js", "manifest.webmanifest", "iconos/icono.svg", "iconos/icono-192.png", "iconos/icono-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(BASICOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  const esImagen = req.destination === "image";
  if (esImagen) {
    // Imágenes: primero caché, si no, red (y se guardan).
    e.respondWith(
      caches.match(req).then((r) => r || fetch(req).then((res) => {
        const copia = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copia));
        return res;
      }))
    );
  } else {
    // Código y datos: primero red (para recibir fichas nuevas), si falla, caché.
    e.respondWith(
      fetch(req).then((res) => {
        const copia = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copia));
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }))
    );
  }
});
