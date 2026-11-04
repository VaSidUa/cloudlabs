# ЛР2: Безсерверний HTTP API з керованою базою даних

- Адреса API: https://lr1-cinema.vasid1304-4a1.workers.dev
- Сторінка входу: https://lr1-cinema.vasid1304-4a1.workers.dev/login
- Платформа: Cloudflare Workers + Cloudflare D1
- Мова: JavaScript
- Модель доступу: **Власник + публічне читання (owner_public)**

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