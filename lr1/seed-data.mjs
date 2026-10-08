// Генератор початкових записів: SEED_ROWS фільмів, у кожного від MIN_CHILDREN до MAX_CHILDREN сеансів.
const MIN_CHILDREN = 2;          // дочірніх записів щонайменше (з таблиці варіантів)
const MAX_CHILDREN = 4;
const SEED = 2026;               // зерно генератора: ті самі записи при кожному запуску

// Генератор псевдовипадкових чисел mulberry32: Math.random не приймає зерна.
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Реальні фільми з дійсними (приблизними) даними: тривалість, дата прем'єри в США, рейтинг глядачів
// близький до IMDb. Жанр обмежений переліком варіанта: драма, комедія, анімація, документальний.
const FILMS = [
  { title: "Inception",                 genre: "драма",   duration_min: 148, age_rating: "12+", premiere_on: "2010-07-16", rating: 8.8 },
  { title: "Interstellar",              genre: "драма",   duration_min: 169, age_rating: "12+", premiere_on: "2014-11-07", rating: 8.7 },
  { title: "Pulp Fiction",              genre: "драма",   duration_min: 154, age_rating: "18+", premiere_on: "1994-10-14", rating: 8.9 },
  { title: "The Shawshank Redemption",  genre: "драма",   duration_min: 142, age_rating: "16+", premiere_on: "1994-09-23", rating: 9.3 },
  { title: "Fight Club",                genre: "драма",   duration_min: 139, age_rating: "18+", premiere_on: "1999-10-15", rating: 8.8 },
  { title: "Parasite",                  genre: "драма",   duration_min: 132, age_rating: "16+", premiere_on: "2019-05-30", rating: 8.5 },
  { title: "The Departed",              genre: "драма",   duration_min: 151, age_rating: "18+", premiere_on: "2006-10-06", rating: 8.5 },
  { title: "Gladiator",                 genre: "драма",   duration_min: 155, age_rating: "16+", premiere_on: "2000-05-05", rating: 8.5 },
  { title: "Snatch",                    genre: "комедія", duration_min: 104, age_rating: "16+", premiere_on: "2000-09-01", rating: 8.3 },
  { title: "The Martian",               genre: "комедія", duration_min: 144, age_rating: "12+", premiere_on: "2015-10-02", rating: 8.0 },
  { title: "Dune",                      genre: "драма",   duration_min: 155, age_rating: "12+", premiere_on: "2021-10-22", rating: 8.0 },
  { title: "Blade Runner 2049",         genre: "драма",   duration_min: 164, age_rating: "16+", premiere_on: "2017-10-06", rating: 8.0 },
];
const QUERY1_GENRE = "драма";        // значення фільтра запиту 1, з яким працюють check.mjs і measure.mjs
const QUERY1_AFTER = "2005-01-01";   // дата фільтра запиту 1: прем'єра після неї

// Повертає масив фільмів; у кожного поле screenings з масивом сеансів. Перші 12 записів це FILMS,
// для більшої кількості (node seed.mjs 200, вимір читань) список повторюється з номером у назві.
// У запиті 1 (драма, прем'єра після 2005-01-01) шість фільмів, серед них дві пари з однаковим рейтингом
// (8.5 і 8.0); драми до 2005 року, комедії не проходять фільтр.
export function generate(count) {
  const rnd = mulberry32(SEED);
  const between = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const pad = (n) => String(n).padStart(2, "0");
  const films = [];
  for (let i = 0; i < count; i++) {
    const base = FILMS[i % FILMS.length];
    const round = Math.floor(i / FILMS.length);
    const film = { ...base, title: round ? `${base.title} #${round + 1}` : base.title, screenings: [] };
    const children = between(MIN_CHILDREN, MAX_CHILDREN);
    for (let k = 0; k < children; k++) {
      film.screenings.push({
        starts_at: `2026-10-${pad(between(1, 28))}T${pad(between(9, 21))}:${pad(between(0, 5) * 10)}:00Z`,
        hall: between(1, 12),
        sold: between(0, 400),
        price: between(50, 600),
      });
    }
    films.push(film);
  }
  return films;
}
