import { BROWSER_WIDGET_SCRIPT } from "./browser-widget.generated";

export const BROWSER_WIDGET_URI = "ui://prime-browser/operator.html";

export function browserWidgetHtml(): string {
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f9ff;
      --surface: rgba(255,255,255,.96);
      --surface-2: #eef4ff;
      --text: #101828;
      --muted: #5d6b82;
      --line: #d9e2f1;
      --accent: #1457ff;
      --accent-2: #00a885;
      --danger: #c52d4b;
      --shadow: 0 20px 55px rgba(20,43,91,.14);
    }
    :root[data-theme="dark"] {
      color-scheme: dark;
      --bg: #07111f;
      --surface: rgba(12,25,44,.97);
      --surface-2: #10233d;
      --text: #f4f7ff;
      --muted: #a8b5c8;
      --line: #233b59;
      --accent: #6d9bff;
      --accent-2: #45d4b7;
      --danger: #ff7d98;
      --shadow: 0 24px 70px rgba(0,0,0,.32);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 12px;
      background: transparent;
      color: var(--text);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Tahoma, Arial, sans-serif;
      font-size: 16px;
      line-height: 1.55;
    }
    .shell {
      position: relative;
      overflow: hidden;
      max-width: 720px;
      margin: 0 auto;
      border: 1px solid var(--line);
      border-radius: 24px;
      background: var(--surface);
      box-shadow: var(--shadow);
    }
    .shell::before {
      content: "";
      position: absolute;
      inset: 0 0 auto;
      height: 5px;
      background: linear-gradient(90deg, var(--accent), #6846ff, var(--accent-2));
    }
    header { padding: 24px 24px 10px; }
    .brand { display: flex; align-items: center; gap: 12px; }
    .mark {
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      border-radius: 15px;
      color: #fff;
      background: linear-gradient(145deg, #1748d8, #5d45e9);
      box-shadow: 0 10px 28px rgba(43,76,208,.3);
    }
    .mark svg { width: 24px; height: 24px; }
    h1 { margin: 0; font-size: 19px; line-height: 1.25; letter-spacing: -.02em; }
    .subtitle { margin: 4px 0 0; color: var(--muted); font-size: 14px; }
    .security-strip {
      display: flex;
      gap: 9px;
      align-items: flex-start;
      margin: 10px 24px 20px;
      padding: 11px 13px;
      border: 1px solid color-mix(in srgb, var(--accent-2) 38%, var(--line));
      border-radius: 14px;
      background: color-mix(in srgb, var(--accent-2) 8%, var(--surface));
      color: var(--muted);
      font-size: 13px;
    }
    .security-strip strong { color: var(--text); }
    form { padding: 0 24px 24px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .field { display: grid; gap: 7px; }
    .field.full { grid-column: 1 / -1; }
    label { font-size: 14px; font-weight: 700; }
    input, textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 13px;
      background: var(--surface-2);
      color: var(--text);
      font: inherit;
      outline: none;
      transition: border-color .15s ease, box-shadow .15s ease, background .15s ease;
    }
    input { height: 48px; padding: 0 14px; direction: ltr; text-align: left; }
    textarea { min-height: 92px; resize: vertical; padding: 12px 14px; }
    input:focus, textarea:focus {
      border-color: var(--accent);
      background: var(--surface);
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 13%, transparent);
    }
    input::placeholder, textarea::placeholder { color: color-mix(in srgb, var(--muted) 72%, transparent); }
    .consent {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      grid-column: 1 / -1;
      padding: 12px 13px;
      border: 1px solid var(--line);
      border-radius: 13px;
      color: var(--muted);
      font-size: 13px;
    }
    .consent input { flex: 0 0 auto; width: 18px; height: 18px; margin: 2px 0 0; accent-color: var(--accent); }
    button {
      width: 100%;
      min-height: 50px;
      margin-top: 16px;
      border: 0;
      border-radius: 14px;
      color: #fff;
      background: linear-gradient(135deg, #1748d8, #6344e7);
      box-shadow: 0 13px 26px rgba(51,73,207,.26);
      font: inherit;
      font-weight: 800;
      cursor: pointer;
    }
    button:hover { filter: brightness(1.05); }
    button:disabled { cursor: wait; opacity: .64; }
    output {
      display: block;
      margin: 0 24px 24px;
      padding: 15px 16px;
      border: 1px solid var(--line);
      border-radius: 15px;
      background: var(--surface-2);
    }
    output[hidden] { display: none; }
    output[data-kind="success"] { border-color: color-mix(in srgb, var(--accent-2) 55%, var(--line)); }
    output[data-kind="error"] { border-color: color-mix(in srgb, var(--danger) 55%, var(--line)); }
    output strong { display: block; margin-bottom: 3px; font-size: 14px; }
    output p { margin: 0; color: var(--muted); font-size: 13px; }
    .footnote { margin: 14px 0 0; color: var(--muted); text-align: center; font-size: 12px; }
    @media (max-width: 560px) {
      body { padding: 6px; }
      .shell { border-radius: 19px; }
      header { padding: 21px 17px 8px; }
      .security-strip { margin: 10px 17px 17px; }
      form { padding: 0 17px 19px; }
      .grid { grid-template-columns: 1fr; }
      output { margin: 0 17px 19px; }
    }
  </style>
</head>
<body>
  <section class="shell" aria-labelledby="form-title">
    <header>
      <div class="brand">
        <span class="mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
            <path d="M7 10V8a5 5 0 0 1 10 0v2"/><rect x="4" y="10" width="16" height="11" rx="3"/><path d="M12 14v3"/>
          </svg>
        </span>
        <span>
          <h1 id="form-title">نشست امن مرورگر</h1>
          <p class="subtitle">اطلاعات ورود یک‌بارمصرف برای تست واقعی پنل</p>
        </span>
      </div>
    </header>

    <div class="security-strip">
      <span aria-hidden="true">●</span>
      <span><strong>ذخیره دائمی نمی‌شود.</strong> اطلاعات رمزگذاری می‌شوند و پس از رضایت شما فقط برای اجرای همین نشست به مرورگر اختصاصی PRIME تحویل داده می‌شوند؛ حداکثر پس از ۱۵ دقیقه حذف خواهند شد.</span>
    </div>

    <form id="secure-session-form" autocomplete="off">
      <div id="form-fields" class="grid">
        <div class="field full">
          <label for="target-url">آدرس پنل</label>
          <input id="target-url" name="target_url" type="url" inputmode="url" placeholder="https://panel.example.com" required />
        </div>
        <div class="field">
          <label for="username">نام کاربری یا ایمیل</label>
          <input id="username" name="username" type="text" maxlength="512" autocomplete="off" spellcheck="false" required />
        </div>
        <div class="field">
          <label for="password">رمز عبور</label>
          <input id="password" name="password" type="password" maxlength="4096" autocomplete="new-password" required />
        </div>
        <div class="field full">
          <label for="task">چه چیزی آزمایش شود؟</label>
          <textarea id="task" name="task" maxlength="2000" placeholder="مثلاً: وارد شو، داشبورد را بررسی کن و دکمه ورود امن را تست کن."></textarea>
        </div>
        <label class="consent" for="authorization">
          <input id="authorization" type="checkbox" required />
          <span>مالک یا مجاز به تست این سایت هستم و اجازه ورود و تست غیرمخرب را می‌دهم. هر تغییر حساس باید جداگانه در چت تأیید شود.</span>
        </label>
        <label class="consent" for="external-browser-consent">
          <input id="external-browser-consent" type="checkbox" required />
          <span>می‌پذیرم نام کاربری و رمز فقط برای همین نشست و فقط برای آدرس بالا به موتور اختصاصی PRIME تحویل شود تا مرورگر ایزوله صفحه را باز کند، کلیک کند و فرم ورود را پر کند.</span>
        </label>
        <div class="field full">
          <button id="submit-button" type="submit">ساخت نشست امن و شروع تست</button>
          <p class="footnote">رمز در متن چت نمایش داده نمی‌شود.</p>
        </div>
      </div>
    </form>

    <output id="status" role="status" aria-live="polite" hidden>
      <strong id="status-title"></strong>
      <p id="status-text"></p>
    </output>
  </section>
  <script>${BROWSER_WIDGET_SCRIPT}</script>
</body>
</html>`;
}
