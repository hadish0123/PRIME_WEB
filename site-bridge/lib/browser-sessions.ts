import { env } from "cloudflare:workers";

const SESSION_TTL_MS = 15 * 60 * 1000;
const ENCRYPTION_AAD = new TextEncoder().encode("prime-browser-session:v1");

type Credentials = {
  username: string;
  password: string;
};

type SessionRow = {
  id: string;
  target_url: string;
  target_host: string;
  task: string;
  browser_provider: string;
  engine_session_id: string | null;
  credentials_ciphertext: string | null;
  status: string;
  created_at: number;
  expires_at: number;
};

export type BrowserSessionSummary = {
  id: string;
  targetUrl: string;
  targetHost: string;
  task: string;
  browserProvider: string;
  status: string;
  createdAt: string;
  expiresAt: string;
};

function requireDb(): D1Database {
  if (!env.DB) {
    throw new Error("فضای امن نشست‌های مرورگر در دسترس نیست.");
  }
  return env.DB;
}

function requireEncryptionSecret(): string {
  const secret = env.BROWSER_SESSION_ENCRYPTION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("رمزگذاری نشست‌های مرورگر هنوز پیکربندی نشده است.");
  }
  return secret;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function encryptionKey(): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(requireEncryptionSecret()),
  );
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptCredentials(credentials: Credentials): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(credentials));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: ENCRYPTION_AAD },
    await encryptionKey(),
    plaintext,
  );
  return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(ciphertext))}`;
}

async function decryptCredentials(payload: string): Promise<Credentials> {
  const [version, ivValue, cipherValue] = payload.split(".");
  if (version !== "v1" || !ivValue || !cipherValue) {
    throw new Error("نشست رمزگذاری‌شده معتبر نیست.");
  }
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64UrlToBytes(ivValue),
      additionalData: ENCRYPTION_AAD,
    },
    await encryptionKey(),
    base64UrlToBytes(cipherValue),
  );
  const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as Partial<Credentials>;
  if (typeof parsed.username !== "string" || typeof parsed.password !== "string") {
    throw new Error("محتوای نشست رمزگذاری‌شده معتبر نیست.");
  }
  return { username: parsed.username, password: parsed.password };
}

function isForbiddenHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "0.0.0.0" ||
    host === "::" ||
    host === "::1" ||
    host === "169.254.169.254"
  ) {
    return true;
  }

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u);
  if (!ipv4) return false;
  const octets = ipv4.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) return true;
  const [a, b] = octets;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

export function normalizeTargetUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("آدرس سایت معتبر نیست.");
  }
  if (url.protocol !== "https:") {
    throw new Error("برای امنیت، فقط آدرس‌های عمومی HTTPS پذیرفته می‌شوند.");
  }
  if (url.username || url.password) {
    throw new Error("نام کاربری و رمز را داخل خود آدرس قرار ندهید.");
  }
  if (isForbiddenHostname(url.hostname)) {
    throw new Error("آدرس‌های محلی، خصوصی و سرویس‌های داخلی مجاز نیستند.");
  }
  url.hash = "";
  return url;
}

function cleanTask(value: string): string {
  const task = value.trim().replace(/\u0000/gu, "").slice(0, 2_000);
  return task || "وارد پنل شو و ورود، مسیرهای اصلی و دکمه‌های غیرمخرب را آزمایش کن.";
}

export async function cleanupExpiredSessions(userId?: string): Promise<void> {
  const now = Date.now();
  const db = requireDb();
  if (userId) {
    await db
      .prepare(
        `UPDATE browser_sessions
         SET status = 'expired', credentials_ciphertext = NULL, updated_at = ?
         WHERE user_id = ? AND expires_at <= ? AND status IN ('pending', 'claimed', 'active')`,
      )
      .bind(now, userId, now)
      .run();
    return;
  }
  await db
    .prepare(
      `UPDATE browser_sessions
       SET status = 'expired', credentials_ciphertext = NULL, updated_at = ?
       WHERE expires_at <= ? AND status IN ('pending', 'claimed', 'active')`,
    )
    .bind(now, now)
    .run();
}

export async function createBrowserSession(input: {
  userId: string;
  targetUrl: string;
  username: string;
  password: string;
  task: string;
  browserProvider: "prime";
}): Promise<BrowserSessionSummary> {
  const url = normalizeTargetUrl(input.targetUrl);
  const username = input.username.trim().slice(0, 512);
  const password = input.password.slice(0, 4_096);
  if (!username || !password) {
    throw new Error("نام کاربری و رمز عبور الزامی است.");
  }

  await cleanupExpiredSessions(input.userId);
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  const id = crypto.randomUUID();
  const task = cleanTask(input.task);
  const ciphertext = await encryptCredentials({ username, password });

  await requireDb()
    .prepare(
      `INSERT INTO browser_sessions (
        id, user_id, target_url, target_host, task, browser_provider, credentials_ciphertext,
        status, created_at, updated_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    )
    .bind(
      id,
      input.userId,
      url.toString(),
      url.host,
      task,
      input.browserProvider,
      ciphertext,
      now,
      now,
      expiresAt,
    )
    .run();

  return {
    id,
    targetUrl: url.toString(),
    targetHost: url.host,
    task,
    browserProvider: input.browserProvider,
    status: "pending",
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

export async function claimBrowserSession(input: { userId: string; sessionId: string }) {
  await cleanupExpiredSessions(input.userId);
  const db = requireDb();
  const row = await db
    .prepare(
      `SELECT id, target_url, target_host, task, browser_provider, credentials_ciphertext, status, created_at, expires_at
       FROM browser_sessions
       WHERE id = ? AND user_id = ? AND status = 'pending' AND expires_at > ?
       LIMIT 1`,
    )
    .bind(input.sessionId, input.userId, Date.now())
    .first<SessionRow>();

  if (!row?.credentials_ciphertext) {
    throw new Error("این نشست وجود ندارد، منقضی شده یا قبلاً تحویل مرورگر شده است.");
  }

  const claimedAt = Date.now();
  const claimed = await db
    .prepare(
      `UPDATE browser_sessions
       SET status = 'claimed', claimed_at = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND status = 'pending'`,
    )
    .bind(claimedAt, claimedAt, input.sessionId, input.userId)
    .run();

  if ((claimed.meta.changes ?? 0) !== 1) {
    throw new Error("این نشست هم‌اکنون توسط یک مرورگر دیگر دریافت شده است.");
  }

  try {
    const credentials = await decryptCredentials(row.credentials_ciphertext);
    return {
      sessionId: row.id,
      targetUrl: row.target_url,
      targetHost: row.target_host,
      task: row.task,
      browserProvider: row.browser_provider,
      username: credentials.username,
      password: credentials.password,
      expiresAt: new Date(row.expires_at).toISOString(),
    };
  } catch (error) {
    await db
      .prepare(
        `UPDATE browser_sessions
         SET status = 'failed', credentials_ciphertext = NULL, updated_at = ?, completed_at = ?
         WHERE id = ? AND user_id = ?`,
      )
      .bind(Date.now(), Date.now(), input.sessionId, input.userId)
      .run();
    throw error;
  }
}

export async function activateBrowserSession(input: {
  userId: string;
  sessionId: string;
  engineSessionId: string;
}): Promise<void> {
  const now = Date.now();
  const result = await requireDb()
    .prepare(
      `UPDATE browser_sessions
       SET status = 'active', engine_session_id = ?, credentials_ciphertext = NULL, updated_at = ?
       WHERE id = ? AND user_id = ? AND status = 'claimed' AND expires_at > ?`,
    )
    .bind(input.engineSessionId, now, input.sessionId, input.userId, now)
    .run();
  if ((result.meta.changes ?? 0) !== 1) {
    throw new Error("نشست امن برای فعال‌سازی مرورگر پیدا نشد.");
  }
}

export async function getActiveEngineSession(input: {
  userId: string;
  sessionId: string;
}): Promise<string> {
  await cleanupExpiredSessions(input.userId);
  const row = await requireDb()
    .prepare(
      `SELECT engine_session_id
       FROM browser_sessions
       WHERE id = ? AND user_id = ? AND status = 'active' AND expires_at > ?
       LIMIT 1`,
    )
    .bind(input.sessionId, input.userId, Date.now())
    .first<{ engine_session_id: string | null }>();
  if (!row?.engine_session_id) {
    throw new Error("نشست مرورگر فعال نیست یا منقضی شده است.");
  }
  return row.engine_session_id;
}

export async function finishBrowserSession(input: {
  userId: string;
  sessionId: string;
  status: "completed" | "blocked" | "failed" | "cancelled";
  summary?: string;
  challenge?: string;
}): Promise<void> {
  const now = Date.now();
  const result = await requireDb()
    .prepare(
      `UPDATE browser_sessions
       SET status = ?, result_summary = ?, challenge = ?, credentials_ciphertext = NULL,
           updated_at = ?, completed_at = ?
       WHERE id = ? AND user_id = ? AND status IN ('pending', 'claimed', 'active')`,
    )
    .bind(
      input.status,
      input.summary?.trim().slice(0, 4_000) || null,
      input.challenge?.trim().slice(0, 1_000) || null,
      now,
      now,
      input.sessionId,
      input.userId,
    )
    .run();
  if ((result.meta.changes ?? 0) !== 1) {
    throw new Error("نشست فعال برای پایان‌دادن پیدا نشد.");
  }
}

export async function listActiveSessions(userId: string): Promise<BrowserSessionSummary[]> {
  await cleanupExpiredSessions(userId);
  const result = await requireDb()
    .prepare(
      `SELECT id, target_url, target_host, task, browser_provider, status, created_at, expires_at
       FROM browser_sessions
       WHERE user_id = ? AND status IN ('pending', 'claimed', 'active') AND expires_at > ?
       ORDER BY created_at DESC
       LIMIT 10`,
    )
    .bind(userId, Date.now())
    .all<Omit<SessionRow, "credentials_ciphertext">>();

  return result.results.map((row) => ({
    id: row.id,
    targetUrl: row.target_url,
    targetHost: row.target_host,
    task: row.task,
    browserProvider: row.browser_provider,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
  }));
}
