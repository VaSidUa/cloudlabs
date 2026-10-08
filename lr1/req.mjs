// Запит до API з виводом коду, заголовків кешу й читань і тіла: node req.mjs <метод> <адреса>
const [method, url] = process.argv.slice(2);          // аргументи після назви скрипту
const r = await fetch(url, { method });               // Node.js кодує кирилицю в адресі правильно
const h = (name) => r.headers.get(name) ?? "-";       // значення заголовка або "-", якщо його немає
console.log(`${r.status} cache-control: ${h("cache-control")} x-read-count: ${h("x-read-count")}`);
console.log(await r.text());                          // тіло відповіді
