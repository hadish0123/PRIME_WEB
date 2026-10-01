const DEFAULT_LOGIN_FORM_WAIT_MS = 30_000;
const DEFAULT_LOGIN_POLL_MS = 500;
const DEFAULT_USERNAME_STEP_GRACE_MS = 2_500;

const PASSWORD_SELECTOR = "input[type='password']";
const USERNAME_SELECTOR = [
  "input[autocomplete='username']",
  "input[type='email']",
  "input[name*='user' i]",
  "input[id*='user' i]",
  "input[name*='email' i]",
  "input[id*='email' i]",
  "input[name*='login' i]",
  "input[id*='login' i]",
].join(",");

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, minimum), maximum) : fallback;
}

export const LOGIN_FORM_WAIT_MS = boundedNumber(
  process.env.LOGIN_FORM_WAIT_MS,
  DEFAULT_LOGIN_FORM_WAIT_MS,
  5_000,
  60_000,
);

export async function firstVisible(locator, limit = 20) {
  const count = Math.min(await locator.count().catch(() => 0), limit);
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  return null;
}

function assertAllowedOrigin(page, allowedOrigin) {
  let origin;
  try {
    origin = new URL(page.url()).origin;
  } catch {
    throw new Error("login_origin_changed");
  }
  if (origin !== allowedOrigin) throw new Error("login_origin_changed");
}

async function formScope(input, page, allowedOrigin) {
  const form = input.locator("xpath=ancestor::form[1]");
  if ((await form.count().catch(() => 0)) === 0) return page.locator("body");
  const action = await form.getAttribute("action").catch(() => null);
  if (action && new URL(action, page.url()).origin !== allowedOrigin) {
    throw new Error("external_login_action_blocked");
  }
  return form;
}

async function readableControlLabel(control) {
  const values = await Promise.all([
    control.getAttribute("aria-label").catch(() => null),
    control.getAttribute("value").catch(() => null),
    control.textContent().catch(() => null),
  ]);
  return values.filter(Boolean).join(" ").trim().replace(/\s+/gu, " ");
}

async function findNamedControl(scope, pattern) {
  const controls = scope.locator("button,input[type='submit'],[role='button']");
  const count = Math.min(await controls.count().catch(() => 0), 30);
  for (let index = 0; index < count; index += 1) {
    const control = controls.nth(index);
    if (!(await control.isVisible().catch(() => false))) continue;
    if (pattern.test(await readableControlLabel(control))) return control;
  }
  return null;
}

async function findLoginSubmit(scope) {
  const explicit = await firstVisible(scope.locator("button[type='submit'],input[type='submit']"));
  if (explicit) return explicit;
  return findNamedControl(scope, /^(?:log\s*in|sign\s*in|submit|ورود|وارد\s*شو)(?:\s|$)/iu);
}

async function waitForNextPoll(page, now, deadline, pollMs) {
  const remaining = deadline - now();
  if (remaining <= 0) return;
  await page.waitForTimeout(Math.min(pollMs, remaining));
}

export async function autoLogin(session, username, password, options = {}) {
  const page = session.page;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? LOGIN_FORM_WAIT_MS;
  const pollMs = options.pollMs ?? DEFAULT_LOGIN_POLL_MS;
  const usernameStepGraceMs = options.usernameStepGraceMs ?? DEFAULT_USERNAME_STEP_GRACE_MS;
  const startedAt = now();
  const deadline = startedAt + timeoutMs;
  let usernameFirstSeenAt;
  let usernameStepCompleted = false;
  let nextControlClicked = false;

  while (now() < deadline) {
    assertAllowedOrigin(page, session.allowedOrigin);

    const passwordInput = await firstVisible(page.locator(PASSWORD_SELECTOR));
    if (passwordInput) {
      const scope = await formScope(passwordInput, page, session.allowedOrigin);
      const usernameInput =
        (await firstVisible(scope.locator(USERNAME_SELECTOR))) ??
        (await firstVisible(scope.locator("input[type='text'],input:not([type])"))) ??
        (await firstVisible(page.locator(USERNAME_SELECTOR)));

      if (usernameInput || usernameStepCompleted) {
        const submit = await findLoginSubmit(scope);
        if (submit) {
          if (usernameInput) await usernameInput.fill(username);
          await passwordInput.fill(password);
          await submit.click({ timeout: 10_000 });
          await page.waitForLoadState("domcontentloaded", { timeout: 8_000 }).catch(() => {});
          await page.waitForTimeout(700);
          return {
            attempted: true,
            waitedMs: now() - startedAt,
            usernameStepCompleted,
            passwordFieldVisible: Boolean(await firstVisible(page.locator(PASSWORD_SELECTOR))),
          };
        }
      }
    } else {
      const usernameInput = await firstVisible(page.locator(USERNAME_SELECTOR));
      if (usernameInput) {
        usernameFirstSeenAt ??= now();
        if (!nextControlClicked && now() - usernameFirstSeenAt >= usernameStepGraceMs) {
          const scope = await formScope(usernameInput, page, session.allowedOrigin);
          const nextControl = await findNamedControl(scope, /^(?:next|continue|ادامه|بعدی)(?:\s|$)/iu);
          if (nextControl) {
            await usernameInput.fill(username);
            await nextControl.click({ timeout: 10_000 });
            nextControlClicked = true;
            usernameStepCompleted = true;
            await page.waitForLoadState("domcontentloaded", { timeout: 8_000 }).catch(() => {});
          }
        }
      }
    }

    await waitForNextPoll(page, now, deadline, pollMs);
  }

  return {
    attempted: false,
    reason: "login_form_timeout",
    waitedMs: now() - startedAt,
    usernameStepCompleted,
  };
}
