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
  await cargarBorradas();
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
  // Quitar las fotos borradas (lista común en GitHub) y las ocultadas antes en este dispositivo.
  const fuera = new Set([...borradas, ...leer(CLAVE_OCULTAS, [])]);
  const quitar = (lista) => lista.filter((f) => !fuera.has(f.src));
  const f2 = quitar(ficha), w2 = quitar(web);
  const todas = f2.concat(w2);
  if (!todas.length) return ficha.slice(0, 1); // nunca dejar una especie sin foto
  if (modo === "ficha") return f2.length ? f2 : w2;
  if (modo === "web") return w2.length ? w2 : f2;
  return todas;
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
  } else {
    cred.appendChild(document.createTextNode(f.credito));
  }
  // Borrar la foto para siempre (pide confirmación y contraseña).
  if (fotos.length > 1) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "btn-ocultar"; b.textContent = "Borrar esta foto";
    b.onclick = () => abrirBorrado(f.src);
    cred.appendChild(b);
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

// ---------- Borrar fotos para siempre ----------
// La web no tiene servidor: al borrar, la app añade la foto a datos/borradas.json
// en el repositorio de GitHub. Para ello usa un token de GitHub (con permiso solo
// sobre este repositorio) que se guarda en cada dispositivo cifrado con la contraseña.
const REPO = "EveannChessEngine/visu";
const RUTA_BORRADAS = "datos/borradas.json";
const CLAVE_TOKEN = "visu.token.v1";
let borradas = [];
let fotoABorrar = null;

async function cargarBorradas() {
  try {
    const res = await fetch(RUTA_BORRADAS, { cache: "no-cache" });
    if (res.ok) borradas = (await res.json()).fotos || [];
  } catch { /* sin lista todavía */ }
}

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const deb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function claveCifrado(password, sal) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: sal, iterations: 300000, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function guardarToken(token, password) {
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await claveCifrado(password, sal), new TextEncoder().encode(token));
  guardar(CLAVE_TOKEN, { sal: b64(sal), iv: b64(iv), ct: b64(ct) });
}

async function leerToken(password) {
  const g = leer(CLAVE_TOKEN, null);
  if (!g) return null;
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: deb64(g.iv) },
      await claveCifrado(password, deb64(g.sal)), deb64(g.ct));
    return new TextDecoder().decode(pt);
  } catch { return null; }
}

async function apiGitHub(token, metodo, cuerpo) {
  return fetch(`https://api.github.com/repos/${REPO}/contents/${RUTA_BORRADAS}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    cache: "no-store",
  });
}

async function borrarEnGitHub(token, src) {
  for (let intento = 0; intento < 3; intento++) {
    const res = await apiGitHub(token, "GET");
    if (res.status === 401 || res.status === 403) throw new Error("token");
    let lista = [], sha;
    if (res.ok) {
      const d = await res.json();
      sha = d.sha;
      lista = JSON.parse(decodeURIComponent(escape(atob(d.content.replace(/\n/g, ""))))).fotos || [];
    } else if (res.status !== 404) throw new Error("red");
    if (!lista.includes(src)) lista.push(src);
    const texto = JSON.stringify({ fotos: lista.sort() }, null, 1) + "\n";
    const put = await apiGitHub(token, "PUT", {
      message: `Borrar foto ${src}`,
      content: btoa(unescape(encodeURIComponent(texto))),
      ...(sha ? { sha } : {}),
    });
    if (put.ok) return lista;
    if (put.status === 401 || put.status === 403) throw new Error("token");
    if (put.status !== 409 && put.status !== 422) throw new Error("red");
    // 409/422: otro dispositivo cambió la lista a la vez; se reintenta.
  }
  throw new Error("red");
}

function abrirBorrado(src) {
  fotoABorrar = src;
  $("borrar-foto").src = src;
  $("borrar-clave").value = "";
  $("borrar-token").value = "";
  $("borrar-error").hidden = true;
  $("borrar-bloque-token").hidden = !!leer(CLAVE_TOKEN, null);
  $("dlg-borrar").showModal();
}

$("borrar-cancelar").onclick = () => $("dlg-borrar").close();

$("form-borrar").addEventListener("submit", async (e) => {
  e.preventDefault();
  const error = (txt) => { $("borrar-error").textContent = txt; $("borrar-error").hidden = false; };
  const password = $("borrar-clave").value;
  if ((await hashClave(password)) !== HASH_CLAVE) return error("Contraseña incorrecta.");
  let token = await leerToken(password);
  const nuevo = $("borrar-token").value.trim();
  if (!token) {
    if (!nuevo) { $("borrar-bloque-token").hidden = false; return error("Falta el token de GitHub de este dispositivo."); }
    token = nuevo;
  }
  $("borrar-ok").disabled = true;
  $("borrar-ok").textContent = "Borrando…";
  try {
    borradas = await borrarEnGitHub(token, fotoABorrar);
    if (nuevo) await guardarToken(nuevo, password);
    actual.fotos = actual.fotos.filter((f) => f.src !== fotoABorrar);
    actual.tarjeta.fotos = actual.tarjeta.fotos.filter((f) => f.src !== fotoABorrar);
    fotoIdx = Math.min(fotoIdx, actual.fotos.length - 1);
    pintarFoto();
    $("dlg-borrar").close();
  } catch (err) {
    if (err.message === "token") {
      try { localStorage.removeItem(CLAVE_TOKEN); } catch { /* nada */ }
      $("borrar-bloque-token").hidden = false;
      error("GitHub no acepta el token (¿caducado o sin permiso?). Pega uno nuevo.");
    } else {
      error("No se ha podido conectar con GitHub. Prueba otra vez con conexión.");
    }
  } finally {
    $("borrar-ok").disabled = false;
    $("borrar-ok").textContent = "Borrar para siempre";
  }
});

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
