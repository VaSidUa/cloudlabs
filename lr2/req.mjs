const [method, url] = process.argv.slice(2);   

const headers = {};
if (process.env.ID_TOKEN) {
  headers.authorization = `Bearer ${process.env.ID_TOKEN}`;
}

const r = await fetch(url, { method, headers });           
const h = (name) => r.headers.get(name) ?? "-";     

console.log(`${r.status} cache-control: ${h("cache-control")} x-read-count: ${h("x-read-count")}`);
console.log(await r.text());