import { createServer } from "node:http";
import { lookup } from "node:dns/promises";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chromium } from "playwright";
import {
  classifyElementAction,
  isForbiddenHostname,
  isPrivateIp,
  normalizePublicHttpsUrl,
  redactText,
} from "./policy.js";

const PORT = Number(process.env.PORT || 3000);
const ENGINE_TOKEN = process.env.BROWSER_ENGINE_TOKEN || "";
const SESSION_TTL_MS = Math.min(Math.max(Number(process.env.SESSION_TTL_MS || 900_000), 60_000), 3_600_000);
const MAX_SESSIONS = Math.min(Math.max(Number(process.env.MAX_SESSIONS || 3), 1), 10);
const BODY_LIMIT = 96 * 1024;
const sessions = new Map();
const dnsCache = new Map();
let browserPromise;

function json(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(payload);
}

function safeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function authorized(request) {
  if (ENGINE_TOKEN.length < 32) return false;
  const header = request.headers.authorization || "";
  return header.startsWith("Bearer ") && safeEqual(header.slice(7), ENGINE_TOKEN);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw Object.assign(new Error("body_too_large"), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("invalid_json"), { status: 400 });
  }
}

async function ensurePublicHostname(hostname) {
  if (isForbiddenHostname(hostname)) throw new Error("private_network_blocked");
  const cached = dnsCache.get(hostname);
  if (cached && cached.expiresAt > Date.now()) {
    if (!cached.safe) throw new Error("private_network_blocked");
    return;
  }
  const records = await lookup(hostname, { all: true, verbatim: true });
  const safe = records.length > 0 && records.every((record) => !isPrivateIp(record.address));
  dnsCache.set(hostname, { safe, expiresAt: Date.now() + 60_000 });
  if (!safe) throw new Error("private_network_blocked");
}

async function browserInstance() {
  browserPromise ||= chromium.launch({
    headless: true,
    args: ["--disable-dev-shm-usage", "--disable-background-networking"],
  });
  return browserPromise;
}

async function closeSession(session) {
  if (!session || session.closed) return;
  session.closed = true;
  sessions.delete(session.id);
  await session.context.close().catch(() => {});
}

function requireSession(id) {
  const session = sessions.get(id);
  if (!session || session.closed || session.expiresAt <= Date.now()) {
    if (session) void closeSession(session);
    throw Object.assign(new Error("session_not_found_or_expired"), { status: 404 });
  }
  return session;
}

function sanitizeRef(value) {
  if (!/^pr-\d{1,4}$/u.test(String(value))) throw Object.assign(new Error("invalid_element_ref"), { status: 400 });
  return String(value);
}

async function elementDetails(page, ref) {
  return page.locator(`[data-prime-ref="${sanitizeRef(ref)}"]`).first().evaluate((element) => {
    const html = /** @type {HTMLElement} */ (element);
    const label = html.getAttribute("aria-label") || html.innerText || html.getAttribute("placeholder") || html.getAttribute("title") || html.getAttribute("name") || "";
    return {
      tag: html.tagName.toLowerCase(),
      role: html.getAttribute("role") || "",
      type: html.getAttribute("type") || "",
      label: label.trim().replace(/\s+/g, " ").slice(0, 240),
      name: html.getAttribute("name") || "",
      title: html.getAttribute("title") || "",
      href: html instanceof HTMLAnchorElement ? html.href : "",
    };
  });
}

async function observe(session, extraSecrets = []) {
  const page = session.page;
  const result = await page.evaluate(() => {
    document.querySelectorAll("[data-prime-ref]").forEach((element) => element.removeAttribute("data-prime-ref"));
    const candidates = Array.from(document.querySelectorAll("a,button,input,select,textarea,[role='button'],[role='link'],[contenteditable='true']"));
    const elements = [];
    let sequence = 1;
    for (const element of candidates) {
      if (elements.length >= 120) break;
      const html = /** @type {HTMLElement} */ (element);
      const style = getComputedStyle(html);
      const rect = html.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || rect.width < 2 || rect.height < 2) continue;
      const ref = `pr-${sequence++}`;
      html.setAttribute("data-prime-ref", ref);
      let label = html.getAttribute("aria-label") || html.innerText || html.getAttribute("placeholder") || html.getAttribute("title") || html.getAttribute("name") || "";
      label = label.trim().replace(/\s+/g, " ").slice(0, 240);
      elements.push({
        ref,
        tag: html.tagName.toLowerCase(),
        role: html.getAttribute("role") || "",
        type: html.getAttribute("type") || "",
        label,
        name: html.getAttribute("name") || "",
        href: html instanceof HTMLAnchorElement ? html.href : "",
        disabled: "disabled" in html ? Boolean(html.disabled) : false,
      });
    }
    return {
      title: document.title,
      text: (document.body?.innerText || "").replace(/\n{3,}/g, "\n\n").slice(0, 20_000),
      elements,
    };
  });
  const secrets = [...session.redactions, ...extraSecrets];
  return {
    url: session.page.url(),
    title: redactText(result.title, secrets),
    text: redactText(result.text, secrets),
    elements: result.elements.map((element) => ({
      ...element,
      label: redactText(element.label, secrets),
      name: redactText(element.name, secrets),
    })),
    expiresAt: new Date(session.expiresAt).toISOString(),
  };
}

async function settle(page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 8_000 }).catch(() => {});
  await page.waitForTimeout(700);
}

async function performClick(session, ref) {
  const locator = session.page.locator(`[data-prime-ref="${sanitizeRef(ref)}"]`).first();
  if (!(await locator.isVisible().catch(() => false))) throw Object.assign(new Error("element_not_visible"), { status: 404 });
  await locator.click({ timeout: 10_000 });
  await settle(session.page);
  return observe(session);
}

async function autoLogin(session, username, password) {
  const page = session.page;
  if (new URL(page.url()).origin !== session.allowedOrigin) throw new Error("login_origin_changed");
  const passwordInput = page.locator("input[type='password']").filter({ visible: true }).first();
  if (!(await passwordInput.isVisible().catch(() => false))) {
    return { attempted: false, reason: "password_field_not_found" };
  }
  const form = passwordInput.locator("xpath=ancestor::form[1]");
  if ((await form.count()) > 0) {
    const action = await form.getAttribute("action");
    if (action && new URL(action, page.url()).origin !== session.allowedOrigin) throw new Error("external_login_action_blocked");
  }
  const scope = (await form.count()) > 0 ? form : page.locator("body");
  const usernameInput = scope.locator("input[autocomplete='username'],input[type='email'],input[name*='user' i],input[name*='email' i],input[type='text']").filter({ visible: true }).first();
  if (!(await usernameInput.isVisible().catch(() => false))) {
    return { attempted: false, reason: "username_field_not_found" };
  }
  await usernameInput.fill(username);
  await passwordInput.fill(password);
  const submit = scope.locator("button[type='submit'],input[type='submit'],button").filter({ visible: true }).first();
  if (!(await submit.isVisible().catch(() => false))) return { attempted: false, reason: "submit_control_not_found" };
  await submit.click({ timeout: 10_000 });
  await settle(page);
  return {
    attempted: true,
    passwordFieldVisible: await page.locator("input[type='password']").filter({ visible: true }).first().isVisible().catch(() => false),
  };
}

async function createBrowserSession(body) {
  if (sessions.size >= MAX_SESSIONS) throw Object.assign(new Error("session_capacity_reached"), { status: 429 });
  const target = normalizePublicHttpsUrl(body.targetUrl);
  await ensurePublicHostname(target.hostname);
  if (typeof body.username !== "string" || !body.username || body.username.length > 512) throw Object.assign(new Error("invalid_username"), { status: 400 });
  if (typeof body.password !== "string" || !body.password || body.password.length > 4096) throw Object.assign(new Error("invalid_password"), { status: 400 });

  const context = await (await browserInstance()).newContext({
    viewport: { width: 1440, height: 1000 },
    locale: "fa-IR",
    timezoneId: "Asia/Tehran",
    acceptDownloads: false,
  });
  const page = await context.newPage();
  const session = {
    id: randomUUID(),
    context,
    page,
    allowedOrigin: target.origin,
    targetUrl: target.toString(),
    task: typeof body.task === "string" ? body.task.slice(0, 2000) : "",
    redactions: [body.username],
    pendingAction: null,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
    closed: false,
    dialogs: [],
  };

  page.on("dialog", async (dialog) => {
    session.dialogs.push({ type: dialog.type(), message: dialog.message().slice(0, 500) });
    if (session.dialogs.length > 10) session.dialogs.shift();
    await dialog.dismiss().catch(() => {});
  });
  await page.route("**/*", async (route) => {
    try {
      const requestUrl = new URL(route.request().url());
      if (["data:", "blob:"].includes(requestUrl.protocol)) return route.continue();
      if (requestUrl.protocol !== "https:") return route.abort("blockedbyclient");
      await ensurePublicHostname(requestUrl.hostname);
      if (route.request().isNavigationRequest() && route.request().frame() === page.mainFrame() && requestUrl.origin !== session.allowedOrigin) {
        return route.abort("blockedbyclient");
      }
      return route.continue();
    } catch {
      return route.abort("blockedbyclient");
    }
  });

  sessions.set(session.id, session);
  try {
    await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: 35_000 });
    const login = await autoLogin(session, body.username, body.password);
    const observation = await observe(session, [body.password]);
    return { sessionId: session.id, login, observation, dialogs: session.dialogs };
  } catch (error) {
    await closeSession(session);
    throw error;
  }
}

async function routeRequest(request, response) {
  const url = new URL(request.url, "http://engine.local");
  if (request.method === "GET" && url.pathname === "/health") {
    return json(response, 200, {
      service: "PRIME Browser Engine",
      version: "2.0.0",
      ready: ENGINE_TOKEN.length >= 32,
      activeSessions: sessions.size,
    });
  }
  if (!authorized(request)) return json(response, ENGINE_TOKEN.length >= 32 ? 401 : 503, { error: ENGINE_TOKEN.length >= 32 ? "unauthorized" : "engine_not_configured" });

  if (request.method === "POST" && url.pathname === "/v1/sessions") {
    const result = await createBrowserSession(await readJson(request));
    return json(response, 201, result);
  }

  const match = url.pathname.match(/^\/v1\/sessions\/([0-9a-f-]{36})(?:\/(inspect|screenshot|navigate|click|confirm|type|select))?$/u);
  if (!match) return json(response, 404, { error: "not_found" });
  const session = requireSession(match[1]);
  const action = match[2];

  if (request.method === "DELETE" && !action) {
    await closeSession(session);
    return json(response, 200, { closed: true });
  }
  if (request.method === "GET" && action === "inspect") return json(response, 200, await observe(session));
  if (request.method === "GET" && action === "screenshot") {
    const buffer = await session.page.screenshot({ type: "png", fullPage: false });
    return json(response, 200, { mimeType: "image/png", data: buffer.toString("base64"), url: session.page.url() });
  }
  if (request.method !== "POST") return json(response, 405, { error: "method_not_allowed" });
  const body = await readJson(request);

  if (action === "navigate") {
    const destination = new URL(String(body.url || ""), session.page.url());
    if (destination.protocol !== "https:" || destination.origin !== session.allowedOrigin) throw Object.assign(new Error("navigation_outside_allowed_origin"), { status: 400 });
    await session.page.goto(destination.toString(), { waitUntil: "domcontentloaded", timeout: 35_000 });
    await settle(session.page);
    return json(response, 200, await observe(session));
  }

  if (action === "click") {
    const ref = sanitizeRef(body.ref);
    const details = await elementDetails(session.page, ref);
    const classification = classifyElementAction(details);
    if (classification.requiresConfirmation) {
      const token = randomBytes(24).toString("base64url");
      session.pendingAction = { token, ref, label: details.label, expiresAt: Date.now() + 5 * 60_000 };
      return json(response, 200, {
        requiresConfirmation: true,
        actionToken: token,
        action: { ref, label: redactText(details.label, session.redactions), reason: classification.reason },
      });
    }
    return json(response, 200, { requiresConfirmation: false, observation: await performClick(session, ref) });
  }

  if (action === "confirm") {
    const pending = session.pendingAction;
    if (!pending || pending.expiresAt <= Date.now() || !safeEqual(String(body.actionToken || ""), pending.token)) {
      throw Object.assign(new Error("invalid_or_expired_confirmation"), { status: 400 });
    }
    const details = await elementDetails(session.page, pending.ref);
    if (details.label !== pending.label) throw Object.assign(new Error("action_changed_before_confirmation"), { status: 409 });
    session.pendingAction = null;
    return json(response, 200, { confirmed: true, observation: await performClick(session, pending.ref) });
  }

  if (action === "type") {
    const ref = sanitizeRef(body.ref);
    const value = String(body.text ?? "");
    if (value.length > 10_000) throw Object.assign(new Error("text_too_long"), { status: 400 });
    const locator = session.page.locator(`[data-prime-ref="${ref}"]`).first();
    const type = await locator.getAttribute("type");
    if (type?.toLowerCase() === "password") throw Object.assign(new Error("password_fields_require_secure_session"), { status: 400 });
    await locator.fill(value, { timeout: 10_000 });
    return json(response, 200, { typed: true, observation: await observe(session) });
  }

  if (action === "select") {
    const ref = sanitizeRef(body.ref);
    const locator = session.page.locator(`[data-prime-ref="${ref}"]`).first();
    await locator.selectOption({ value: String(body.value ?? "") }, { timeout: 10_000 });
    return json(response, 200, { selected: true, observation: await observe(session) });
  }

  return json(response, 404, { error: "not_found" });
}

const server = createServer((request, response) => {
  routeRequest(request, response).catch((error) => {
    const status = Number(error?.status) || 500;
    const allowed = new Set([
      "invalid_url", "public_https_required", "private_network_blocked", "invalid_username", "invalid_password",
      "session_capacity_reached", "session_not_found_or_expired", "invalid_element_ref", "element_not_visible",
      "navigation_outside_allowed_origin", "invalid_or_expired_confirmation", "action_changed_before_confirmation",
      "password_fields_require_secure_session", "text_too_long", "body_too_large", "invalid_json",
      "login_origin_changed", "external_login_action_blocked",
    ]);
    json(response, status, { error: allowed.has(error?.message) ? error.message : "browser_operation_failed" });
  });
});

setInterval(() => {
  for (const session of sessions.values()) {
    if (session.expiresAt <= Date.now()) void closeSession(session);
  }
}, 30_000).unref();

async function shutdown() {
  await Promise.all([...sessions.values()].map(closeSession));
  if (browserPromise) await (await browserPromise).close().catch(() => {});
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
server.listen(PORT, "0.0.0.0");
