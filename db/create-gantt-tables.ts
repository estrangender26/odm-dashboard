/** @deprecated Gantt schema changes belong in reviewed migrations. */
console.error("db/create-gantt-tables.ts is deprecated. Use npm run db:migrate with an explicitly verified DATABASE_URL.");
process.exitCode = 1;
