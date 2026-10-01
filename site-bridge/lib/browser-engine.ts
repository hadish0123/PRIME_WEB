import { env } from "cloudflare:workers";

export type BrowserObservation = {
  url: string;
  title: string;
  text: string;
  elements: Array<{
    ref: string;
    tag: string;
    role: string;
    type: string;
    label: string;
    name: string;
    href: string;
    disabled: boolean;
  }>;
  expiresAt: string;
};

type EngineErrorPayload = { error?: string };

function configuration(): { baseUrl: URL; token: string } {
  const token = env.BROWSER_ENGINE_TOKEN?.trim();
  let baseUrl: URL;
  try {
    baseUrl = new URL(env.BROWSER_ENGINE_URL?.trim() ?? "");
  } catch {
    throw new Error("موتور مرورگر اختصاصی هنوز پیکربندی نشده است.");
  }
  if (baseUrl.protocol !== "https:" || !token || token.length < 32) {
    throw new Error("موتور مرورگر اختصاصی هنوز پیکربندی نشده است.");
  }
  return { baseUrl, token };
}

function friendlyEngineError(code: string | undefined): string {
  const errors: Record<string, string> = {
    session_capacity_reached: "ظرفیت نشست‌های مرورگر تکمیل است؛ چند دقیقه دیگر دوباره تلاش کنید.",
    session_not_found_or_expired: "نشست مرورگر وجود ندارد یا منقضی شده است.",
    private_network_blocked: "این آدرس به شبکه خصوصی یا محلی اشاره می‌کند و قابل دسترسی نیست.",
    navigation_outside_allowed_origin: "پیمایش خارج از دامنه مجاز نشست مسدود شد.",
    invalid_or_expired_confirmation: "تأیید این عملیات معتبر نیست یا منقضی شده است.",
    action_changed_before_confirmation: "دکمه یا عملیات پس از درخواست تأیید تغییر کرده است؛ صفحه را دوباره بررسی کنید.",
    password_fields_require_secure_session: "رمز فقط از کادر امن یک‌بارمصرف قابل ورود است.",
    element_not_visible: "عنصر موردنظر دیگر روی صفحه قابل مشاهده نیست.",
  };
  return errors[code ?? ""] ?? "موتور مرورگر نتوانست این عملیات را انجام دهد.";
}

async function engineRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { baseUrl, token } = configuration();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(new URL(path, baseUrl), {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => ({}))) as T & EngineErrorPayload;
    if (!response.ok) throw new Error(friendlyEngineError(payload.error));
    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("پاسخ موتور مرورگر بیش از حد طول کشید.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function startEngineSession(input: {
  targetUrl: string;
  username: string;
  password: string;
  task: string;
}) {
  return engineRequest<{
    sessionId: string;
    login: { attempted: boolean; reason?: string; passwordFieldVisible?: boolean };
    observation: BrowserObservation;
    dialogs: Array<{ type: string; message: string }>;
  }>("/v1/sessions", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function inspectEngineSession(engineSessionId: string) {
  return engineRequest<BrowserObservation>(`/v1/sessions/${engineSessionId}/inspect`);
}

export async function screenshotEngineSession(engineSessionId: string) {
  return engineRequest<{ mimeType: "image/png"; data: string; url: string }>(
    `/v1/sessions/${engineSessionId}/screenshot`,
  );
}

export async function navigateEngineSession(engineSessionId: string, url: string) {
  return engineRequest<BrowserObservation>(`/v1/sessions/${engineSessionId}/navigate`, {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}

export async function clickEngineElement(engineSessionId: string, ref: string) {
  return engineRequest<
    | { requiresConfirmation: false; observation: BrowserObservation }
    | {
        requiresConfirmation: true;
        actionToken: string;
        action: { ref: string; label: string; reason: string };
      }
  >(`/v1/sessions/${engineSessionId}/click`, {
    method: "POST",
    body: JSON.stringify({ ref }),
  });
}

export async function confirmEngineAction(engineSessionId: string, actionToken: string) {
  return engineRequest<{ confirmed: true; observation: BrowserObservation }>(
    `/v1/sessions/${engineSessionId}/confirm`,
    { method: "POST", body: JSON.stringify({ actionToken }) },
  );
}

export async function typeInEngineElement(engineSessionId: string, ref: string, text: string) {
  return engineRequest<{ typed: true; observation: BrowserObservation }>(
    `/v1/sessions/${engineSessionId}/type`,
    { method: "POST", body: JSON.stringify({ ref, text }) },
  );
}

export async function selectEngineOption(engineSessionId: string, ref: string, value: string) {
  return engineRequest<{ selected: true; observation: BrowserObservation }>(
    `/v1/sessions/${engineSessionId}/select`,
    { method: "POST", body: JSON.stringify({ ref, value }) },
  );
}

export async function closeEngineSession(engineSessionId: string): Promise<void> {
  await engineRequest<{ closed: true }>(`/v1/sessions/${engineSessionId}`, { method: "DELETE" });
}

export async function engineHealth() {
  const { baseUrl } = configuration();
  const response = await fetch(new URL("/health", baseUrl), {
    headers: { "cache-control": "no-store" },
  });
  const payload = (await response.json().catch(() => ({}))) as {
    service?: string;
    version?: string;
    ready?: boolean;
  };
  if (!response.ok || !payload.ready) throw new Error("موتور مرورگر هنوز آماده نیست.");
  return payload;
}
