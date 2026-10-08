# ЛР1, варіант В06 «Кінотеатр»

- Адреса API: `https://lr1-cinema.vasid1304-4a1.workers.dev`
- Платформа: Cloudflare Workers + Cloudflare D1; мова: JavaScript
- Параметри варіанта: 12 фільмів, пагінація з курсором, 25 записів на сторінці, метод `DELETE`, `Cache-Control: max-age=0`
- Читати може будь-хто, записувати (`POST`, `DELETE`) лише з `Authorization: Bearer <ADMIN_TOKEN>`

## Маршрути

| Маршрут | Методи | Призначення |
|---|---|---|
| `/api/films` | GET, POST | запит 1 (GET), створення фільму |
| `/api/films/:id` | GET, DELETE | фільм; видалення разом із сеансами (`ON DELETE CASCADE`); `PATCH` і `PUT` дають 405 |
| `/api/films/:id/screenings` | GET, POST | запит 3 (GET), додавання сеансу |
| `/api/films/stats` | GET | запит 2 |

## Запит 1: фільми жанру з прем'єрою після дати

`GET /api/films?genre=драма&after=2005-01-01&limit=25&cursor=...`

- `genre` обов'язковий: драма, комедія, анімація, документальний. `after` обов'язковий, дата `РРРР-ММ-ДД`; умова строга: `premiere_on > after`.
- `limit` 1…100 (за замовчуванням 25). `cursor` береться з поля `next_cursor` попередньої сторінки.
- Сортування: `rating` за зростанням, за однакового рейтингу за `id` за зростанням.
- Відповідь: `{ "items": [...], "limit": 25, "next_cursor": "..." }`; на останній сторінці `next_cursor` дорівнює `null`.
- Курсор є base64url від `[rating, id]` останнього запису сторінки. Некоректний курсор дає 400.
- Заголовок `x-read-count` містить число рядків, які прочитала D1 (`rows_read`).

## Запит 2: середній рейтинг фільмів вікового обмеження

`GET /api/films/stats?age_rating=16%2B`

- `age_rating` обов'язковий: 0+, 12+, 16+, 18+. У рядку запиту «+» треба писати як `%2B`; незакодований «+» API також приймає.
- Відповідь: `{ "age_rating": "16+", "films_count": 5, "avg_rating": 8.52 }`.
- Середній рейтинг округлено до сотих. Порожня вибірка: `films_count` дорівнює `0`, `avg_rating` дорівнює `null`.

## Запит 3: сеанси фільму із заповненістю менше заданої кількості квитків

`GET /api/films/3/screenings?sold_below=100`

- `sold_below` ціле невід'ємне число; умова строга: `sold < sold_below`. Інше значення (`NaN`, `-1`, `1e3`) дає 400. Без параметра повертаються всі сеанси фільму.
- Порядок: за `starts_at` за зростанням, потім за `id`.
- Відповідь: `{ "items": [...] }`; фільму немає: 404; порожня вибірка: `{ "items": [] }`.

## Початкові дані

12 реальних фільмів (Inception, Interstellar, Pulp Fiction, The Shawshank Redemption, Fight Club, Parasite, The Departed, Gladiator, Snatch, The Martian, Dune, Blade Runner 2049) з приблизними даними: тривалість, дата прем'єри в США, рейтинг близький до IMDb. Жанр обмежено переліком варіанта (драма, комедія, анімація, документальний), вікове обмеження віднесено до найближчого значення переліку. У кожного фільму 2–4 згенеровані сеанси. Для запиту 1 (`genre=драма&after=2005-01-01`) підходять 6 фільмів, серед них дві пари з однаковим рейтингом (8.0 і 8.5).

## Запуск

```cmd
npm install
npx wrangler login
node make-dev-vars.mjs            # створює .dev.vars з ADMIN_TOKEN (у git не потрапляє)
node seed.mjs 12                  # seed.sql
npm run db:local
npx wrangler dev                  # http://localhost:8787
npm run check -- http://localhost:8787     # в іншому вікні

npx wrangler d1 create lr1-db     # database_id вписати в wrangler.jsonc
npm run db:remote
npm run deploy
npx wrangler secret bulk .dev.vars
npm run check -- [https://lr1-cinema.vasid1304-4a1.workers.dev](https://lr1-cinema.vasid1304-4a1.workers.dev)
node measure.mjs [https://lr1-cinema.vasid1304-4a1.workers.dev](https://lr1-cinema.vasid1304-4a1.workers.dev) 1