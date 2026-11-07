// Ключ сервісного акаунта рядком GCP_SA_KEY='{…}' у .dev.vars, файл ключа видаляється: node key2env.mjs <файл ключа .json>
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const keyFile = process.argv[2];
if (!keyFile) {
  console.log("Використання: node key2env.mjs <файл ключа .json>");
  process.exit(1);
}
const key = JSON.parse(readFileSync(keyFile, "utf8"));       // помилка, якщо файл не JSON
const lines = existsSync(".dev.vars") ? readFileSync(".dev.vars", "utf8").split(/\r?\n/).filter(Boolean) : [];
const kept = lines.filter((line) => !line.startsWith("GCP_SA_KEY="));
writeFileSync(".dev.vars", [...kept, `GCP_SA_KEY='${JSON.stringify(key)}'`].join("\n") + "\n");
rmSync(keyFile);
// Лише назви змінних і пошта акаунта: значення ключа не має з’являтися на екрані.
console.log(`.dev.vars: ${[...kept, "GCP_SA_KEY"].map((line) => line.split("=")[0]).join(", ")}`);
console.log(`GCP_SA_KEY: ${key.client_email}, проєкт ${key.project_id}; файл ключа видалено`);
