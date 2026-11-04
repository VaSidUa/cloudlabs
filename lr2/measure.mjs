// Скільки читань коштує кожна сторінка запиту 1: node measure.mjs <адреса> [limit]
// Гортає всі сторінки й друкує x-read-count кожної. Вивід іде у звіт.

// Під свій варіант змінюються лише ці два рядки (ті самі значення, що в CONFIG у check.mjs).
const RESOURCE = "/api/films";
const FILTER = "genre=драма&after=2005-01-01";

const BASE = (process.argv[2] ?? "http://localhost:8787").replace(/\/$/, "");
const LIMIT = Number(process.argv[3] ?? 1);          // мала сторінка: сторінок стає більше

let url = `${BASE}${RESOURCE}?${encodeURI(FILTER)}&limit=${LIMIT}`;
let total = 0, unknown = 0;
for (let n = 1; url; n++) {
  const res = await fetch(url);
  if (!res.ok) { console.log(`сторінка ${n}: код ${res.status}\n${await res.text()}`); process.exit(1); }
  const page = await res.json();
  // Без заголовка число читань невідоме (сховище його не повідомило); у суму воно не йде.
  const header = res.headers.get("x-read-count");
  if (header === null) unknown++; else total += Number(header);
  console.log(`сторінка ${n}: записів ${page.items.length}, читань ${header ?? "невідомо"}`);
  const next = page.next_cursor ? `cursor=${page.next_cursor}`
    : page.next_offset !== null && page.next_offset !== undefined ? `offset=${page.next_offset}` : null;
  url = next && `${BASE}${RESOURCE}?${encodeURI(FILTER)}&limit=${LIMIT}&${next}`;
}
console.log(`разом читань: ${total}${unknown ? ` (ще ${unknown} сторінок без заголовка x-read-count)` : ""}`);
