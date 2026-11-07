# ЛР3: HTTP API на контейнері Render

- **Адреса API на Render (контейнер)**: https://cloudlabs.onrender.com
- **Сторінка входу (Render)**: https://cloudlabs.onrender.com/login
- **Адреса API (Cloudflare Worker з ЛР2)**: https://lr1-cinema.vasid1304-4a1.workers.dev
- **Платформа**: Render (Docker, distroless) / Cloudflare Workers
- **База даних**: SQLite (файл у контейнері) / Cloudflare D1
- **Мова**: JavaScript (Node.js)
- **Модель доступу**: **Власник + публічне читання (owner_public)**

## Аутентифікація
API використовує Firebase Authentication. Запити на зміну даних (POST, DELETE) повинні містити заголовок `Authorization: Bearer <ID_TOKEN>`.

## Таблиця маршрутів

| Метод | Адреса | Без токена | Власник | Інший користувач |
|---|---|---|---|---|
| GET | /api/films | 200 | 200 | 200 |
| GET | /api/films/:id | 200 | 200 | 200 |
| POST | /api/films | 401 | 201 | 201 |
| DELETE| /api/films/:id | 401 | 204 | 403 |
| GET | /api/films/stats | 200 | 200 | 200 |
| GET | /api/films/:id/screenings | 200 | 200 | 200 |
| POST | /api/films/:id/screenings | 401 | 201 | 403 |

*(Примітка: у моделі owner_public модератора немає, тому колонка для нього відсутня).*

## Запуск локально (як процес Node.js)
Запуск адаптера, який перетворює код Worker у звичайний HTTP-сервер:
```bash
node --env-file=config.env --env-file=.dev.vars server.mjs