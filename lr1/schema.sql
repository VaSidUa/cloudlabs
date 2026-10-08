-- Схема бази В06: основна сутність films і дочірня screenings. Повторний запуск створює таблиці заново.
DROP TABLE IF EXISTS screenings;
DROP TABLE IF EXISTS films;

CREATE TABLE films (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT    NOT NULL,
  genre        TEXT    NOT NULL CHECK (genre IN ('драма', 'комедія', 'анімація', 'документальний')),
  duration_min INTEGER NOT NULL CHECK (duration_min BETWEEN 40 AND 240),
  age_rating   TEXT    NOT NULL CHECK (age_rating IN ('0+', '12+', '16+', '18+')),
  premiere_on  TEXT    NOT NULL,              -- дата прем'єри у форматі РРРР-ММ-ДД
  rating       REAL    NOT NULL CHECK (rating BETWEEN 0 AND 10)
);

CREATE TABLE screenings (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  film_id   INTEGER NOT NULL REFERENCES films(id) ON DELETE CASCADE,
  starts_at TEXT    NOT NULL,                 -- дата й час ISO 8601
  hall      INTEGER NOT NULL CHECK (hall BETWEEN 1 AND 12),
  sold      INTEGER NOT NULL CHECK (sold BETWEEN 0 AND 400),
  price     REAL    NOT NULL CHECK (price BETWEEN 50 AND 600)
);

-- Індекс під запит 1: рівність за genre, далі порядок сортування (rating, id); premiere_on у кінці,
-- щоб умову за датою перевірити в індексі, не читаючи рядок таблиці.
CREATE INDEX idx_films_q1 ON films (genre, rating, id, premiere_on);
-- Індекс під запит 2: фільми одного вікового обмеження (rating у індексі для середнього).
CREATE INDEX idx_films_age ON films (age_rating, rating);
-- Індекс під запит 3: сеанси одного фільму за часом початку; sold у індексі для умови.
CREATE INDEX idx_screenings_film ON screenings (film_id, starts_at, id, sold);
