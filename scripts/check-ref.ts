import mysql from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

async function main() {
  const pool = mysql.createPool(DATABASE_URL);
  try {
    // Check ALL records in governance_uploads
    const [all] = await pool.query(
      `SELECT id, facility_slug, milestone_id, category, toc_item, file_name, uploaded_by, uploaded_at
       FROM governance_uploads ORDER BY id DESC LIMIT 10`
    );
    console.log("=== Last 10 uploads ===");
    (all as any[]).forEach((r) => {
      console.log(`  ID:${r.id} | slug:${r.facility_slug} | mid:${r.milestone_id} | cat:${r.category} | toc:${r.toc_item} | name:${r.file_name}`);
    });

    // Check reference-specific query
    const [refs] = await pool.query(
      `SELECT id, facility_slug, milestone_id, category, toc_item, file_name, uploaded_by, uploaded_at
       FROM governance_uploads
       WHERE milestone_id = '__ref' OR category = 'references'
       ORDER BY id DESC`
    );
    console.log("\n=== Reference query result ===");
    console.log("Count:", (refs as any[]).length);
    (refs as any[]).forEach((r) => {
      console.log(`  ID:${r.id} | slug:${r.facility_slug} | mid:${r.milestone_id} | cat:${r.category} | name:${r.file_name}`);
    });

    // Check URL prefix for reference docs
    if ((refs as any[]).length > 0) {
      const [url] = await pool.query(
        `SELECT LEFT(file_url, 30) as prefix FROM governance_uploads WHERE milestone_id = '__ref' LIMIT 1`
      );
      console.log("\n=== URL prefix ===");
      console.log(" ", (url as any[])[0]?.prefix);
    }
  } catch (err: any) {
    console.error("Error:", err.message);
  } finally {
    await pool.end();
  }
}

main();
