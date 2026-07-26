import { relations } from "drizzle-orm";
import {
  users,
  apiKeys,
  repos,
  units,
  lessons,
  slideTools,
  runs,
  lessonLogs,
  tokenLedger,
  payments,
  favorites,
} from "./schema.js";

export const usersRelations = relations(users, ({ many }) => ({
  apiKeys: many(apiKeys),
  repos: many(repos),
  slideTools: many(slideTools),
  runs: many(runs),
  ledger: many(tokenLedger),
  payments: many(payments),
  favorites: many(favorites),
}));

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, { fields: [apiKeys.userId], references: [users.id] }),
}));

export const reposRelations = relations(repos, ({ one, many }) => ({
  owner: one(users, { fields: [repos.ownerId], references: [users.id] }),
  units: many(units),
  runs: many(runs),
  lessonLogs: many(lessonLogs),
}));

export const unitsRelations = relations(units, ({ one, many }) => ({
  repo: one(repos, { fields: [units.repoId], references: [repos.id] }),
  lessons: many(lessons),
}));

export const lessonsRelations = relations(lessons, ({ one, many }) => ({
  unit: one(units, { fields: [lessons.unitId], references: [units.id] }),
  parent: one(lessons, {
    fields: [lessons.parentLessonId],
    references: [lessons.id],
    relationName: "subLessons",
  }),
  subLessons: many(lessons, { relationName: "subLessons" }),
  runs: many(runs),
  logs: many(lessonLogs),
}));

export const slideToolsRelations = relations(slideTools, ({ one, many }) => ({
  owner: one(users, { fields: [slideTools.ownerId], references: [users.id] }),
  runs: many(runs),
}));

export const runsRelations = relations(runs, ({ one }) => ({
  tool: one(slideTools, { fields: [runs.slideToolId], references: [slideTools.id] }),
  repo: one(repos, { fields: [runs.repoId], references: [repos.id] }),
  lesson: one(lessons, { fields: [runs.lessonId], references: [lessons.id] }),
  user: one(users, { fields: [runs.userId], references: [users.id] }),
}));

export const lessonLogsRelations = relations(lessonLogs, ({ one }) => ({
  repo: one(repos, { fields: [lessonLogs.repoId], references: [repos.id] }),
  lesson: one(lessons, { fields: [lessonLogs.lessonId], references: [lessons.id] }),
  run: one(runs, { fields: [lessonLogs.runId], references: [runs.id] }),
  user: one(users, { fields: [lessonLogs.userId], references: [users.id] }),
}));

export const tokenLedgerRelations = relations(tokenLedger, ({ one }) => ({
  user: one(users, { fields: [tokenLedger.userId], references: [users.id] }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  user: one(users, { fields: [payments.userId], references: [users.id] }),
  resolver: one(users, {
    fields: [payments.resolvedBy],
    references: [users.id],
    relationName: "resolvedPayments",
  }),
}));

export const favoritesRelations = relations(favorites, ({ one }) => ({
  user: one(users, { fields: [favorites.userId], references: [users.id] }),
}));
