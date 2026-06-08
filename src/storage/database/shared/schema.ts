import { index, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const healthCheck = pgTable("health_check", {
  id: serial().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow(),
});

export const helpDocuments = pgTable(
  "help_documents",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    title: varchar("title", { length: 500 }).notNull(),
    category: varchar("category", { length: 100 }).default("未分类"),
    last_updated: varchar("last_updated", { length: 20 }),
    content: text("content").notNull(),
    source_url: text("source_url"),
    html_content: text("html_content"),
    language: varchar("language", { length: 10 }).default("unknown"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("help_documents_category_idx").on(table.category),
    index("help_documents_language_idx").on(table.language),
    index("help_documents_created_at_idx").on(table.created_at),
  ]
);