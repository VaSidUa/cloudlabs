// Записує початкові дані через HTTP API (щоб сервер призначив owner_uid).
import { generate } from "./seed-data.mjs";

const API_URL = process.argv[2];
const SEED_ROWS = Number(process.argv[3] ?? 12);

if (!API_URL) {
  console.error("Вкажіть адресу API: node seed.mjs http://localhost:8787 12");
  process.exit(1);
}

const token = process.env.ID_TOKEN;
if (!token) {
  console.error("Помилка: ID_TOKEN не задано. Виконайте $env:ID_TOKEN = Get-Clipboard");
  process.exit(1);
}

const headers = {
  "content-type": "application/json",
  authorization: `Bearer ${token}`
};

const films = generate(SEED_ROWS);
console.log(`Створення ${SEED_ROWS} фільмів через API...`);

for (const f of films) {
  // 1. Создаем сам фильм
  const filmBody = {
    title: f.title,
    genre: f.genre,
    duration_min: f.duration_min,
    age_rating: f.age_rating,
    premiere_on: f.premiere_on,
    rating: f.rating
  };

  const res = await fetch(`${API_URL}/api/films`, {
    method: "POST",
    headers,
    body: JSON.stringify(filmBody)
  });

  if (!res.ok) {
    console.error(`Помилка створення фільму "${f.title}":`, res.status, await res.text());
    continue;
  }

  const film = await res.json();

  // 2. Создаем сеансы для этого фильма
  for (const s of f.screenings) {
    const screeningBody = {
      starts_at: s.starts_at,
      hall: s.hall,
      sold: s.sold,
      price: s.price
    };

    const sRes = await fetch(`${API_URL}/api/films/${film.id}/screenings`, {
      method: "POST",
      headers,
      body: JSON.stringify(screeningBody)
    });

    if (!sRes.ok) {
      console.error(`Помилка створення сеансу для "${f.title}":`, sRes.status, await sRes.text());
    }
  }
}

console.log(`Готово! Створено ${SEED_ROWS} фільмів.`);