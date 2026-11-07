// База SQLite (node:sqlite) з методами прив’язки D1 (prepare, bind, all, first, run, batch): src/index.js з ЛР2 без змін.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export function openDb(path, moderators) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  // Порожня база отримує схему ЛР1 (schema.sql) і зміну ЛР2 (schema-lr2.sql: owner_uid, roles), як база D1 у ЛР2.
  // Лише для порожньої: schema.sql починається з DROP TABLE і стерла б дані.
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table'").get())
    for (const file of ["schema.sql", "schema-lr2.sql"]) db.exec(readFileSync(file, "utf8"));
  for (const uid of moderators) db.prepare("INSERT OR REPLACE INTO roles (uid, role) VALUES (?, 'moderator')").run(uid);
  // Рядки результату — у формі D1: { results, meta }. SQLite не рахує прочитаних рядків; rows_read — повернені.
  const all = (sql, args) => {
    const results = db.prepare(sql).all(...args).map((row) => ({ ...row }));
    return { results, meta: { rows_read: results.length } };
  };
  const statement = (sql, args = []) => ({
    sql, args,
    bind: (...values) => statement(sql, values.map((v) => (typeof v === "boolean" ? Number(v) : v))),   // D1: true → 1
    all: async () => all(sql, args),
    first: async () => all(sql, args).results[0] ?? null,
    run: async () => {
      const info = db.prepare(sql).run(...args);
      return { meta: { changes: info.changes } };
    },
  });
  return {
    prepare: (sql) => statement(sql),
    // batch: усі запити в одній транзакції (або всі, або жоден), як у D1.
    async batch(list) {
      db.exec("BEGIN");
      try { const out = list.map((s) => all(s.sql, s.args)); db.exec("COMMIT"); return out; }
      catch (e) { db.exec("ROLLBACK"); throw e; }
    },
  };
}
