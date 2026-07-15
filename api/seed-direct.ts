/**
 * Deprecated credential-bearing seed entry point.
 * Seeding can overwrite or create application data and requires an explicit,
 * separately reviewed command against a disposable database.
 */
console.error("api/seed-direct.ts is disabled. Use a reviewed seed script with an explicitly verified disposable DATABASE_URL.");
process.exitCode = 1;
