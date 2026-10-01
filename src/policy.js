import { isIP } from "node:net";

const RISK_WORDS = [
  /\b(save|delete|remove|destroy|pay|purchase|buy|submit|send|publish|create|update|edit|add|enable|disable|confirm|approve|revoke|reset|terminate|renew|issue|deliver|sell|charge|refund)\b/iu,
  /(ذخیره|حذف|پاک|پرداخت|خرید|ارسال|انتشار|ثبت|ساخت|ایجاد|ویرایش|تغییر|افزودن|اضافه|تأیید|تایید|فعال|غیرفعال|بازنشانی|تمدید|صدور|تحویل|فروش|شارژ|بازپرداخت)/u,
];

const SAFE_CONTROL_WORDS = [
  /\b(view|open|show|next|previous|back|search|filter|menu|close|cancel|dashboard|report|refresh|reload|details|more)\b/iu,
  /(مشاهده|باز|نمایش|بعدی|قبلی|بازگشت|جستجو|فیلتر|منو|بستن|لغو|داشبورد|گزارش|تازه|جزئیات|بیشتر)/u,
];

export function isPrivateIPv4(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export function isPrivateIp(address) {
  const version = isIP(address);
  if (version === 4) return isPrivateIPv4(address);
  if (version !== 6) return true;
  const value = address.toLowerCase();
  if (value === "::" || value === "::1") return true;
  if (value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb")) return true;
  const mapped = value.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/u);
  return mapped ? isPrivateIPv4(mapped[1]) : false;
}

export function isForbiddenHostname(hostname) {
  const host = String(hostname).toLowerCase().replace(/^\[|\]$/gu, "").replace(/\.$/u, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  return isIP(host) ? isPrivateIp(host) : false;
}

export function normalizePublicHttpsUrl(input) {
  let url;
  try {
    url = new URL(String(input).trim());
  } catch {
    throw new Error("invalid_url");
  }
  if (url.protocol !== "https:" || url.username || url.password || isForbiddenHostname(url.hostname)) {
    throw new Error("public_https_required");
  }
  url.hash = "";
  return url;
}

function normalizedText(element) {
  return [element?.label, element?.name, element?.title, element?.type]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function classifyElementAction(element) {
  const text = normalizedText(element);
  if (RISK_WORDS.some((pattern) => pattern.test(text))) {
    return { requiresConfirmation: true, reason: "mutating_label" };
  }
  const tag = String(element?.tag ?? "").toLowerCase();
  const role = String(element?.role ?? "").toLowerCase();
  const type = String(element?.type ?? "").toLowerCase();
  if (tag === "a" && element?.href) return { requiresConfirmation: false, reason: "navigation_link" };
  if (SAFE_CONTROL_WORDS.some((pattern) => pattern.test(text))) {
    return { requiresConfirmation: false, reason: "safe_control" };
  }
  if (type === "submit" || tag === "button" || role === "button") {
    return { requiresConfirmation: true, reason: "unclassified_button" };
  }
  return { requiresConfirmation: false, reason: "non_submit_control" };
}

export function redactText(value, secrets = []) {
  let output = String(value ?? "");
  for (const secret of secrets) {
    if (typeof secret !== "string" || secret.length < 2) continue;
    output = output.split(secret).join("[redacted]");
  }
  return output;
}
