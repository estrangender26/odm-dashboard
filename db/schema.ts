import { mysqlTable, serial, varchar, text, index, bigint, timestamp } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  avatar: varchar("avatar", { length: 500 }),
  role: varchar("role", { length: 50 }).notNull().default("user"),
  unionId: varchar("union_id", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow(),
  lastSignInAt: timestamp("last_sign_in_at").defaultNow(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const equipment = mysqlTable("equipment", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  initials: varchar("initials", { length: 10 }).notNull(),
}, (table) => [index("equipment_name_idx").on(table.name)]);

export const tasks = mysqlTable("tasks", {
  id: serial("id").primaryKey(),
  equipmentId: bigint("equipment_id", { mode: "number", unsigned: true }).notNull(),
  taskList: text("task_list").notNull(),
  frequency: varchar("frequency", { length: 100 }).notNull(),
  responsiblePersonnel: varchar("responsible_personnel", { length: 100 }),
  operations: varchar("operations", { length: 100 }),
  amd: varchar("amd", { length: 100 }),
  ard: varchar("ard", { length: 100 }),
  dataset: varchar("dataset", { length: 20 }).notNull(),
}, (table) => [
  index("tasks_equipment_idx").on(table.equipmentId),
  index("tasks_dataset_idx").on(table.dataset),
]);