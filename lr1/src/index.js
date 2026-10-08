// API кінотеатру (В06): маршрути, перевірка полів, пагінація, кешування.
// Сховище (D1 або Firestore) підключається одним рядком імпорту.
import * as db from "./db-d1.js";

const PAGE_SIZE = 25;            // записів на сторінці за замовчуванням (з таблиці варіантів)
const MAX_PAGE_SIZE = 100;       // більше за один запит не віддаємо
const MAX_OFFSET = 100000;       // найбільший зсув; далі сторінки зі зсувом надто дорогі
const PAGINATION = "cursor";     // "offset" або "cursor" (з таблиці варіантів)
const SORT_FIELD = "rating";   // поле сортування запиту 1; з нього будується курсор
const CACHE_MAX_AGE = 0;         // секунд для Cache-Control на GET (з таблиці варіантів)
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;   // id D1 є числами, Firestore рядками
const NUMBER_PARAM = /^-?\d{1,9}(\.\d{1,9})?$/;  // число в параметрі адреси: без пробілів, 1e3, 0x10, Infinity

// Поля основної сутності й дочірньої та їхні обмеження; з них перевіряються тіла POST.
const GENRES = ["драма", "комедія", "анімація", "документальний"];
const AGE_RATINGS = ["0+", "12+", "16+", "18+"];
const FILM_FIELDS = {
  title:        { type: "string" },
  genre:        { type: "enum", values: GENRES },
  duration_min: { type: "integer", min: 40, max: 240 },
  age_rating:   { type: "enum", values: AGE_RATINGS },
  premiere_on:  { type: "date" },
  rating:       { type: "number", min: 0, max: 10 },
};
const SCREENING_FIELDS = {
  starts_at: { type: "datetime" },
  hall:      { type: "integer", min: 1, max: 12 },
  sold:      { type: "integer", min: 0, max: 400 },
  price:     { type: "number", min: 50, max: 600 },
};

// nosniff забороняє браузеру вгадувати тип вмісту: JSON не буде виконано як HTML чи скрипт.
const json = (data, status = 200, headers = {}) =>
  Response.json(data, { status, headers: { "x-content-type-options": "nosniff", ...headers } });
const error = (status, message, headers = {}) => json({ error: message }, status, headers);

// Дата РРРР-ММ-ДД справжня, якщо після розбору дає ту саму дату: Date.parse("2026-02-31")
// сам по собі не падає, а переносить на 3 березня.
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !v.startsWith("0000")
  && !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const isDateTime = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(v) && !v.startsWith("0000")
  && !isNaN(Date.parse(v)) && new Date(v).toISOString().replace(".000Z", "Z") === v;
const CHECKS = {
  string:   (v) => typeof v === "string" && v.trim() !== "",
  enum:     (v, rule) => rule.values.includes(v),
  number:   (v) => typeof v === "number" && Number.isFinite(v),
  integer:  (v) => Number.isSafeInteger(v),
  boolean:  (v) => typeof v === "boolean",
  date:     isDate,
  datetime: isDateTime,
};

// Перевірка тіла запиту. partial = true для PATCH: відсутні поля дозволені.
// Object.hasOwn, а не «in»: інакше constructor чи toString пройшли б як поля сутності.
function validate(body, fields, partial) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return ["тіло має бути об'єктом JSON"];
  const problems = [];
  for (const key of Object.keys(body)) if (!Object.hasOwn(fields, key)) problems.push(`невідоме поле ${key}`);
  for (const [key, rule] of Object.entries(fields)) {
    const v = body[key];
    if (v === undefined) { if (!partial) problems.push(`бракує поля ${key}`); continue; }
    if (!CHECKS[rule.type](v, rule)) {
      problems.push(rule.type === "enum" ? `поле ${key}: одне з ${rule.values.join(", ")}` : `поле ${key} має бути типу ${rule.type}`);
      continue;
    }
    if (rule.min !== undefined && (v < rule.min || v > rule.max)) problems.push(`поле ${key} поза межами ${rule.min}…${rule.max}`);
  }
  return problems;
}

// Ціле невід'ємне число з параметра адреси; порожній рядок, 1e3 чи -1 не проходять.
function intParam(params, name, fallback, max) {
  const raw = params.get(name);
  if (raw === null) return fallback;
  const n = /^\d{1,9}$/.test(raw) ? Number(raw) : NaN;
  return n <= max ? n : null;
}

// Курсор: значення поля сортування й id останнього запису сторінки в base64url.
// TextEncoder потрібен, бо btoa приймає лише латиницю, а значення може бути кирилицею.
const toBase64Url = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64Url = (s) => new TextDecoder().decode(
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));
const encodeCursor = (item) => toBase64Url(JSON.stringify([item[SORT_FIELD], item.id]));
function decodeCursor(s) {
  try {
    const parsed = JSON.parse(fromBase64Url(s));
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [value, id] = parsed;
    // Значення курсора має той самий тип, що й поле сортування: число, дата чи рядок.
    const rule = FILM_FIELDS[SORT_FIELD];
    const valueOk = rule.type === "enum" || rule.type === "string" ? typeof value === "string" : CHECKS[rule.type](value, rule);
    // id курсора: додатне ціле (D1) або рядок з дозволених символів (Firestore); null чи true не проходять.
    const idOk = (Number.isSafeInteger(id) && id > 0) || (typeof id === "string" && ID_PATTERN.test(id));
    return valueOk && idOk ? { value, id } : null;
  } catch { return null; }
}

function genreParam(params) {
  const genre = params.get("genre");
  return GENRES.includes(genre) ? genre : null;
}

// Вікове обмеження містить «+»; у рядку запиту незакодований «+» читається як пробіл,
// тож пробіл повертається в «+»: age_rating=12+ і age_rating=12%2B означають те саме.
function ageRatingParam(params) {
  const raw = params.get("age_rating");
  const value = raw === null ? null : raw.replaceAll(" ", "+");
  return AGE_RATINGS.includes(value) ? value : null;
}

// Запит 1: фільми жанру genre з прем'єрою після дати after, сортування за SORT_FIELD за зростанням.
async function listFilms(env, params) {
  const genre = genreParam(params);
  if (!genre) return error(400, `параметр genre: одне з ${GENRES.join(", ")}`);
  const after = params.get("after");
  if (!isDate(after)) return error(400, "параметр after має бути датою РРРР-ММ-ДД");
  const limit = intParam(params, "limit", PAGE_SIZE, MAX_PAGE_SIZE);
  if (!limit) return error(400, `limit: ціле 1…${MAX_PAGE_SIZE}`);
  const query = { genre, after, limit };
  if (PAGINATION === "offset") {
    query.offset = intParam(params, "offset", 0, MAX_OFFSET);
    if (query.offset === null) return error(400, `offset: ціле 0…${MAX_OFFSET}`);
  } else if (params.has("cursor")) {
    query.cursor = decodeCursor(params.get("cursor"));
    if (!query.cursor) return error(400, "некоректний cursor");
  }
  // Сховище повертає до limit + 1 записів: зайвий запис показує, що є наступна сторінка.
  const { items, readCount } = await db.listFilms(env, query);
  const page = items.slice(0, limit);
  const hasMore = items.length > limit;
  const body = PAGINATION === "offset"
    ? { items: page, limit, offset: query.offset, next_offset: hasMore ? query.offset + limit : null }
    : { items: page, limit, next_cursor: hasMore ? encodeCursor(page.at(-1)) : null };
  // Число читань повідомляє сховище; якщо воно невідоме, заголовка немає.
  return json(body, 200, readCount === null ? {} : { "x-read-count": String(readCount) });
}

// Запис (POST, PATCH, DELETE) дозволено лише з маркером адміністратора: заголовок
// Authorization: Bearer <ADMIN_TOKEN>, де ADMIN_TOKEN — секрет Worker (.dev.vars локально).
// Поки секрет не задано, запис вимкнено.
// Вхід користувачів з окремими правами замінить цей маркер у ЛР2.
function isAdmin(request, env) {
  const expected = env.ADMIN_TOKEN;
  if (!expected) return false;
  // Лише «Bearer <маркер>»: маркер без схеми чи з іншою схемою не приймається.
  const given = /^Bearer (\S+)$/i.exec(request.headers.get("authorization") ?? "");
  if (!given) return false;
  const a = new TextEncoder().encode(given[1]);
  const b = new TextEncoder().encode(expected);
  // Порівняння за сталий час: час відповіді не підказує, скільки перших символів збіглося.
  return a.byteLength === b.byteLength && crypto.subtle.timingSafeEqual(a, b);
}

async function readBody(request) {
  try { return { body: await request.json() }; } catch { return { response: error(400, "тіло не є JSON") }; }
}

// Методи кожного маршруту. Спершу вибирається маршрут і метод, лише потім читається тіло.
const ROUTES = {
  list:  ["GET", "POST"],
  stats: ["GET"],
  item:  ["GET", "DELETE"],                 // у В06 лишається DELETE; PATCH дає 405
  screenings: ["GET", "POST"],
};

async function route(request, env, url, id, sub) {
  const kind = id === undefined ? "list" : id === "stats" && sub === undefined ? "stats"
    : sub === undefined ? "item" : sub === "screenings" ? "screenings" : null;
  if (!kind) return error(404, "маршруту немає");
  // HEAD обробляється як GET: curl -I надсилає саме HEAD.
  const m = request.method === "HEAD" ? "GET" : request.method;
  if (!ROUTES[kind].includes(m)) {
    return error(405, `метод ${request.method} не підтримується`, { allow: [...ROUTES[kind], "HEAD"].join(", ") });
  }
  if (m !== "GET" && !isAdmin(request, env)) {
    return error(401, "потрібен маркер адміністратора", { "www-authenticate": "Bearer" });
  }
  let body;
  if (m === "POST" || m === "PATCH") {
    const parsed = await readBody(request);
    if (parsed.response) return parsed.response;
    body = parsed.body;
  }

  if (kind === "list") {                                      // /api/films
    if (m === "GET") return listFilms(env, url.searchParams);
    const problems = validate(body, FILM_FIELDS, false);
    if (problems.length) return json({ error: problems }, 400);
    const item = await db.createFilm(env, body);
    return json(item, 201, { location: `/api/films/${item.id}` });
  }
  if (kind === "stats") {                                     // /api/films/stats: запит 2
    const ageRating = ageRatingParam(url.searchParams);
    if (!ageRating) return error(400, `параметр age_rating: одне з ${AGE_RATINGS.join(", ")}`);
    return json({ age_rating: ageRating, ...(await db.stats(env, ageRating)) });
  }
  if (kind === "item") {                                      // /api/films/:id
    if (m === "GET") {
      const item = await db.getFilm(env, id);
      return item ? json(item) : error(404, "фільму немає");
    }
    return (await db.deleteFilm(env, id)) ? new Response(null, { status: 204 }) : error(404, "фільму немає");
  }
  if (m === "GET") {                                          // /api/films/:id/screenings: запит 3
    const raw = url.searchParams.get("sold_below");
    if (raw !== null && !/^\d{1,9}$/.test(raw)) return error(400, "sold_below має бути цілим невід'ємним числом");
    const items = await db.listScreenings(env, id, raw === null ? null : Number(raw));
    return items ? json({ items }) : error(404, "фільму немає");
  }
  const problems = validate(body, SCREENING_FIELDS, false);
  if (problems.length) return json({ error: problems }, 400);
  const item = await db.createScreening(env, id, body);
  return item ? json(item, 201) : error(404, "фільму немає");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const [api, resource, id, sub, ...rest] = url.pathname.split("/").filter(Boolean);
    if (api !== "api" || resource !== "films" || rest.length) return error(404, "маршруту немає");
    if (id !== undefined && id !== "stats" && !ID_PATTERN.test(id)) return error(404, "фільму немає");
    let response;
    try {
      response = await route(request, env, url, id, sub);
    } catch (e) {
      // Подробиці йдуть у журнал (npx wrangler tail). Клієнтові повний текст помилки сховища
      // віддається лише під час локального запуску: так Firestore повідомляє, який індекс створити.
      console.error(e);
      const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
      return error(500, local ? String(e.message ?? e) : "внутрішня помилка; подробиці в журналі Worker");
    }
    // Успішні відповіді GET дозволено кешувати клієнтові на CACHE_MAX_AGE секунд.
    if ((request.method === "GET" || request.method === "HEAD") && response.ok) {
      response.headers.set("cache-control", `max-age=${CACHE_MAX_AGE}`);
    }
    return request.method === "HEAD" ? new Response(null, response) : response;
  },
};
