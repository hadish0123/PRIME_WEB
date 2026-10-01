import test from "node:test";
import assert from "node:assert/strict";
import { autoLogin } from "../src/login.js";

class FakeLocator {
  constructor(elements = []) {
    this.elements = elements;
  }

  async count() {
    return this.elements.length;
  }

  nth(index) {
    return new FakeLocator(this.elements[index] ? [this.elements[index]] : []);
  }

  locator(selector) {
    return this.elements[0]?.locate?.(selector) ?? new FakeLocator();
  }

  async isVisible() {
    const element = this.elements[0];
    return Boolean(element && (typeof element.visible === "function" ? element.visible() : element.visible));
  }

  async getAttribute(name) {
    return this.elements[0]?.attributes?.[name] ?? null;
  }

  async textContent() {
    return this.elements[0]?.text ?? "";
  }

  async fill(value) {
    const element = this.elements[0];
    if (!element) throw new Error("missing_element");
    element.value = value;
  }

  async click() {
    const element = this.elements[0];
    if (!element) throw new Error("missing_element");
    element.onClick?.();
  }
}

function loginPage({ formDelay = 0, usernameFirst = false, formAction = "/login" } = {}) {
  const state = { clock: 0, nextClicked: false, submitted: false };
  const available = () => state.clock >= formDelay;
  const usernameVisible = () => available() && (!usernameFirst || !state.nextClicked);
  const passwordVisible = () => available() && (!usernameFirst || state.nextClicked) && !state.submitted;

  const form = {
    visible: true,
    attributes: { action: formAction },
    locate(selector) {
      if (selector.includes("autocomplete='username'")) return new FakeLocator(usernameVisible() ? [username] : []);
      if (selector === "input[type='text'],input:not([type])") return new FakeLocator(usernameVisible() ? [username] : []);
      if (selector === "button[type='submit'],input[type='submit']") {
        return new FakeLocator(passwordVisible() ? [submit] : []);
      }
      if (selector === "button,input[type='submit'],[role='button']") {
        return new FakeLocator([
          ...(usernameFirst && usernameVisible() ? [next] : []),
          ...(passwordVisible() ? [submit] : []),
        ]);
      }
      return new FakeLocator();
    },
  };
  const username = {
    visible: usernameVisible,
    attributes: {},
    locate: (selector) => (selector === "xpath=ancestor::form[1]" ? new FakeLocator([form]) : new FakeLocator()),
  };
  const password = {
    visible: passwordVisible,
    attributes: {},
    locate: (selector) => (selector === "xpath=ancestor::form[1]" ? new FakeLocator([form]) : new FakeLocator()),
  };
  const next = {
    visible: usernameVisible,
    attributes: {},
    text: "ادامه",
    onClick: () => {
      state.nextClicked = true;
    },
  };
  const submit = {
    visible: passwordVisible,
    attributes: { type: "submit" },
    text: "ورود",
    onClick: () => {
      state.submitted = true;
    },
  };
  const body = { visible: true, locate: (selector) => form.locate(selector) };

  const page = {
    url: () => "https://example.com/login",
    locator(selector) {
      if (selector === "input[type='password']") return new FakeLocator([password]);
      if (selector.includes("autocomplete='username'")) return new FakeLocator([username]);
      if (selector === "body") return new FakeLocator([body]);
      return new FakeLocator();
    },
    async waitForTimeout(milliseconds) {
      state.clock += milliseconds;
    },
    async waitForLoadState() {},
  };

  return { page, state, username, password, now: () => state.clock };
}

test("waits for a login form that appears late", async () => {
  const fixture = loginPage({ formDelay: 1_500 });
  const result = await autoLogin(
    { page: fixture.page, allowedOrigin: "https://example.com" },
    "delayed-user",
    "delayed-password",
    { timeoutMs: 5_000, pollMs: 500, now: fixture.now },
  );

  assert.equal(result.attempted, true);
  assert.equal(fixture.username.value, "delayed-user");
  assert.equal(fixture.password.value, "delayed-password");
  assert.equal(fixture.state.submitted, true);
  assert.ok(result.waitedMs >= 1_500);
});

test("supports an explicit username-first step", async () => {
  const fixture = loginPage({ usernameFirst: true });
  const result = await autoLogin(
    { page: fixture.page, allowedOrigin: "https://example.com" },
    "two-step-user",
    "two-step-password",
    { timeoutMs: 5_000, pollMs: 500, usernameStepGraceMs: 1_000, now: fixture.now },
  );

  assert.equal(result.attempted, true);
  assert.equal(result.usernameStepCompleted, true);
  assert.equal(fixture.state.nextClicked, true);
  assert.equal(fixture.state.submitted, true);
});

test("returns a retryable timeout without attempting a login", async () => {
  const fixture = loginPage({ formDelay: 10_000 });
  const result = await autoLogin(
    { page: fixture.page, allowedOrigin: "https://example.com" },
    "user",
    "password",
    { timeoutMs: 2_000, pollMs: 500, now: fixture.now },
  );

  assert.deepEqual(result, {
    attempted: false,
    reason: "login_form_timeout",
    waitedMs: 2_000,
    usernameStepCompleted: false,
  });
  assert.equal(fixture.state.submitted, false);
});

test("blocks a login form that posts to another origin", async () => {
  const fixture = loginPage({ formAction: "https://evil.example/login" });
  await assert.rejects(
    autoLogin(
      { page: fixture.page, allowedOrigin: "https://example.com" },
      "user",
      "password",
      { timeoutMs: 2_000, pollMs: 500, now: fixture.now },
    ),
    /external_login_action_blocked/u,
  );
});
