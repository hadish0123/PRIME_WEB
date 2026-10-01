import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const browserSessions = sqliteTable(
  "browser_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    targetUrl: text("target_url").notNull(),
    targetHost: text("target_host").notNull(),
    task: text("task").notNull(),
    browserProvider: text("browser_provider").notNull().default("chatgpt_native"),
    engineSessionId: text("engine_session_id"),
    credentialsCiphertext: text("credentials_ciphertext"),
    status: text("status").notNull().default("pending"),
    resultSummary: text("result_summary"),
    challenge: text("challenge"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    claimedAt: integer("claimed_at"),
    completedAt: integer("completed_at"),
  },
  (table) => [
    index("idx_browser_sessions_user_status").on(table.userId, table.status),
    index("idx_browser_sessions_expires_at").on(table.expiresAt),
  ],
);
