// Before editing, read CLAUDE.md at the repo root, especially "Client".
// Talks to the server and keeps this tab's session in sessionStorage.
const KEYS = { token: "bird-token", room: "bird-room", name: "bird-name" };
export const session = {
  get(key) {
    try {
      return sessionStorage.getItem(KEYS[key]);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      sessionStorage.setItem(KEYS[key], value);
    } catch {}
  },
  remove(key) {
    try {
      sessionStorage.removeItem(KEYS[key]);
    } catch {}
  },
};
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}
export async function api(path, data) {
  const token = session.get("token");
  const res = await fetch("/api/" + path, {
    method: data ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  let result = {};
  try {
    result = await res.json();
  } catch {}
  if (!res.ok) throw new ApiError(result.error || "Connection failed.", res.status);
  return result;
}
