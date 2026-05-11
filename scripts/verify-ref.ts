import mysql from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

async function main() {
  const pool = mysql.createPool(DATABASE_URL);
  try {
    // Check column type
    const [cols] = await pool.query(
      "SHOW COLUMNS FROM governance_uploads WHERE Field = 'file_url'"
    );
    console.log("[VERIFY] file_url column:", JSON.stringify((cols as any[])[0]));

    // Count reference docs
    const [refCount] = await pool.query(
      `SELECT COUNT(*) as cnt FROM governance_uploads WHERE milestone_id = '__ref'`
    );
    console.log("[VERIFY] Reference docs count:", (refCount as any[])[0].cnt);

    // List all reference docs
    const [refs] = await pool.query(
      `SELECT id, facility_slug, milestone_id, category, toc_item, file_name, 
        LENGTH(file_url) as url_length, uploaded_by, uploaded_at 
       FROM governance_uploads WHERE milestone_id = '__ref'`
    );
    console.log("[VERIFY] Reference docs:");
    (refs as any[]).forEach((r) => {
      console.log("  ID:", r.id);
      console.log("  Name:", r.file_name);
      console.log("  URL length:", r.url_length, "chars");
      console.log("  Category:", r.category);
      console.log("  TOC item:", r.toc_item);
      console.log("  By:", r.uploaded_by);
      console.log("  At:", r.uploaded_at);
    });

    // Check if data_url looks valid
    if ((refs as any[]).length > 0) {
      const [data] = await pool.query(
        `SELECT LEFT(file_url, 60) as url_start FROM governance_uploads WHERE milestone_id = '__ref' LIMIT 1`
      );
      console.log("[VERIFY] URL starts with:", (data as any[])[0].url_start);
    }
  } catch (err: any) {
    console.error("[VERIFY] Error:", err.message);
  } finally {
    await pool.end();
  }
}

main();
