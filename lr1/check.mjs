// Перевірка всіх маршрутів API: npm run check -- <адреса>, наприклад npm run check -- http://localhost:8787
// (це node --env-file=.dev.vars check.mjs: маркер запису ADMIN_TOKEN береться з .dev.vars).
// Кожен запит порівнюється з очікуваним результатом; наприкінці друкується, скільки перевірок
// не пройшло, і скрипт завершується з кодом 1, якщо хоч одна не пройшла. Вивід іде у звіт.

// ---------------------------------------------------------------------------------------------
// Налаштування під свій варіант. Змінюється лише цей блок.
// ---------------------------------------------------------------------------------------------
const CONFIG = {
  resource: "/api/films",                   // ресурс основної сутності
  child: "screenings",                      // підресурс дочірньої сутності: /api/<ресурс>/:id/<child>
  filter: "genre=драма&after=2005-01-01",   // параметри запиту 1
  stats: "age_rating=16+",                  // параметри запиту 2 (унесено «+», API повертає його з пробілу)
  matches: (it) => it.genre === "драма" && it.premiere_on > "2005-01-01",   // умова запиту 1 для кожного запису
  sortField: "rating",                      // поле сортування запиту 1
  sortDir: "asc",                           // напрям сортування запиту 1 (за зростанням)
  pagination: "cursor",                     // "offset" або "cursor" (з таблиці варіантів)
  pageSize: 3,                              // малий limit, щоб побачити кілька сторінок
  // Запит 2 (середній рейтинг за віковим обмеженням) рахується не по вибірці запиту 1.
  countField: null,
  aggregate: null,
  mutations: ["DELETE"],                    // методи /:id свого варіанта
  removed: ["PATCH"],                       // методи /:id, яких у варіанті немає: очікується 405
  newItem: { title: "CHK-1", genre: "драма", duration_min: 120, age_rating: "16+", premiere_on: "2026-06-01", rating: 7.5 },
  patch: { rating: 8 },                     // потрібен лише для перевірки 405 на PATCH
  badDate: ["premiere_on", "2026-02-31"],   // поле типу date і неіснуюча дата
  children: [                               // два дочірні записи; перший проходить фільтр запиту 3, другий ні
    { starts_at: "2026-10-01T10:00:00Z", hall: 3, sold: 20, price: 150 },
    { starts_at: "2026-10-02T10:00:00Z", hall: 5, sold: 300, price: 200 },
  ],
  childFilter: "sold_below=100",            // параметри запиту 3
  childExpected: 1,                         // скільки з двох дочірніх записів повертає запит 3
  badChildFilter: "sold_below=NaN",         // параметр запиту 3, який API має відхилити (400)
};
// ---------------------------------------------------------------------------------------------

const BASE = (process.argv[2] ?? "http://localhost:8787").replace(/\/$/, "");
const R = CONFIG.resource;
const TOKEN = process.env.ADMIN_TOKEN;      // маркер запису; без нього запис має дати 401
const SHOWN_HEADERS = ["cache-control", "location", "x-read-count", "allow"];
const AGG_TOLERANCE = 0.01;                 // агрегат в API округлений до сотих

let failed = 0, total = 0;

async function call(method, path, body, expectStatus, check, auth = TOKEN ? `Bearer ${TOKEN}` : "") {
  const headers = body ? { "content-type": "application/json" } : {};
  if (method !== "GET" && auth) headers.authorization = auth;
  const res = await fetch(BASE + encodeURI(path), { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const shown = SHOWN_HEADERS.filter((h) => res.headers.has(h)).map((h) => `${h}: ${res.headers.get(h)}`);
  // Не JSON (наприклад, HTML-сторінка Cloudflare в перші хвилини після першого розгортання): лише друкується.
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? JSON.parse(text) : null;
  const problems = [];
  if (res.status !== expectStatus) problems.push(`очікувався код ${expectStatus}`);
  if (method === "GET" && res.status === 200 && !res.headers.has("cache-control")) problems.push("немає Cache-Control");
  if (isJson && res.headers.get("x-content-type-options") !== "nosniff") problems.push("немає nosniff");
  if (!problems.length && check) problems.push(...check(data, res));
  total++;
  if (problems.length) failed++;
  console.log(`\n${problems.length ? "НЕ ПРОЙШЛО" : "ок"}  ${method} ${path} -> ${res.status}` +
    `${shown.length ? "  [" + shown.join("; ") + "]" : ""}${problems.length ? "  (" + problems.join("; ") + ")" : ""}`);
  if (text) console.log(text.length > 600 ? text.slice(0, 600) + " …" : text);
  return data;
}

// Запит 1 посторінково: кожен запис проходить фільтр, сторінка не більша за limit, жодного запису
// двічі, порядок за полем сортування (за однакових значень — за id) не порушено між сторінками.
const seen = [];
const before = (a, b) => (a[CONFIG.sortField] === b[CONFIG.sortField]
  ? (CONFIG.sortDir === "asc" ? a.id <= b.id : a.id >= b.id)
  : (CONFIG.sortDir === "asc" ? a[CONFIG.sortField] < b[CONFIG.sortField] : a[CONFIG.sortField] > b[CONFIG.sortField]));
const pageCheck = (d) => {
  if (!Array.isArray(d?.items)) return ["немає масиву items"];
  const out = [];
  if (d.items.length > CONFIG.pageSize) out.push("записів більше за limit");
  if (CONFIG.pagination === "cursor" && !("next_cursor" in d)) out.push("немає next_cursor");
  if (CONFIG.pagination === "offset" && !("next_offset" in d)) out.push("немає next_offset");
  for (const it of d.items) {
    if (!CONFIG.matches(it)) out.push(`запис ${it.id} не проходить фільтр`);
    if (seen.some((s) => s.id === it.id)) out.push(`запис ${it.id} повторився`);
    if (seen.length && !before(seen.at(-1), it)) out.push(`порушено порядок на ${it.id}`);
    seen.push(it);
  }
  return out;
};
let page = await call("GET", `${R}?${CONFIG.filter}&limit=${CONFIG.pageSize}`, null, 200, pageCheck);
while (page && (page.next_cursor || page.next_offset)) {
  const next = page.next_cursor ? `cursor=${page.next_cursor}` : `offset=${page.next_offset}`;
  page = await call("GET", `${R}?${CONFIG.filter}&limit=${CONFIG.pageSize}&${next}`, null, 200, pageCheck);
}
// Запит 2: кількість і середнє мають збігатися з записами, які повернув запит 1.
await call("GET", `${R}/stats?${CONFIG.stats ?? CONFIG.filter}`, null, 200, (d) => {
  const out = [];
  if (CONFIG.countField && d?.[CONFIG.countField] !== seen.length) out.push(`кількість ${d?.[CONFIG.countField]} ≠ ${seen.length} записів запиту 1`);
  if (CONFIG.aggregate && seen.length) {
    const [key, compute] = CONFIG.aggregate;
    const expected = compute(seen);
    if (Math.abs(d?.[key] - expected) > AGG_TOLERANCE) out.push(`${key} ${d?.[key]} ≠ ${expected.toFixed(2)}`);
  }
  return out;
});

// Передумова: щонайменше MIN_MATCHING записів проходять фільтр і два з них мають однакове значення поля
// сортування. Інакше порядок за id і вартість сторінок (measure.mjs) перевірити нема на чому.
const MIN_MATCHING = 4;
const hasTie = seen.some((it, i) => i > 0 && it[CONFIG.sortField] === seen[i - 1][CONFIG.sortField]);
total++;
if (seen.length < MIN_MATCHING || !hasTie) {
  failed++;
  console.log(`
НЕ ПРОЙШЛО  початкові дані: запит 1 повернув ${seen.length} записів` +
    `${hasTie ? "" : ", жодної пари з однаковим " + CONFIG.sortField}; необхідно щонайменше ${MIN_MATCHING} і одна пара`);
} else console.log(`
ок  початкові дані: запит 1 повернув ${seen.length} записів, є однакові значення ${CONFIG.sortField}`);

// Запис без маркера, з чужим маркером і без схеми Bearer: 401 для всіх дозволених методів запису.
await call("POST", R, CONFIG.newItem, 401, null, "");
await call("POST", R, CONFIG.newItem, 401, null, "Bearer not-the-token");
if (TOKEN) await call("POST", R, CONFIG.newItem, 401, null, TOKEN);             // маркер без «Bearer»
for (const m of CONFIG.mutations) await call(m, `${R}/1`, m === "PATCH" ? CONFIG.patch : null, 401, null, "");

if (!TOKEN) { console.log("\nADMIN_TOKEN не задано: запустіть через npm run check -- <адреса>"); process.exit(1); }
const created = await call("POST", R, CONFIG.newItem, 201);
if (!created?.id) { console.log("\nPOST не створив запис: подальші перевірки не мають сенсу"); process.exit(1); }
const id = created.id;
const firstKey = Object.keys(CONFIG.newItem)[0];
await call("GET", `${R}/${id}`, null, 200, (d) => (d?.[firstKey] === CONFIG.newItem[firstKey] ? [] : ["повернуто не той запис"]));
for (const c of CONFIG.children) await call("POST", `${R}/${id}/${CONFIG.child}`, c, 201);
await call("GET", `${R}/${id}/${CONFIG.child}?${CONFIG.childFilter}`, null, 200,               // запит 3
  (d) => (d?.items?.length === CONFIG.childExpected ? [] : [`очікувалося дочірніх записів: ${CONFIG.childExpected}, отримано ${d?.items?.length}`]));
if (CONFIG.mutations.includes("PATCH")) {
  const [pk, pv] = Object.entries(CONFIG.patch)[0];
  await call("PATCH", `${R}/${id}`, CONFIG.patch, 200,
    (d) => (d?.[pk] === pv && d?.[firstKey] === CONFIG.newItem[firstKey] ? [] : ["поле не оновлено або втрачено інші поля"]));
  await call("PATCH", `${R}/999999`, CONFIG.patch, 404);
}
if (CONFIG.mutations.includes("DELETE")) {
  await call("DELETE", `${R}/${id}`, null, 204);
  await call("GET", `${R}/${id}`, null, 404);
  await call("GET", `${R}/${id}/${CONFIG.child}`, null, 404);
}
// Методи, яких немає в картці: 405 незалежно від маркера.
for (const m of CONFIG.removed) await call(m, `${R}/${id}`, m === "PATCH" ? CONFIG.patch : null, 405);

// Помилкові запити: очікуються коди 400, 404 і 405.
await call("POST", R, { ...CONFIG.newItem, colour: "red" }, 400);                          // невідоме поле
await call("POST", R, { ...CONFIG.newItem, [CONFIG.badDate[0]]: CONFIG.badDate[1] }, 400);   // неіснуюча дата
await call("POST", R, { constructor: 1 }, 400);                                             // успадковане ім'я поля
await call("GET", `${R}?${CONFIG.filter}&limit=`, null, 400);                                // порожній limit
if (CONFIG.pagination === "cursor") await call("GET", `${R}?${CONFIG.filter}&cursor=WzEsbnVsbF0`, null, 400);  // [1,null]
await call("GET", `${R}/1/${CONFIG.child}?${CONFIG.badChildFilter}`, null, 400);
await call("GET", `${R}/999999`, null, 404);
await call("PUT", `${R}/1`, { code: "X" }, 405);

console.log(`\nПеревірок: ${total}, не пройшли: ${failed}`);
process.exit(failed ? 1 : 0);
