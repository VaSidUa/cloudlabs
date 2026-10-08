// Записує початкові дані в seed.sql для D1: node seed.mjs [кількість] [файл].
import { writeFileSync } from "node:fs";
import { generate } from "./seed-data.mjs";

const SEED_ROWS = Number(process.argv[2] ?? 12);   // записів основної сутності (з таблиці варіантів)
const OUT_FILE = process.argv[3] ?? "seed.sql";

const q = (s) => `'${String(s).replaceAll("'", "''")}'`;   // рядок SQL з екрануванням лапок
const lines = ["DELETE FROM screenings;", "DELETE FROM films;"];
let screeningId = 0;
generate(SEED_ROWS).forEach((f, i) => {
  const id = i + 1;               // явні id: за ними сеанси посилаються на фільм
  lines.push(`INSERT INTO films (id, title, genre, duration_min, age_rating, premiere_on, rating) ` +
    `VALUES (${id}, ${q(f.title)}, ${q(f.genre)}, ${f.duration_min}, ${q(f.age_rating)}, ${q(f.premiere_on)}, ${f.rating});`);
  for (const s of f.screenings) {
    lines.push(`INSERT INTO screenings (id, film_id, starts_at, hall, sold, price) ` +
      `VALUES (${++screeningId}, ${id}, ${q(s.starts_at)}, ${s.hall}, ${s.sold}, ${s.price});`);
  }
});
// Файл пишеться напряму: перенаправлення «>» у Windows PowerShell 5.1 дає UTF-16, який wrangler не читає.
writeFileSync(OUT_FILE, lines.join("\n") + "\n", "utf8");
console.log(`${OUT_FILE}: ${SEED_ROWS} фільмів, ${screeningId} сеансів`);
