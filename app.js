"use strict";

// ---------- Utilidades ----------
const $ = (id) => document.getElementById(id);

function normalizar(s) {
  return (s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, " ")
    .trim();
}

function distancia(a, b) {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 3;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// Devuelve "ok", "casi" (falta de ortografía pequeña, cuenta como acierto) o "ko".
function comparar(respuesta, aceptadas) {
  const r = normalizar(respuesta);
  if (!r) return "ko";
  const lista = aceptadas.map(normalizar).filter(Boolean);
  if (lista.includes(r)) return "ok";
  const tolerancia = (t) => (t.length >= 12 ? 2 : t.length >= 5 ? 1 : 0);
  if (lista.some((a) => distancia(r, a) <= tolerancia(a))) return "casi";
  return "ko";
}

function barajar(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- Almacenamiento local (estadísticas por ficha) ----------
const CLAVE_STATS = "visu.stats.v1";
const CLAVE_SELECCION = "visu.seleccion.v1";
const CLAVE_FOTOS = "visu.fotos.v1";
const CLAVE_OCULTAS = "visu.ocultas.v1";
function leer(clave, defecto) {
  try { return JSON.parse(localStorage.getItem(clave)) ?? defecto; } catch { return defecto; }
}
function guardar(clave, valor) {
  try { localStorage.setItem(clave, JSON.stringify(valor)); } catch { /* sin almacenamiento */ }
}
let stats = leer(CLAVE_STATS, {});

// ---------- Estado ----------
let indiceClases = [];
const cacheClases = {};
let cola = [];
let actual = null;
let ronda = null;
let fotoIdx = 0;

// ---------- Vistas ----------
function mostrar(vista) {
  for (const v of ["clave", "inicio", "tarjeta", "fin"]) $("vista-" + v).hidden = v !== vista;
  $("btn-inicio").hidden = vista === "inicio" || vista === "clave";
  $("marcador").hidden = vista !== "tarjeta";
  window.scrollTo(0, 0);
}

// ---------- Inicio ----------
async function cargarIndice() {
  const cont = $("lista-clases");
  try {
    const res = await fetch("datos/clases.json", { cache: "no-cache" });
    indiceClases = (await res.json()).clases;
  } catch {
    cont.innerHTML = '<p class="tenue">No se han podido cargar las clases.</p>';
    return;
  }
  const seleccion = leer(CLAVE_SELECCION, null);
  cont.innerHTML = "";
  for (const c of indiceClases) {
    const label = document.createElement("label");
    label.className = "clase-item";
    const marcada = seleccion ? seleccion.includes(c.id) : true;
    label.innerHTML = `<input type="checkbox" value="${c.id}" ${marcada ? "checked" : ""}>
      <span class="nombre"></span><span class="num">${c.total} fichas</span>`;
    label.querySelector(".nombre").textContent = c.clase + (c.grupo ? ` · ${c.grupo}` : "");
    cont.appendChild(label);
  }
  cont.addEventListener("change", actualizarBotonEmpezar);
  actualizarBotonEmpezar();
  actualizarResumen();
}

function clasesMarcadas() {
  return [...document.querySelectorAll("#lista-clases input:checked")].map((i) => i.value);
}

function actualizarBotonEmpezar() {
  $("btn-empezar").disabled = clasesMarcadas().length === 0;
}

function actualizarResumen() {
  const vistas = Object.values(stats);
  if (!vistas.length) { $("resumen-global").textContent = ""; return; }
  const a = vistas.reduce((s, v) => s + v.aciertos, 0);
  const f = vistas.reduce((s, v) => s + v.fallos, 0);
  $("resumen-global").textContent = `Historial: ${a} aciertos y ${f} fallos en ${vistas.length} especies.`;
}

async function cargarClase(id) {
  if (!cacheClases[id]) {
    const res = await fetch(`datos/${id}/fichas.json`, { cache: "no-cache" });
    cacheClases[id] = await res.json();
  }
  return cacheClases[id];
}

async function empezar() {
  const ids = clasesMarcadas();
  guardar(CLAVE_SELECCION, ids);
  $("btn-empezar").disabled = true;
  let tarjetas = [];
  for (const id of ids) {
    const datos = await cargarClase(id);
    for (const f of datos.fichas) {
      tarjetas.push({ ...f, clave: `${id}/${f.id}`, base: `datos/${id}/`, clase: datos.clase, sinonimos_clase: datos.sinonimos_clase || [] });
    }
  }
  if ($("opt-falladas").checked) {
    const falladas = tarjetas.filter((t) => stats[t.clave]?.fallos > 0);
    if (falladas.length) tarjetas = falladas;
  }
  const modo = $("opt-fotos").value;
  guardar(CLAVE_FOTOS, modo);
  for (const t of tarjetas) t.fotos = fotosSegunModo(t, modo);
  cola = barajar(tarjetas).map((t) => ({ tarjeta: t, repetida: false }));
  ronda = { total: cola.length, aciertos: 0, respondidas: 0, falladas: new Map() };
  $("btn-empezar").disabled = false;
  siguiente();
}

// Lista de fotos de una ficha según la opción elegida: [{src, credito, enlace}]
function fotosSegunModo(t, modo) {
  const ficha = t.imagenes.map((src) => ({ src: t.base + src, credito: "Foto de la ficha", enlace: null }));
  const web = (t.fotos_web || []).map((w) => ({
    src: t.base + w.src,
    credito: `Foto: ${w.autor || "anónimo"} · ${w.licencia} · ${w.sitio || "iNaturalist"}`,
    enlace: w.fuente,
  }));
  const ocultas = new Set(leer(CLAVE_OCULTAS, []));
  for (let i = web.length - 1; i >= 0; i--) if (ocultas.has(web[i].src)) web.splice(i, 1);
  if (modo === "ficha" || !web.length) return ficha;
  if (modo === "web") return web;
  return ficha.concat(web);
}

// ---------- Tarjeta ----------
function siguiente() {
  if (!cola.length) return terminar();
  actual = cola.shift();
  const t = actual.tarjeta;
  // Cada vez que sale la tarjeta, las fotos aparecen en un orden al azar.
  actual.fotos = barajar(t.fotos);
  fotoIdx = 0;
  pintarFoto();
  for (const id of ["r-comun", "r-cientifico", "r-clase"]) {
    const inp = $(id);
    inp.value = ""; inp.className = id === "r-cientifico" ? "cursiva" : ""; inp.disabled = false;
  }
  $("form-respuesta").querySelector(".acciones").hidden = false;
  $("resultado").hidden = true;
  actualizarMarcador();
  mostrar("tarjeta");
}

function pintarFoto() {
  const fotos = actual.fotos;
  const f = fotos[fotoIdx];
  $("foto").src = f.src;
  const cred = $("credito");
  cred.textContent = "";
  if (f.enlace) {
    const a = document.createElement("a");
    a.href = f.enlace; a.target = "_blank"; a.rel = "noopener";
    a.textContent = f.credito;
    cred.appendChild(a);
    // Las fotos de internet varían en calidad: se pueden ocultar las que no sirvan.
    const b = document.createElement("button");
    b.type = "button"; b.className = "btn-ocultar"; b.textContent = "Ocultar esta foto";
    b.onclick = () => {
      const ocultas = new Set(leer(CLAVE_OCULTAS, []));
      ocultas.add(f.src);
      guardar(CLAVE_OCULTAS, [...ocultas]);
      actual.fotos.splice(fotoIdx, 1);
      if (!actual.fotos.length) actual.fotos = fotosSegunModo(actual.tarjeta, "ficha");
      fotoIdx = fotoIdx % actual.fotos.length;
      pintarFoto();
    };
    cred.appendChild(b);
  } else {
    cred.textContent = f.credito;
  }
  const puntos = $("puntos-foto");
  puntos.innerHTML = "";
  if (fotos.length > 1) {
    fotos.forEach((_, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = i === fotoIdx ? "activo" : "";
      b.setAttribute("aria-label", `Foto ${i + 1} de ${fotos.length}`);
      b.onclick = () => { fotoIdx = i; pintarFoto(); };
      puntos.appendChild(b);
    });
  }
}

function cambiarFoto(paso) {
  const n = actual?.fotos.length || 1;
  if (n < 2) return;
  fotoIdx = (fotoIdx + paso + n) % n;
  pintarFoto();
}

function actualizarMarcador() {
  $("marcador").textContent = `${ronda.aciertos}/${ronda.respondidas} · quedan ${cola.length + ($("resultado").hidden ? 1 : 0)}`;
}

function aceptadosComun(t) {
  const set = new Set([t.comun, ...(t.alternativos || [])]);
  for (const parte of t.comun.split("/")) set.add(parte.trim());
  return [...set];
}

function comprobar(rendirse) {
  const t = actual.tarjeta;
  const campos = [
    { id: "r-comun", nombre: "Nombre común", correcto: t.comun, estado: rendirse ? "ko" : comparar($("r-comun").value, aceptadosComun(t)) },
    { id: "r-cientifico", nombre: "Nombre científico", correcto: t.cientifico, estado: rendirse ? "ko" : comparar($("r-cientifico").value, [t.cientifico]) },
    { id: "r-clase", nombre: "Clase", correcto: t.clase, estado: rendirse ? "ko" : comparar($("r-clase").value.replace(/^\s*clase\s+/i, ""), [t.clase, ...t.sinonimos_clase]) },
  ];
  const acierto = campos.every((c) => c.estado !== "ko");

  const lista = $("comparacion");
  lista.innerHTML = "";
  for (const c of campos) {
    const inp = $(c.id);
    inp.classList.add(c.estado === "ko" ? "ko" : "ok");
    inp.disabled = true;
    const li = document.createElement("li");
    li.className = c.estado === "ko" ? "ko" : "ok";
    const icono = c.estado === "ko" ? "✗" : "✓";
    li.innerHTML = `${icono} <span></span>: <b></b>`;
    li.querySelector("span").textContent = c.nombre;
    li.querySelector("b").textContent = c.correcto;
    if (c.id === "r-cientifico") li.querySelector("b").classList.add("cursiva");
    if (c.estado === "casi") {
      const aviso = document.createElement("span");
      aviso.className = "aviso";
      aviso.textContent = "Casi: revisa la ortografía.";
      li.appendChild(aviso);
    }
    lista.appendChild(li);
  }

  $("veredicto").textContent = acierto ? "¡Correcto!" : "No del todo";
  $("veredicto").className = "veredicto " + (acierto ? "bien" : "mal");
  $("f-comun").textContent = t.comun;
  $("f-cientifico").textContent = t.cientifico;
  $("f-clase").textContent = "Clase: " + t.clase;
  // Algunas clases traen orden y otras subfilo: se muestra lo que haya.
  $("f-orden").textContent = t.orden ? "Orden: " + t.orden : t.subfilo ? "Subfilo: " + t.subfilo : "";
  $("f-orden").hidden = !t.orden && !t.subfilo;
  $("f-familia").textContent = "Familia: " + t.familia;
  $("f-rasgos").innerHTML = "";
  for (const r of t.rasgos) {
    const li = document.createElement("li");
    li.textContent = r;
    $("f-rasgos").appendChild(li);
  }

  // Estadísticas: solo cuenta el primer intento de cada ronda.
  if (!actual.repetida) {
    ronda.respondidas++;
    if (acierto) ronda.aciertos++;
    const s = stats[t.clave] || { aciertos: 0, fallos: 0 };
    acierto ? s.aciertos++ : s.fallos++;
    stats[t.clave] = s;
    guardar(CLAVE_STATS, stats);
  }
  if (!acierto) {
    ronda.falladas.set(t.clave, t);
    // La ficha fallada vuelve a salir unas tarjetas más adelante.
    cola.splice(Math.min(3, cola.length), 0, { tarjeta: t, repetida: true });
  }

  $("form-respuesta").querySelector(".acciones").hidden = true;
  $("resultado").hidden = false;
  actualizarMarcador();
  document.activeElement?.blur();
  $("resultado").scrollIntoView({ behavior: "smooth", block: "start" });
  $("btn-siguiente").focus({ preventScroll: true });
}

// ---------- Fin ----------
function terminar() {
  const pct = ronda.respondidas ? Math.round((100 * ronda.aciertos) / ronda.respondidas) : 0;
  $("fin-texto").textContent = `Has acertado ${ronda.aciertos} de ${ronda.respondidas} a la primera (${pct} %).`;
  const ul = $("fin-falladas");
  ul.innerHTML = "";
  for (const t of ronda.falladas.values()) {
    const li = document.createElement("li");
    li.innerHTML = "<span></span> · <i></i>";
    li.querySelector("span").textContent = t.comun;
    li.querySelector("i").textContent = t.cientifico;
    ul.appendChild(li);
  }
  mostrar("fin");
}

// ---------- Eventos ----------
$("btn-empezar").onclick = empezar;
$("btn-otra").onclick = () => { actualizarResumen(); mostrar("inicio"); };
$("btn-inicio").onclick = () => { actualizarResumen(); mostrar("inicio"); };
$("btn-siguiente").onclick = siguiente;
$("btn-saltar").onclick = () => comprobar(true);
$("form-respuesta").addEventListener("submit", (e) => { e.preventDefault(); comprobar(false); });

// Intro en un campo pasa al siguiente; en el último, comprueba.
["r-comun", "r-cientifico"].forEach((id, i, arr) => {
  $(id).addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); $(i === 0 ? "r-cientifico" : "r-clase").focus(); }
  });
});

// Tocar la foto o deslizar cambia entre fotos de la misma especie.
let toqueX = null;
$("foto").addEventListener("click", () => cambiarFoto(1));
$("foto").addEventListener("touchstart", (e) => { toqueX = e.touches[0].clientX; }, { passive: true });
$("foto").addEventListener("touchend", (e) => {
  if (toqueX === null) return;
  const dx = e.changedTouches[0].clientX - toqueX;
  if (Math.abs(dx) > 40) cambiarFoto(dx < 0 ? 1 : -1);
  toqueX = null;
});

$("opt-fotos").value = leer(CLAVE_FOTOS, "todas");

// ---------- Contraseña de entrada ----------
// Solo una barrera sencilla: los archivos de la web siguen siendo públicos.
// Se guarda el SHA-256 de "visu:" + contraseña, nunca la contraseña.
const HASH_CLAVE = "403fbe772697afdfdc8b1fc7ee32aa34869005befdce685b777097f833afdab0";
const CLAVE_ACCESO = "visu.acceso.v1";

async function hashClave(texto) {
  const datos = new TextEncoder().encode("visu:" + texto);
  const h = await crypto.subtle.digest("SHA-256", datos);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

$("form-clave").addEventListener("submit", async (e) => {
  e.preventDefault();
  if ((await hashClave($("clave").value)) === HASH_CLAVE) {
    guardar(CLAVE_ACCESO, HASH_CLAVE); // recordar en este dispositivo
    $("clave").value = "";
    mostrar("inicio");
    cargarIndice();
  } else {
    $("clave-error").hidden = false;
    $("clave").select();
  }
});

if (leer(CLAVE_ACCESO, null) === HASH_CLAVE) {
  mostrar("inicio");
  cargarIndice();
} else {
  mostrar("clave");
  $("clave").focus();
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
