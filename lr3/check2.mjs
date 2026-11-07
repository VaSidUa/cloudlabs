import fs from "node:fs";

const API_URL = process.argv[2] || "http://localhost:8787";
const API_KEY = process.argv[3];

if (!API_KEY) {
  console.error("Вкажіть apiKey Firebase: node check2.mjs http://localhost:8787 <API_KEY>");
  process.exit(1);
}

const USERS_FILE = ".test-users.json";
const AUTH_URL = `https://identitytoolkit.googleapis.com/v1/accounts`;

const CONFIG = {
  access: "owner_public",
  platform: "D1",
  resource: "/api/films",
  child: "screenings",
  list: "genre=драма&after=2005-01-01&limit=100",
  stats: "age_rating=16%2B",
  newItem: { title: "Перевірка ЛР2", genre: "драма", duration_min: 120, age_rating: "16+", premiere_on: "2026-10-01", rating: 8.5 },
  newChild: { starts_at: "2026-10-05T10:00:00Z", hall: 1, sold: 10, price: 150 },
  mutations: ["DELETE"]
};

let passed = 0;
let total = 0;

function check(name, condition, expected, actual) {
  total++;
  if (condition) {
    console.log(`✓ ${name} -> ${actual}`);
    passed++;
  } else {
    console.log(`X ${name} -> ${actual} (очікувався ${expected})`);
  }
}

async function authRequest(endpoint, body) {
  const res = await fetch(`${AUTH_URL}:${endpoint}?key=${API_KEY}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function getToken(email, password) {
  let data = await authRequest("signInWithPassword", { email, password, returnSecureToken: true });
  if (data.error) {
    data = await authRequest("signUp", { email, password, returnSecureToken: true });
  }
  if (data.error) throw new Error(`Помилка авторизації ${email}: ${data.error.message}`);
  return data.idToken;
}

async function req(method, url, token, body) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = {}; try { json = JSON.parse(text); } catch {}
  return { status: res.status, ok: res.ok, json, text, cache: res.headers.get("cache-control") };
}

async function main() {
  let users = {};
  if (fs.existsSync(USERS_FILE)) {
    users = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
  } else {
    users = {
      alice: { email: "alice@example.com", password: "Password123!" },
      bob: { email: "bob@example.com", password: "Password123!" },
      mod: { email: "mod@example.com", password: "Password123!" },
    };
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  }

  const tokens = {};
  for (const [name, user] of Object.entries(users)) {
    tokens[name] = await getToken(user.email, user.password);
  }

  console.log("--- Тестування ---");

  // 1-3. Публічне читання (GET без токена)
  const noTokenList = await req("GET", `${CONFIG.resource}?${CONFIG.list}`);
  check("без токена: GET список", noTokenList.status === 200, 200, noTokenList.status);
  check("cache-control: no-store", noTokenList.cache === "no-store", "no-store", noTokenList.cache);
  
  const statsRes = await req("GET", `${CONFIG.resource}/stats?${CONFIG.stats}`);
  check("без токена: GET stats", statsRes.status === 200, 200, statsRes.status);

  // 4-5. Захист запису (без токена)
  const noTokenPost = await req("POST", CONFIG.resource, null, CONFIG.newItem);
  check("без токена: POST", noTokenPost.status === 401, 401, noTokenPost.status);
  const noTokenDel = await req("DELETE", `${CONFIG.resource}/999`, null);
  check("без токена: DELETE", noTokenDel.status === 401, 401, noTokenDel.status);

  // 6-9. Створення та публічне читання конкретного запису
  const alicePost = await req("POST", CONFIG.resource, tokens.alice, CONFIG.newItem);
  check("alice: POST свого", alicePost.status === 201, 201, alicePost.status);
  const aliceId = alicePost.json.id;

  const aliceGetOwn = await req("GET", `${CONFIG.resource}/${aliceId}`, tokens.alice);
  check("alice: GET свого", aliceGetOwn.status === 200, 200, aliceGetOwn.status);

  const noTokenGetItem = await req("GET", `${CONFIG.resource}/${aliceId}`, null);
  check("без токена: GET конкретного (публічне)", noTokenGetItem.status === 200, 200, noTokenGetItem.status);

  const bobPost = await req("POST", CONFIG.resource, tokens.bob, CONFIG.newItem);
  check("bob: POST свого", bobPost.status === 201, 201, bobPost.status);
  const bobId = bobPost.json.id;

  // 10-13. Видалення (перевірка власника)
  const bobDelAlice = await req("DELETE", `${CONFIG.resource}/${aliceId}`, tokens.bob);
  check("bob: DELETE чужого", bobDelAlice.status === 403, 403, bobDelAlice.status);

  const aliceDelBob = await req("DELETE", `${CONFIG.resource}/${bobId}`, tokens.alice);
  check("alice: DELETE чужого", aliceDelBob.status === 403, 403, aliceDelBob.status);

  const aliceDelOwn = await req("DELETE", `${CONFIG.resource}/${aliceId}`, tokens.alice);
  check("alice: DELETE свого", aliceDelOwn.status === 204, 204, aliceDelOwn.status);

  const getDeleted = await req("GET", `${CONFIG.resource}/${aliceId}`);
  check("GET видаленого", getDeleted.status === 404, 404, getDeleted.status);

  // 14-17. Дочірня сутність (сеанси)
  const getChildList = await req("GET", `${CONFIG.resource}/${bobId}/${CONFIG.child}`);
  check("GET дочірніх (без токена)", getChildList.status === 200, 200, getChildList.status);

  const postChildNoToken = await req("POST", `${CONFIG.resource}/${bobId}/${CONFIG.child}`, null, CONFIG.newChild);
  check("POST дочірнього без токена", postChildNoToken.status === 401, 401, postChildNoToken.status);

  const alicePostChildBob = await req("POST", `${CONFIG.resource}/${bobId}/${CONFIG.child}`, tokens.alice, CONFIG.newChild);
  check("alice: POST дочірнього bob", alicePostChildBob.status === 403, 403, alicePostChildBob.status);

  const bobPostChildOwn = await req("POST", `${CONFIG.resource}/${bobId}/${CONFIG.child}`, tokens.bob, CONFIG.newChild);
  check("bob: POST дочірнього свого", bobPostChildOwn.status === 201, 201, bobPostChildOwn.status);

  // 18-19. Перевірка методів
  const patchRes = await req("PATCH", `${CONFIG.resource}/${bobId}`, tokens.bob, {});
  check("PATCH /:id -> 405", patchRes.status === 405, 405, patchRes.status);

  const putRes = await req("PUT", `${CONFIG.resource}/${bobId}`, tokens.bob, {});
  check("PUT /:id -> 405", putRes.status === 405, 405, putRes.status);

  // 20-22. Валідація
  const invalidPost = await req("POST", CONFIG.resource, tokens.alice, { title: "Без полів" });
  check("POST з поганим тілом", invalidPost.status === 400, 400, invalidPost.status);

  const invalidCursor = await req("GET", `${CONFIG.resource}?genre=драма&after=2005-01-01&cursor=bad`);
  check("GET з поганим cursor", invalidCursor.status === 400, 400, invalidCursor.status);

  const badLimit = await req("GET", `${CONFIG.resource}?genre=драма&after=2005-01-01&limit=-5`);
  check("GET з поганим limit", badLimit.status === 400, 400, badLimit.status);

  // 23-24. ДОДАНІ ПЕРЕВІРКИ З МЕТОДИЧКИ
  const getNotFound = await req("GET", `${CONFIG.resource}/999999`);
  check("GET неіснуючого фільму", getNotFound.status === 404, 404, getNotFound.status);

  const badDatePost = await req("POST", CONFIG.resource, tokens.alice, { ...CONFIG.newItem, premiere_on: "2026-02-31" });
  check("POST з неіснуючою датою", badDatePost.status === 400, 400, badDatePost.status);

  console.log(`\nПройшло ${passed} з ${total}`);
  if (passed !== 24) process.exit(1);
}

main().catch(console.error);