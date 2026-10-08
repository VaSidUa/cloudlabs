// Готує .dev.vars — локальні секрети Worker: node make-dev-vars.mjs [файл-ключа.json]
//  - ADMIN_TOKEN: випадковий маркер для запису в API; наявний маркер не змінюється.
//  - GCP_SA_KEY: ключ сервісного акаунта одним рядком (лише для Firestore; шлях до JSON-файлу ключа).
// .dev.vars читають wrangler dev, node --env-file і wrangler secret bulk; у git він не потрапляє.
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const FILE = ".dev.vars";
const TOKEN_BYTES = 32;          // 256 біт випадковості: маркер неможливо підібрати перебором

const vars = new Map();
if (existsSync(FILE)) {
  for (const line of readFileSync(FILE, "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0) vars.set(line.slice(0, i), line.slice(i + 1));
  }
}
if (!vars.has("ADMIN_TOKEN")) vars.set("ADMIN_TOKEN", randomBytes(TOKEN_BYTES).toString("base64url"));

const keyFile = process.argv[2];
if (keyFile) {
  const key = JSON.parse(readFileSync(keyFile, "utf8"));
  vars.set("GCP_SA_KEY", JSON.stringify(key));
  console.log(`ключ ${key.client_email}, проєкт ${key.project_id}; файл ключа ${keyFile} тепер можна видалити`);
}
// mode 0o600: файл читає лише власник (на Linux і macOS; у Windows права задає тека користувача).
writeFileSync(FILE, [...vars].map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { encoding: "utf8", mode: 0o600 });
chmodSync(FILE, 0o600);                          // mode діє лише під час створення; наявний файл теж закривається
console.log(`${FILE}: ${[...vars.keys()].join(", ")}`);
