/** @deprecated Use reviewed migrations; never embed database credentials. */
console.error("api/setup-gov-files.ts is deprecated. Use npm run db:migrate with an explicitly verified DATABASE_URL.");
process.exitCode = 1;
