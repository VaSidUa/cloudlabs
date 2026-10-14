const [method, url] = process.argv.slice(2);   
const r = await fetch(url, { method });           
const h = (name) => r.headers.get(name) ?? "-";     
console.log(`${r.status} cache-control: ${h("cache-control")} x-read-count: ${h("x-read-count")}`);
console.log(await r.text());                        
