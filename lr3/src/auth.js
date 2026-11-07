const AUTH_URL = "https://identitytoolkit.googleapis.com/v1";

export async function userFromRequest(request, env) {
  const idToken = request.headers.get("authorization")?.replace(/^Bearer /i, "") ?? "";
  const r = await fetch(`${env.AUTH_URL || AUTH_URL}/accounts:lookup?key=${env.FIREBASE_API_KEY}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken }),
  });

  const data = await r.json();
  if (!r.ok) return { status: 401, error: `потрібен дійсний ID token: ${data.error?.message}` };
  
  // Проверяем срок действия токена вручную (Firebase accounts:lookup этого не делает)
  const { exp } = JSON.parse(atob(idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  if (exp * 1000 <= Date.now()) return { status: 401, error: "потрібен дійсний ID token: строк дії минув" };
  
  return { uid: data.users[0].localId };
}