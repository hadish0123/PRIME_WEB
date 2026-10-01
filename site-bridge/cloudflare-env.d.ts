declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    BROWSER_SESSION_ENCRYPTION_SECRET?: string;
    BROWSER_ENGINE_URL?: string;
    BROWSER_ENGINE_TOKEN?: string;
  }
}
