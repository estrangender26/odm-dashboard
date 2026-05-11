import mysql from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

async function main() {
  const pool = mysql.createPool(DATABASE_URL);
  try {
    // Update the filename to match user's expected name
    const [result] = await pool.execute(
      `UPDATE governance_uploads 
       SET file_name = 'IOM for O&M Structure Governance.pdf',
           facility_slug = 'all',
           milestone_id = '__ref',
           category = 'references',
           toc_item = 'references'
       WHERE id = 30001`
    );
    console.log("Updated record 30001:", (result as any).affectedRows, "rows affected");

    // Verify
    const [rows] = await pool.query(
      `SELECT id, file_name, facility_slug, milestone_id, category, toc_item 
       FROM governance_uploads WHERE id = 30001`
    );
    console.log("Verify:", (rows as any[])[0]);
  } catch (err: any) {
    console.error("Error:", err.message);
  } finally {
    await pool.end();
  }
}

main();
