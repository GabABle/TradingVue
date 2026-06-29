// ---------------------------------------------------------------------------
// Fully client-side data layer.
//
// All user state (accounts, watchlists, preferences, portfolio tags, alerts)
// is stored in the browser's localStorage. There is NO server-side database,
// so application upgrades / redeploys can never wipe a user's accounts or data.
//
// `handleLocalApi` emulates the old REST endpoints the components still call
// (via AuthContext.authFetch), returning a synthetic Response. Anything it does
// not recognise (e.g. /api/market/*, /api/chat) returns null so the caller
// falls through to a real network fetch against the stateless market proxy.
// ---------------------------------------------------------------------------

export interface LocalUser {
  userId: number;
  username: string;
}

interface StoredUser {
  id: number;
  username: string;
  salt: string;
  hash: string;
}

export interface LocalAlert {
  id: string;
  symbol: string;
  targetPrice: number;
  condition: "above" | "below";
  email: string;
  createdAt: string;
  triggered?: boolean;
}

const USERS_KEY   = "tv_local_users";
const SESSION_KEY = "tv_local_session";

const USERNAME_RE = /^[A-Za-z0-9_.-]{3,50}$/;

// -- small crypto helpers ----------------------------------------------------
function randomHex(bytes: number): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// -- JSON storage helpers ----------------------------------------------------
function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / unavailable - ignore */
  }
}

function getUsers(): StoredUser[] {
  return readJSON<StoredUser[]>(USERS_KEY, []);
}

// -- session -----------------------------------------------------------------
export interface Session {
  token: string;
  user: LocalUser;
}

export function getSession(): Session | null {
  return readJSON<Session | null>(SESSION_KEY, null);
}

function setSession(s: Session): void {
  writeJSON(SESSION_KEY, s);
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

function currentUserId(): number | null {
  return getSession()?.user.userId ?? null;
}

// -- auth --------------------------------------------------------------------
export async function registerLocal(username: string, password: string): Promise<Session> {
  const uname = username.trim();
  if (!USERNAME_RE.test(uname)) {
    throw new Error("Username: 3-50 chars, letters / numbers / _ . - only");
  }
  if (password.length < 6) {
    throw new Error("Password must be at least 6 characters");
  }
  const users = getUsers();
  if (users.some((u) => u.username.toLowerCase() === uname.toLowerCase())) {
    throw new Error("Username already taken");
  }
  const salt = randomHex(16);
  const hash = await hashPassword(password, salt);
  const id = users.reduce((max, u) => Math.max(max, u.id), 0) + 1;
  users.push({ id, username: uname, salt, hash });
  writeJSON(USERS_KEY, users);

  const session: Session = { token: `local.${id}.${randomHex(12)}`, user: { userId: id, username: uname } };
  setSession(session);
  return session;
}

export async function loginLocal(username: string, password: string): Promise<Session> {
  const uname = username.trim();
  const user = getUsers().find((u) => u.username.toLowerCase() === uname.toLowerCase());
  if (!user) throw new Error("Invalid username or password");
  const hash = await hashPassword(password, user.salt);
  if (hash !== user.hash) throw new Error("Invalid username or password");

  const session: Session = {
    token: `local.${user.id}.${randomHex(12)}`,
    user: { userId: user.id, username: user.username },
  };
  setSession(session);
  return session;
}

// -- per-user data accessors -------------------------------------------------
const wlKey     = (id: number) => `tv_local_watchlist_${id}`;
const prefsKey  = (id: number) => `tv_local_prefs_${id}`;
const pfKey     = (id: number) => `tv_local_portfolio_${id}`;
const alertsKey = (id: number) => `tv_local_alerts_${id}`;

export function getActiveAlerts(): LocalAlert[] {
  const id = currentUserId();
  if (id == null) return [];
  return readJSON<LocalAlert[]>(alertsKey(id), []).filter((a) => !a.triggered);
}

export function markAlertTriggered(alertId: string): void {
  const id = currentUserId();
  if (id == null) return;
  const list = readJSON<LocalAlert[]>(alertsKey(id), []).map((a) =>
    a.id === alertId ? { ...a, triggered: true } : a,
  );
  writeJSON(alertsKey(id), list);
}

// -- REST emulation ----------------------------------------------------------
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Emulates the legacy user/alert REST endpoints from localStorage.
 * Returns a Response for endpoints it owns, or null to let the caller perform
 * a real network request (market data, chat, trading proxy).
 */
export async function handleLocalApi(rawUrl: string, init: RequestInit = {}): Promise<Response | null> {
  let path: string;
  let search: URLSearchParams;
  try {
    const u = new URL(rawUrl, window.location.origin);
    path = u.pathname;
    search = u.searchParams;
  } catch {
    return null;
  }

  const method = (init.method ?? "GET").toUpperCase();

  // Strip an optional base path prefix so matching works under any BASE_URL.
  const apiIdx = path.indexOf("/api/");
  if (apiIdx === -1) return null;
  const route = path.slice(apiIdx); // e.g. "/api/user/watchlist"

  const id = currentUserId();
  const needsUser = route.startsWith("/api/user/") || route.startsWith("/api/alerts");
  if (needsUser && id == null) return json({ error: "Not authenticated" }, 401);

  let body: any = undefined;
  if (init.body != null) {
    try { body = JSON.parse(String(init.body)); } catch { body = undefined; }
  }

  // -- /api/user/watchlist --
  if (route === "/api/user/watchlist") {
    if (method === "GET") {
      const data = readJSON<unknown>(wlKey(id!), null);
      if (data == null) return json({ sections: null });
      return json({ sections: data });
    }
    if (method === "PUT") {
      const data = body?.sections ?? body?.symbols;
      if (!Array.isArray(data)) return json({ error: "sections must be an array" }, 400);
      writeJSON(wlKey(id!), data);
      return json({ success: true });
    }
  }

  // -- /api/user/preferences --
  if (route === "/api/user/preferences") {
    if (method === "GET") return json({ state: readJSON<object>(prefsKey(id!), {}) });
    if (method === "PUT") {
      if (!body?.state || typeof body.state !== "object") return json({ error: "state must be an object" }, 400);
      writeJSON(prefsKey(id!), body.state);
      return json({ success: true });
    }
  }

  // -- /api/user/portfolio --
  if (route === "/api/user/portfolio" && method === "GET") {
    const syms = readJSON<string[]>(pfKey(id!), []);
    return json({ symbols: [...syms].sort() });
  }
  if (route.startsWith("/api/user/portfolio/")) {
    const symbol = decodeURIComponent(route.slice("/api/user/portfolio/".length)).toUpperCase();
    const syms = new Set(readJSON<string[]>(pfKey(id!), []));
    if (method === "PUT") { syms.add(symbol); writeJSON(pfKey(id!), [...syms]); return json({ success: true }); }
    if (method === "DELETE") { syms.delete(symbol); writeJSON(pfKey(id!), [...syms]); return json({ success: true }); }
  }

  // -- /api/alerts -- (feature deprecated: always empty, writes are no-ops) --
  if (route === "/api/alerts") {
    if (method === "GET") return json({ alerts: [] });
    if (method === "POST") return json({ error: "Alerts are currently unavailable" }, 503);
  }
  if (route.startsWith("/api/alerts/") && method === "DELETE") {
    return json({ success: true });
  }

  // Not a local endpoint - let the caller hit the network (market/chat/trading).
  return null;
}
