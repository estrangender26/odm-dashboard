/**
 * Deprecated manual setup entry point.
 *
 * The former version embedded a database credential. Schema changes must now
 * use reviewed migrations with DATABASE_URL supplied through the environment.
 */
console.error("api/setup-db.ts is deprecated. Use npm run db:migrate with an explicitly verified DATABASE_URL.");
process.exitCode = 1;
