import { App, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-with-deps";

type SessionResult = {
  session_id?: string;
  target_host?: string;
  expires_at?: string;
};

const app = new App(
  { name: "PRIME Browser Secure Form", version: "2.0.0" },
  { availableDisplayModes: ["inline"] },
  { autoResize: true, strict: true },
);

const form = document.querySelector<HTMLFormElement>("#secure-session-form")!;
const targetUrl = document.querySelector<HTMLInputElement>("#target-url")!;
const username = document.querySelector<HTMLInputElement>("#username")!;
const password = document.querySelector<HTMLInputElement>("#password")!;
const task = document.querySelector<HTMLTextAreaElement>("#task")!;
const authorization = document.querySelector<HTMLInputElement>("#authorization")!;
const externalBrowserConsent = document.querySelector<HTMLInputElement>("#external-browser-consent")!;
const submitButton = document.querySelector<HTMLButtonElement>("#submit-button")!;
const statusBox = document.querySelector<HTMLOutputElement>("#status")!;
const statusTitle = document.querySelector<HTMLElement>("#status-title")!;
const statusText = document.querySelector<HTMLElement>("#status-text")!;
const formFields = document.querySelector<HTMLElement>("#form-fields")!;

function showStatus(kind: "working" | "success" | "error", title: string, message: string) {
  statusBox.hidden = false;
  statusBox.dataset.kind = kind;
  statusTitle.textContent = title;
  statusText.textContent = message;
}

function setSubmitting(submitting: boolean) {
  submitButton.disabled = submitting;
  submitButton.textContent = submitting ? "در حال ساخت نشست امن…" : "ساخت نشست امن و شروع تست";
  for (const field of Array.from(form.elements)) {
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
      field.disabled = submitting;
    }
  }
}

function applyTheme(theme: unknown) {
  document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
}

app.ontoolinput = (params) => {
  const args = (params.arguments ?? {}) as Record<string, unknown>;
  if (typeof args.suggested_url === "string" && !targetUrl.value) {
    targetUrl.value = args.suggested_url;
  }
  if (typeof args.suggested_task === "string" && !task.value) {
    task.value = args.suggested_task;
  }
};

app.onhostcontextchanged = (context) => applyTheme(context.theme);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusBox.hidden = true;
  if (!form.reportValidity()) return;
  if (!authorization.checked) {
    showStatus("error", "تأیید لازم است", "اجازه ورود و تست غیرمخرب را فعال کنید.");
    return;
  }
  if (!externalBrowserConsent.checked) {
    showStatus("error", "رضایت لازم است", "اجازه اجرای نشست در مرورگر اختصاصی PRIME را فعال کنید.");
    return;
  }

  setSubmitting(true);
  showStatus("working", "در حال رمزگذاری", "اطلاعات فقط برای همین نشست ۱۵ دقیقه‌ای ارسال می‌شوند.");

  const secretPassword = password.value;
  try {
    const result = await app.callServerTool({
      name: "prime_browser_create_session",
      arguments: {
        target_url: targetUrl.value.trim(),
        username: username.value.trim(),
        password: secretPassword,
        task: task.value.trim(),
        authorization_confirmed: true,
        browser_provider: "prime",
        engine_transfer_confirmed: true,
      },
    });

    password.value = "";
    if (result.isError) {
      throw new Error("نشست امن ساخته نشد. ورودی‌ها را بررسی و دوباره تلاش کنید.");
    }

    const session = (result.structuredContent ?? {}) as SessionResult;
    if (!session.session_id) throw new Error("شناسه نشست از سرور دریافت نشد.");

    formFields.hidden = true;
    const expiry = session.expires_at
      ? new Intl.DateTimeFormat("fa-IR", { hour: "2-digit", minute: "2-digit" }).format(new Date(session.expires_at))
      : "۱۵ دقیقه دیگر";
    showStatus(
      "success",
      "نشست امن آماده است",
      `اطلاعات ورود رمزگذاری شد و حداکثر تا ${expiry} اعتبار دارد. مرورگر اکنون می‌تواند تست را شروع کند.`,
    );

    const capabilities = app.getHostCapabilities();
    if (capabilities?.message?.text) {
      const sent = await app.sendMessage({
        role: "user",
        content: [
          {
            type: "text",
            text: `نشست امن مرورگر ${session.session_id} برای ${session.target_host ?? "سایت"} آماده است. آن را با مرورگر اختصاصی PRIME Browser Operator اجرا کن؛ ابتدا وارد شو و فقط مشاهده و تست غیرمخرب انجام بده. برای هر تغییر، قبل از اقدام تأیید من را بگیر و در پایان نشست را ببند.`,
          },
        ],
      });
      if (sent.isError) {
        throw new Error(`نشست ساخته شد. این شناسه را در چت بفرستید: ${session.session_id}`);
      }
    } else {
      statusText.textContent = `نشست ساخته شد. این شناسه را در چت بفرستید: ${session.session_id}`;
    }
  } catch (error) {
    password.value = "";
    formFields.hidden = false;
    showStatus(
      "error",
      "شروع تست ممکن نشد",
      error instanceof Error ? error.message : "خطای ناشناخته رخ داد.",
    );
  } finally {
    setSubmitting(false);
  }
});

async function connect() {
  try {
    await app.connect(new PostMessageTransport(window.parent, window.parent));
    const context = app.getHostContext();
    applyTheme(context?.theme);
    if (context?.availableDisplayModes?.includes("inline") && context.displayMode !== "inline") {
      await app.requestDisplayMode({ mode: "inline" });
    }
  } catch {
    submitButton.disabled = true;
    showStatus("error", "اتصال فرم برقرار نشد", "افزونه را دوباره باز کنید و تلاش کنید.");
  }
}

void connect();
