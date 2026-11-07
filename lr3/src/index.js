// API кінотеатру (В06): маршрути, перевірка полів, пагінація, кешування.
import * as db from "./db-d1.js";
import { userFromRequest } from "./auth.js";

const PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const MAX_OFFSET = 100000;
const PAGINATION = "cursor";
const SORT_FIELD = "rating";
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const NUMBER_PARAM = /^-?\d{1,9}(\.\d{1,9})?$/;

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

const json = (data, status = 200, headers = {}) =>
  Response.json(data, { status, headers: { "x-content-type-options": "nosniff", ...headers } });
const error = (status, message, headers = {}) => json({ error: message }, status, headers);

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

function intParam(params, name, fallback, max) {
  const raw = params.get(name);
  if (raw === null) return fallback;
  const n = /^\d{1,9}$/.test(raw) ? Number(raw) : NaN;
  return n <= max ? n : null;
}

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
    const rule = FILM_FIELDS[SORT_FIELD];
    const valueOk = rule.type === "enum" || rule.type === "string" ? typeof value === "string" : CHECKS[rule.type](value, rule);
    const idOk = (Number.isSafeInteger(id) && id > 0) || (typeof id === "string" && ID_PATTERN.test(id));
    return valueOk && idOk ? { value, id } : null;
  } catch { return null; }
}

function genreParam(params) {
  const genre = params.get("genre");
  return GENRES.includes(genre) ? genre : null;
}

function ageRatingParam(params) {
  const raw = params.get("age_rating");
  const value = raw === null ? null : raw.replaceAll(" ", "+");
  return AGE_RATINGS.includes(value) ? value : null;
}

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
  const { items, readCount } = await db.listFilms(env, query);
  const page = items.slice(0, limit);
  const hasMore = items.length > limit;
  const body = PAGINATION === "offset"
    ? { items: page, limit, offset: query.offset, next_offset: hasMore ? query.offset + limit : null }
    : { items: page, limit, next_cursor: hasMore ? encodeCursor(page.at(-1)) : null };
  return json(body, 200, readCount === null ? {} : { "x-read-count": String(readCount) });
}

async function readBody(request) {
  try { return { body: await request.json() }; } catch { return { response: error(400, "тіло не є JSON") }; }
}

const ROUTES = {
  list:  ["GET", "POST"],
  stats: ["GET"],
  item:  ["GET", "DELETE"],
  screenings: ["GET", "POST"],
};

async function route(request, env, url, id, sub, uid) {
  const kind = id === undefined ? "list" : id === "stats" && sub === undefined ? "stats"
    : sub === undefined ? "item" : sub === "screenings" ? "screenings" : null;
  if (!kind) return error(404, "маршруту немає");
  
  const m = request.method === "HEAD" ? "GET" : request.method;
  if (!ROUTES[kind].includes(m)) {
    return error(405, `метод ${request.method} не підтримується`, { allow: [...ROUTES[kind], "HEAD"].join(", ") });
  }

  let body;
  if (m === "POST" || m === "PATCH") {
    const parsed = await readBody(request);
    if (parsed.response) return parsed.response;
    body = parsed.body;
  }

  if (kind === "list") { // /api/films
    if (m === "GET") return listFilms(env, url.searchParams);
    const problems = validate(body, FILM_FIELDS, false);
    if (problems.length) return json({ error: problems }, 400);
    const item = await db.createFilm(env, body, uid);
    return json(item, 201, { location: `/api/films/${item.id}` });
  }
  
  if (kind === "stats") { // /api/films/stats
    const ageRating = ageRatingParam(url.searchParams);
    if (!ageRating) return error(400, `параметр age_rating: одне з ${AGE_RATINGS.join(", ")}`);
    return json({ age_rating: ageRating, ...(await db.stats(env, ageRating)) });
  }
  
  if (kind === "item") { // /api/films/:id
    if (m === "GET") {
      const item = await db.getFilm(env, id);
      return item ? json(item) : error(404, "фільму немає");
    }
    
    // ЛОГІКА ВИДАЛЕННЯ: перевірка власника
    const film = await db.getFilm(env, id);
    if (!film) return error(404, "фільму немає");
    if (film.owner_uid !== uid) return error(403, "це чужий запис");
    
    return (await db.deleteFilm(env, id)) ? new Response(null, { status: 204 }) : error(404, "фільму немає");
  }
  
  if (m === "GET") { // /api/films/:id/screenings
    const raw = url.searchParams.get("sold_below");
    if (raw !== null && !/^\d{1,9}$/.test(raw)) return error(400, "sold_below має бути цілим невід'ємним числом");
    const items = await db.listScreenings(env, id, raw === null ? null : Number(raw));
    return items ? json({ items }) : error(404, "фільму немає");
  }
  
  // ЛОГІКА ДОДАВАННЯ СЕАНСУ: перевірка існування фільму та власника
  const film = await db.getFilm(env, id);
  if (!film) return error(404, "фільму немає");
  if (film.owner_uid !== uid) return error(403, "це чужий запис");

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
    let uid = null;

    try {
      // Модель "Власник + публічне читання": GET пускаємо без токена, інші — тільки з токеном
      if (request.method !== "GET" && request.method !== "HEAD") {
        const user = await userFromRequest(request, env);
        if (!user.uid) return error(401, user.error, { "www-authenticate": "Bearer" });
        uid = user.uid;
      }
      
      response = await route(request, env, url, id, sub, uid);
    } catch (e) {
      console.error(e);
      const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
      return error(500, local ? String(e.message ?? e) : "внутрішня помилка; подробиці в журналі Worker");
    }
    
    // Всі відповіді API не кешуються (вимога ЛР2)
    response.headers.set("cache-control", "no-store");
    
    return request.method === "HEAD" ? new Response(null, response) : response;
  },
};