import { pgTable, serial, integer, text, numeric, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const userPortfolio = pgTable("user_portfolio", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  symbol: text("symbol").notNull(),
  shares: numeric("shares").notNull().default("0"),
  avgCost: numeric("avg_cost").notNull().default("0"),
  notes: text("notes").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("user_portfolio_user_symbol_unique").on(table.userId, table.symbol),
]);

export const insertUserPortfolioSchema = createInsertSchema(userPortfolio).omit({
  id: true,
  updatedAt: true,
});

export type UserPortfolio = typeof userPortfolio.$inferSelect;
export type InsertUserPortfolio = z.infer<typeof insertUserPortfolioSchema>;
