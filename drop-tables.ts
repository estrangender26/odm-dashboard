import { getDb } from "./api/queries/connection";
async function drop() {
  const db = getDb();
  await db.execute("DROP TABLE IF EXISTS tasks");
  await db.execute("DROP TABLE IF EXISTS equipment");
  console.log("Tables dropped");
}
drop().catch(console.error);
