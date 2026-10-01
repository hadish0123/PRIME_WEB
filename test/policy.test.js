import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyElementAction,
  isPrivateIp,
  normalizePublicHttpsUrl,
  redactText,
} from "../src/policy.js";

test("blocks local and private targets", () => {
  assert.throws(() => normalizePublicHttpsUrl("http://example.com"));
  assert.throws(() => normalizePublicHttpsUrl("https://localhost/admin"));
  assert.equal(isPrivateIp("127.0.0.1"), true);
  assert.equal(isPrivateIp("10.1.2.3"), true);
  assert.equal(isPrivateIp("8.8.8.8"), false);
});

test("classifies mutations and navigation", () => {
  assert.equal(classifyElementAction({ tag: "button", label: "حذف کاربر" }).requiresConfirmation, true);
  assert.equal(classifyElementAction({ tag: "button", label: "Save settings" }).requiresConfirmation, true);
  assert.equal(classifyElementAction({ tag: "a", label: "گزارش", href: "https://example.com/report" }).requiresConfirmation, false);
  assert.equal(classifyElementAction({ tag: "button", label: "جستجو" }).requiresConfirmation, false);
});

test("redacts known secrets", () => {
  assert.equal(redactText("hello secret-value", ["secret-value"]), "hello [redacted]");
});
