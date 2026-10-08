// Сховище на D1: SQL-запити до прив'язки env.DB (wrangler.jsonc).

const SORT_FIELD = "rating";     // поле сортування запиту 1, те саме, що в src/index.js
const SORT_DIR = "ASC";          // напрям сортування запиту 1 (за зростанням)

// Логічних полів у основній сутності В06 немає; SQLite віддає їх як 0 або 1, а назовні йде true/false.
const BOOLEAN_FIELDS = [];
const toApi = (row) => row && Object.fromEntries(Object.entries(row)
  .map(([k, v]) => [k, BOOLEAN_FIELDS.includes(k) ? v === 1 : v]));
const toDb = (data) => Object.fromEntries(Object.entries(data)
  .map(([k, v]) => [k, BOOLEAN_FIELDS.includes(k) ? (v ? 1 : 0) : v]));
// id у D1 цілий; рядок, що не є додатним цілим, не відповідає жодному запису.
const asId = (id) => (/^[1-9]\d*$/.test(id) ? Number(id) : null);

// Запит 1: фільми жанру genre з прем'єрою після дати after, за rating за зростанням.
export async function listFilms(env, { genre, after, limit, offset = 0, cursor }) {
  const where = ["genre = ?", "premiere_on > ?"];
  const binds = [genre, after];
  if (cursor) {
    // Порівняння пар (значення, id): фільми з однаковим рейтингом не губляться між сторінками.
    where.push(`(${SORT_FIELD}, id) ${SORT_DIR === "ASC" ? ">" : "<"} (?, ?)`);
    binds.push(cursor.value, cursor.id);
  }
  const { results, meta } = await env.DB.prepare(
    `SELECT * FROM films WHERE ${where.join(" AND ")}
     ORDER BY ${SORT_FIELD} ${SORT_DIR}, id ${SORT_DIR} LIMIT ? OFFSET ?`)
    .bind(...binds, limit + 1, offset).all();
  // meta.rows_read: скільки рядків прочитала база; саме за них рахується ліміт D1.
  return { items: results.map(toApi), readCount: meta.rows_read };
}

// Запит 2: кількість і середній рейтинг фільмів вікового обмеження. Порожня вибірка: 0 і null.
export async function stats(env, ageRating) {
  return env.DB.prepare(
    `SELECT COUNT(*) AS films_count, ROUND(AVG(rating), 2) AS avg_rating
     FROM films WHERE age_rating = ?`).bind(ageRating).first();
}

export async function getFilm(env, id) {
  return toApi(await env.DB.prepare("SELECT * FROM films WHERE id = ?").bind(asId(id)).first());
}

export async function createFilm(env, data) {
  const d = toDb(data);
  return toApi(await env.DB.prepare(
    `INSERT INTO films (title, genre, duration_min, age_rating, premiere_on, rating)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING *`)
    .bind(d.title, d.genre, d.duration_min, d.age_rating, d.premiere_on, d.rating).first());
}

// DELETE: сеанси фільму видаляє ON DELETE CASCADE зі schema.sql.
export async function deleteFilm(env, id) {
  const { meta } = await env.DB.prepare("DELETE FROM films WHERE id = ?").bind(asId(id)).run();
  return meta.changes > 0;
}

// Запит 3: сеанси фільму, на які продано менше soldBelow квитків (якщо параметр заданий),
// за часом початку. null, якщо фільму немає.
export async function listScreenings(env, id, soldBelow) {
  if (!(await getFilm(env, id))) return null;
  const where = ["film_id = ?"];
  const binds = [asId(id)];
  if (soldBelow !== null) { where.push("sold < ?"); binds.push(soldBelow); }
  const { results } = await env.DB.prepare(
    `SELECT * FROM screenings WHERE ${where.join(" AND ")} ORDER BY starts_at ASC, id ASC`)
    .bind(...binds).all();
  return results;
}

export async function createScreening(env, id, data) {
  if (!(await getFilm(env, id))) return null;
  return env.DB.prepare(
    "INSERT INTO screenings (film_id, starts_at, hall, sold, price) VALUES (?, ?, ?, ?, ?) RETURNING *")
    .bind(asId(id), data.starts_at, data.hall, data.sold, data.price).first();
}
