const COOKIE_NAME = "mi_session";
const SESSION_HOURS = 12;
const PBKDF2_ITERATIONS = 20000;
const enc = new TextEncoder();

const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store", ...extra }
});

const bytesToBase64 = bytes => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};
const base64ToBytes = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
const randomBase64 = size => {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytesToBase64(bytes);
};
const sha256 = async value => bytesToBase64(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value))));
const safeEqual = (a, b) => {
  const aa = enc.encode(String(a || "")), bb = enc.encode(String(b || ""));
  let diff = aa.length ^ bb.length;
  const length = Math.max(aa.length, bb.length);
  for (let i = 0; i < length; i += 1) diff |= (aa[i % aa.length] || 0) ^ (bb[i % bb.length] || 0);
  return diff === 0;
};
const hashPassword = async (password, saltBase64, iterations = PBKDF2_ITERATIONS) => {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    hash: "SHA-256",
    salt: base64ToBytes(saltBase64),
    iterations
  }, key, 256);
  return bytesToBase64(new Uint8Array(bits));
};
const validUsername = username => /^[A-Za-z0-9._-]{3,32}$/.test(username);
const validPassword = password => typeof password === "string" && password.length > 0;
const nowIso = () => new Date().toISOString();
const cookieValue = (request, name) => {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
};
const sessionCookie = token => `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}`;
const clearCookie = () => `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
const requestIp = request => request.headers.get("CF-Connecting-IP") || "unknown";
const userAgent = request => (request.headers.get("User-Agent") || "").slice(0, 300);
const readJson = async request => {
  try { return await request.json(); } catch { return {}; }
};

async function ensureSchema(db) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      ip TEXT,
      user_agent TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at)`,
    `CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id INTEGER,
      action TEXT NOT NULL,
      target_user_id INTEGER,
      detail TEXT,
      ip TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS page_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      ip_hash TEXT NOT NULL,
      path TEXT NOT NULL,
      country TEXT,
      device TEXT,
      referrer TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_page_views_created ON page_views(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_page_views_ip ON page_views(ip_hash)`,
    `CREATE INDEX IF NOT EXISTS idx_page_views_user ON page_views(user_id)`
  ];
  for (const sql of statements) await db.prepare(sql).run();
  const userColumns = await db.prepare("PRAGMA table_info(users)").all();
  if (!(userColumns.results || []).some(column => column.name === "password_iterations")) {
    await db.prepare("ALTER TABLE users ADD COLUMN password_iterations INTEGER").run();
    await db.prepare("UPDATE users SET password_iterations=120000 WHERE password_iterations IS NULL").run();
  }
  await db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(nowIso()).run();
  await db.prepare("DELETE FROM page_views WHERE created_at < datetime('now','-180 days')").run();
}

async function audit(db, actor, action, target = null, detail = null, request = null) {
  await db.prepare("INSERT INTO audit_log(actor_user_id,action,target_user_id,detail,ip,created_at) VALUES(?,?,?,?,?,?)")
    .bind(actor?.id || null, action, target, detail, request ? requestIp(request) : null, nowIso()).run();
}

const deviceType = userAgentValue => {
  const ua = String(userAgentValue || "");
  if (/bot|crawler|spider|slurp/i.test(ua)) return "Bot";
  if (/ipad|tablet|kindle|silk/i.test(ua)) return "Tablet";
  if (/mobile|iphone|ipod|android/i.test(ua)) return "Mobile";
  return "Desktop";
};

async function trackVisit(context, user) {
  const { request, env } = context;
  const url = new URL(request.url);
  if (request.method !== "GET" || !(request.headers.get("accept") || "").includes("text/html")) return;
  const ip = requestIp(request);
  const salt = env.ANALYTICS_SALT || env.APP_PASSWORD || url.hostname;
  const ipHash = await sha256(salt + "|" + ip);
  let referrer = null;
  try {
    const value = request.headers.get("referer");
    if (value) {
      const parsed = new URL(value);
      if (parsed.origin !== url.origin) referrer = parsed.hostname.slice(0, 200);
    }
  } catch {}
  await env.AUTH_DB.prepare("INSERT INTO page_views(user_id,ip_hash,path,country,device,referrer,created_at) VALUES(?,?,?,?,?,?,?)")
    .bind(user?.id || null, ipHash, url.pathname.slice(0, 200), (request.cf?.country || request.headers.get("CF-IPCountry") || "Unknown").slice(0, 10), deviceType(request.headers.get("User-Agent")), referrer, nowIso()).run();
}

async function currentUser(context) {
  const token = cookieValue(context.request, COOKIE_NAME);
  if (!token) return null;
  const tokenHash = await sha256(token);
  return context.env.AUTH_DB.prepare(`
    SELECT u.id,u.username,u.role,u.active,u.last_login_at,s.expires_at
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>? AND u.active=1
  `).bind(tokenHash, nowIso()).first();
}

function basicAuthorized(request, env) {
  const expected = env.APP_PASSWORD;
  if (!expected) return false;
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Basic ")) return false;
  try {
    const decoded = atob(auth.slice(6));
    const split = decoded.indexOf(":");
    return split > -1 && safeEqual(decoded.slice(0, split), "test") && safeEqual(decoded.slice(split + 1), expected);
  } catch { return false; }
}

function basicChallenge() {
  return new Response("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Market Insight setup", charset="UTF-8"',
      "Cache-Control": "no-store"
    }
  });
}

function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin;
}

async function initialized(db) {
  const row = await db.prepare("SELECT COUNT(*) AS count FROM users").first();
  return Number(row?.count || 0) > 0;
}

async function requireAdmin(context) {
  const user = await currentUser(context);
  if (!user) return { response: json({ error: "Authentication required" }, 401) };
  if (user.role !== "admin") return { response: json({ error: "Administrator access required" }, 403) };
  return { user };
}

async function handleApi(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method !== "GET" && !sameOrigin(request)) return json({ error: "Invalid request origin" }, 403);

  if (path === "/api/auth/status" && request.method === "GET") {
    return json({ backendConfigured: true, initialized: await initialized(env.AUTH_DB) });
  }

  if (path === "/api/auth/bootstrap" && request.method === "POST") {
    if (await initialized(env.AUTH_DB)) return json({ error: "Initial administrator already exists" }, 409);
    const body = await readJson(request);
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const bootstrapPassword = String(body.bootstrapPassword || "");
    const allowed = (env.APP_PASSWORD && safeEqual(bootstrapPassword, env.APP_PASSWORD)) ||
      (env.ADMIN_SETUP_TOKEN && safeEqual(bootstrapPassword, env.ADMIN_SETUP_TOKEN));
    if (!allowed) return json({ error: "Current site password is incorrect" }, 403);
    if (!validUsername(username)) return json({ error: "Username must be 3–32 characters using letters, numbers, dot, dash or underscore" }, 400);
    if (!validPassword(password)) return json({ error: "Password cannot be empty" }, 400);
    const salt = randomBase64(16);
    const passwordHash = await hashPassword(password, salt);
    const created = nowIso();
    const result = await env.AUTH_DB.prepare("INSERT INTO users(username,password_hash,password_salt,password_iterations,role,active,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)")
      .bind(username, passwordHash, salt, PBKDF2_ITERATIONS, "admin", created, created).run();
    await audit(env.AUTH_DB, null, "bootstrap_admin", Number(result.meta.last_row_id), username, request);
    return json({ ok: true }, 201);
  }

  if (path === "/api/auth/login" && request.method === "POST") {
    const body = await readJson(request);
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const user = await env.AUTH_DB.prepare("SELECT * FROM users WHERE username=? COLLATE NOCASE").bind(username).first();
    const dummySalt = "AAAAAAAAAAAAAAAAAAAAAA==";
    const computed = await hashPassword(password, user?.password_salt || dummySalt, Number(user?.password_iterations || 120000));
    const locked = user?.locked_until && new Date(user.locked_until).getTime() > Date.now();
    if (!user || !user.active || locked || !safeEqual(computed, user.password_hash)) {
      if (user) {
        const attempts = Number(user.failed_attempts || 0) + 1;
        const lockedUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
        await env.AUTH_DB.prepare("UPDATE users SET failed_attempts=?,locked_until=?,updated_at=? WHERE id=?")
          .bind(attempts >= 5 ? 0 : attempts, lockedUntil, nowIso(), user.id).run();
        await audit(env.AUTH_DB, user, "login_failed", user.id, lockedUntil ? "Account locked for 15 minutes" : null, request);
      }
      return json({ error: locked ? "Account is temporarily locked" : "Invalid username or password" }, 401);
    }
    const token = randomBase64(32);
    const tokenHash = await sha256(token);
    const expires = new Date(Date.now() + SESSION_HOURS * 3600 * 1000).toISOString();
    const time = nowIso();
    await env.AUTH_DB.batch([
      env.AUTH_DB.prepare("INSERT INTO sessions(token_hash,user_id,created_at,expires_at,ip,user_agent) VALUES(?,?,?,?,?,?)")
        .bind(tokenHash, user.id, time, expires, requestIp(request), userAgent(request)),
      env.AUTH_DB.prepare("UPDATE users SET failed_attempts=0,locked_until=NULL,last_login_at=?,updated_at=? WHERE id=?")
        .bind(time, time, user.id)
    ]);
    await audit(env.AUTH_DB, user, "login_success", user.id, null, request);
    return json({ ok: true, user: { id: user.id, username: user.username, role: user.role } }, 200, { "Set-Cookie": sessionCookie(token) });
  }

  if (path === "/api/auth/logout" && request.method === "POST") {
    const token = cookieValue(request, COOKIE_NAME);
    const user = await currentUser(context);
    if (token) await env.AUTH_DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await sha256(token)).run();
    if (user) await audit(env.AUTH_DB, user, "logout", user.id, null, request);
    return json({ ok: true }, 200, { "Set-Cookie": clearCookie() });
  }

  if (path === "/api/auth/me" && request.method === "GET") {
    const user = await currentUser(context);
    return user ? json({ user }) : json({ error: "Authentication required" }, 401);
  }

  if (path === "/api/auth/change-password" && request.method === "POST") {
    const user = await currentUser(context);
    if (!user) return json({ error: "Authentication required" }, 401);
    const body = await readJson(request);
    const currentPassword = String(body.currentPassword || "");
    const newPassword = String(body.newPassword || "");
    if (!validPassword(newPassword)) return json({ error: "New password cannot be empty" }, 400);
    const record = await env.AUTH_DB.prepare("SELECT password_hash,password_salt,password_iterations FROM users WHERE id=?").bind(user.id).first();
    const computed = await hashPassword(currentPassword, record.password_salt, Number(record.password_iterations || 120000));
    if (!safeEqual(computed, record.password_hash)) return json({ error: "Current password is incorrect" }, 403);
    const salt = randomBase64(16), passwordHash = await hashPassword(newPassword, salt);
    await env.AUTH_DB.batch([
      env.AUTH_DB.prepare("UPDATE users SET password_hash=?,password_salt=?,password_iterations=?,updated_at=? WHERE id=?").bind(passwordHash, salt, PBKDF2_ITERATIONS, nowIso(), user.id),
      env.AUTH_DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(user.id)
    ]);
    await audit(env.AUTH_DB, user, "password_changed", user.id, null, request);
    return json({ ok: true }, 200, { "Set-Cookie": clearCookie() });
  }

  if (path === "/api/admin/users" && request.method === "GET") {
    const auth = await requireAdmin(context);
    if (auth.response) return auth.response;
    const result = await env.AUTH_DB.prepare("SELECT id,username,role,active,created_at,updated_at,last_login_at,locked_until FROM users ORDER BY username COLLATE NOCASE").all();
    return json({ users: result.results || [], currentUserId: auth.user.id });
  }

  if (path === "/api/admin/users" && request.method === "POST") {
    const auth = await requireAdmin(context);
    if (auth.response) return auth.response;
    const body = await readJson(request);
    const username = String(body.username || "").trim(), password = String(body.password || ""), role = body.role === "admin" ? "admin" : "user";
    if (!validUsername(username)) return json({ error: "Username must be 3–32 characters using letters, numbers, dot, dash or underscore" }, 400);
    if (!validPassword(password)) return json({ error: "Password cannot be empty" }, 400);
    const salt = randomBase64(16), passwordHash = await hashPassword(password, salt), time = nowIso();
    try {
      const result = await env.AUTH_DB.prepare("INSERT INTO users(username,password_hash,password_salt,password_iterations,role,active,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)")
        .bind(username, passwordHash, salt, PBKDF2_ITERATIONS, role, time, time).run();
      await audit(env.AUTH_DB, auth.user, "user_created", Number(result.meta.last_row_id), username + " (" + role + ")", request);
      return json({ ok: true }, 201);
    } catch (error) {
      return json({ error: /unique/i.test(String(error)) ? "Username already exists" : "Unable to create user" }, 409);
    }
  }

  const userMatch = path.match(/^\/api\/admin\/users\/(\d+)\/(password|status|role|sessions)$/);
  if (userMatch && request.method === "POST") {
    const auth = await requireAdmin(context);
    if (auth.response) return auth.response;
    const targetId = Number(userMatch[1]), action = userMatch[2];
    const target = await env.AUTH_DB.prepare("SELECT id,username,role,active FROM users WHERE id=?").bind(targetId).first();
    if (!target) return json({ error: "User not found" }, 404);
    const body = await readJson(request);
    if (action === "password") {
      const password = String(body.password || "");
      if (!validPassword(password)) return json({ error: "Password cannot be empty" }, 400);
      const salt = randomBase64(16), passwordHash = await hashPassword(password, salt);
      await env.AUTH_DB.batch([
        env.AUTH_DB.prepare("UPDATE users SET password_hash=?,password_salt=?,password_iterations=?,updated_at=? WHERE id=?").bind(passwordHash, salt, PBKDF2_ITERATIONS, nowIso(), targetId),
        env.AUTH_DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(targetId)
      ]);
      await audit(env.AUTH_DB, auth.user, "password_reset", targetId, target.username, request);
    } else if (action === "status") {
      const active = body.active ? 1 : 0;
      if (targetId === auth.user.id && !active) return json({ error: "You cannot suspend your own account" }, 400);
      await env.AUTH_DB.prepare("UPDATE users SET active=?,updated_at=? WHERE id=?").bind(active, nowIso(), targetId).run();
      if (!active) await env.AUTH_DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(targetId).run();
      await audit(env.AUTH_DB, auth.user, active ? "user_enabled" : "user_suspended", targetId, target.username, request);
    } else if (action === "role") {
      const role = body.role === "admin" ? "admin" : "user";
      if (targetId === auth.user.id && role !== "admin") return json({ error: "You cannot remove your own administrator role" }, 400);
      await env.AUTH_DB.prepare("UPDATE users SET role=?,updated_at=? WHERE id=?").bind(role, nowIso(), targetId).run();
      await audit(env.AUTH_DB, auth.user, "role_changed", targetId, target.username + " → " + role, request);
    } else {
      await env.AUTH_DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(targetId).run();
      await audit(env.AUTH_DB, auth.user, "sessions_revoked", targetId, target.username, request);
    }
    return json({ ok: true });
  }

  const deleteMatch = path.match(/^\/api\/admin\/users\/(\d+)$/);
  if (deleteMatch && request.method === "DELETE") {
    const auth = await requireAdmin(context);
    if (auth.response) return auth.response;
    const targetId = Number(deleteMatch[1]);
    if (targetId === auth.user.id) return json({ error: "You cannot delete your own account" }, 400);
    const target = await env.AUTH_DB.prepare("SELECT username,role FROM users WHERE id=?").bind(targetId).first();
    if (!target) return json({ error: "User not found" }, 404);
    if (target.role === "admin") {
      const admins = await env.AUTH_DB.prepare("SELECT COUNT(*) AS count FROM users WHERE role='admin' AND active=1").first();
      if (Number(admins?.count || 0) <= 1) return json({ error: "At least one active administrator is required" }, 400);
    }
    await audit(env.AUTH_DB, auth.user, "user_deleted", targetId, target.username, request);
    await env.AUTH_DB.prepare("DELETE FROM users WHERE id=?").bind(targetId).run();
    return json({ ok: true });
  }

  if (path === "/api/admin/traffic" && request.method === "GET") {
    const auth = await requireAdmin(context);
    if (auth.response) return auth.response;
    const requestedDays = Number(url.searchParams.get("days") || 30);
    const days = Math.min(180, Math.max(1, Number.isFinite(requestedDays) ? Math.floor(requestedDays) : 30));
    const requestedUserId = Number(url.searchParams.get("userId"));
    const userId = Number.isInteger(requestedUserId) && requestedUserId > 0 ? requestedUserId : null;
    if (userId) {
      const selectedUser = await env.AUTH_DB.prepare("SELECT id FROM users WHERE id=?").bind(userId).first();
      if (!selectedUser) return json({ error: "Selected user was not found" }, 404);
    }
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const today = new Date().toISOString().slice(0, 10);
    const [summary, todayStats, daily, pages, countries, devices, referrers, recent] = await Promise.all([
      env.AUTH_DB.prepare(`SELECT COUNT(*) visits,COUNT(DISTINCT ip_hash) unique_visitors,COUNT(DISTINCT user_id) signed_in_users FROM page_views WHERE created_at>=? AND (? IS NULL OR user_id=?)`).bind(since,userId,userId).first(),
      env.AUTH_DB.prepare("SELECT COUNT(*) visits,COUNT(DISTINCT ip_hash) unique_visitors FROM page_views WHERE substr(created_at,1,10)=? AND (? IS NULL OR user_id=?)").bind(today,userId,userId).first(),
      env.AUTH_DB.prepare(`SELECT substr(created_at,1,10) day,COUNT(*) visits,COUNT(DISTINCT ip_hash) unique_visitors FROM page_views WHERE created_at>=? AND (? IS NULL OR user_id=?) GROUP BY day ORDER BY day`).bind(since,userId,userId).all(),
      env.AUTH_DB.prepare(`SELECT path,COUNT(*) visits,COUNT(DISTINCT ip_hash) unique_visitors FROM page_views WHERE created_at>=? AND (? IS NULL OR user_id=?) GROUP BY path ORDER BY visits DESC LIMIT 20`).bind(since,userId,userId).all(),
      env.AUTH_DB.prepare(`SELECT COALESCE(country,'Unknown') label,COUNT(*) visits,COUNT(DISTINCT ip_hash) unique_visitors FROM page_views WHERE created_at>=? AND (? IS NULL OR user_id=?) GROUP BY label ORDER BY visits DESC LIMIT 20`).bind(since,userId,userId).all(),
      env.AUTH_DB.prepare(`SELECT COALESCE(device,'Unknown') label,COUNT(*) visits FROM page_views WHERE created_at>=? AND (? IS NULL OR user_id=?) GROUP BY label ORDER BY visits DESC`).bind(since,userId,userId).all(),
      env.AUTH_DB.prepare(`SELECT COALESCE(referrer,'Direct') label,COUNT(*) visits FROM page_views WHERE created_at>=? AND (? IS NULL OR user_id=?) GROUP BY label ORDER BY visits DESC LIMIT 20`).bind(since,userId,userId).all(),
      env.AUTH_DB.prepare(`SELECT p.path,p.country,p.device,p.referrer,p.created_at,u.username FROM page_views p LEFT JOIN users u ON u.id=p.user_id WHERE (? IS NULL OR p.user_id=?) ORDER BY p.id DESC LIMIT 50`).bind(userId,userId).all()
    ]);
    return json({
      days, selectedUserId: userId,
      summary: { visits: Number(summary?.visits || 0), uniqueVisitors: Number(summary?.unique_visitors || 0), signedInUsers: Number(summary?.signed_in_users || 0) },
      today: { visits: Number(todayStats?.visits || 0), uniqueVisitors: Number(todayStats?.unique_visitors || 0) },
      daily: daily.results || [], pages: pages.results || [], countries: countries.results || [],
      devices: devices.results || [], referrers: referrers.results || [], recent: recent.results || []
    });
  }

  if (path === "/api/admin/audit" && request.method === "GET") {
    const auth = await requireAdmin(context);
    if (auth.response) return auth.response;
    const result = await env.AUTH_DB.prepare(`
      SELECT a.id,a.action,a.detail,a.ip,a.created_at,
        actor.username AS actor_username,target.username AS target_username
      FROM audit_log a
      LEFT JOIN users actor ON actor.id=a.actor_user_id
      LEFT JOIN users target ON target.id=a.target_user_id
      ORDER BY a.id DESC LIMIT 100
    `).all();
    return json({ events: result.results || [] });
  }

  return json({ error: "Not found" }, 404);
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (!env.AUTH_DB) {
    if (url.pathname.startsWith("/api/")) return json({ error: "AUTH_DB binding is not configured" }, 503);
    if (!env.APP_PASSWORD || basicAuthorized(request, env)) {
      const response = await context.next();
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "private, no-store");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
    return basicChallenge();
  }

  try {
    await ensureSchema(env.AUTH_DB);
    if (url.pathname.startsWith("/api/")) return await handleApi(context);
  } catch (error) {
    console.error("Authentication backend error", error);
    if (url.pathname.startsWith("/api/")) return json({ error: "Authentication backend error. Verify the production D1 binding and retry the deployment." }, 500);
    return new Response("Authentication backend error", { status: 500, headers: { "Cache-Control": "no-store" } });
  }

  const publicPaths = new Set(["/login", "/login.html", "/icon-192.png", "/icon-512.png", "/app-icon-192-v2.png", "/app-icon-512-v2.png", "/favicon-48.png", "/logo-full.jpg", "/manifest.webmanifest", "/sw.js"]);
  if (publicPaths.has(url.pathname)) return context.next();

  const hasUsers = await initialized(env.AUTH_DB);
  if (!hasUsers) {
    if (basicAuthorized(request, env)) return context.next();
    if (url.pathname === "/" || url.pathname === "/index.html") return Response.redirect(url.origin + "/login", 302);
    return basicChallenge();
  }

  const user = await currentUser(context);
  if (!user) return Response.redirect(url.origin + "/login?next=" + encodeURIComponent(url.pathname + url.search), 302);
  if ((url.pathname === "/admin" || url.pathname === "/admin.html") && user.role !== "admin") return Response.redirect(url.origin + "/", 302);

  const response = await context.next();
  if (response.status < 400) {
    const visitPromise = trackVisit(context, user).catch(error => console.error("Traffic tracking error", error));
    if (context.waitUntil) context.waitUntil(visitPromise);
    else await visitPromise;
  }
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "same-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
