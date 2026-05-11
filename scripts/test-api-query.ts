import mysql from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

async function main() {
  const pool = mysql.createPool(DATABASE_URL);
  try {
    // Test the exact query the API uses
    const [rows] = await pool.query(
      `SELECT id, facility_slug, milestone_id, category, toc_item, file_name, uploaded_by, uploaded_at
       FROM governance_uploads
       WHERE milestone_id = '__ref' OR category = 'references'
       ORDER BY uploaded_at DESC`
    );
    const arr = rows as any[];
    console.log("Query returned", arr.length, "rows");
    arr.forEach((r) => {
      console.log("  ", JSON.stringify(r));
    });

    // Also test with raw execute (like the API does)
    const [rows2] = await pool.execute(
      `SELECT id, facility_slug, milestone_id, category, toc_item, file_name, uploaded_by, uploaded_at
       FROM governance_uploads
       WHERE milestone_id = ? OR category = ?
       ORDER BY uploaded_at DESC`,
      ['__ref', 'references']
    );
    const arr2 = rows2 as any[];
    console.log("\nParameterized query returned", arr2.length, "rows");
  } catch (err: any) {
    console.error("Error:", err.message);
  } finally {
    await pool.end();
  }
}

main();
