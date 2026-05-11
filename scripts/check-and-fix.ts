import mysql from "mysql2/promise";
import { readFileSync } from "fs";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

async function main() {
  const pool = mysql.createPool(DATABASE_URL);
  try {
    // Check current state
    const [rows] = await pool.query(
      `SELECT COUNT(*) as cnt FROM governance_uploads WHERE milestone_id = '__ref'`
    );
    const count = (rows as any[])[0].cnt;
    console.log("[CHECK] Reference docs count:", count);

    if (count === 0) {
      console.log("[CHECK] No reference docs found. Re-inserting...");

      const pdfBuffer = readFileSync("/mnt/agents/upload/IOM for O&M Structure Governance.pdf");
      const pdfB64 = pdfBuffer.toString("base64");
      const fileData = `data:application/pdf;base64,${pdfB64}`;

      const [result] = await pool.execute(
        `INSERT INTO governance_uploads 
          (facility_slug, milestone_id, category, toc_item, file_name, file_url, uploaded_by) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          "all",
          "__ref",
          "references",
          "references",
          "IOM for O&M Structure Governance.pdf",
          fileData,
          "Gerald Balucan / EPM"
        ]
      );
      console.log("[CHECK] Re-inserted! ID:", (result as any).insertId);
    } else {
      const [existing] = await pool.query(
        `SELECT id, file_name FROM governance_uploads WHERE milestone_id = '__ref' LIMIT 1`
      );
      console.log("[CHECK] Found:", (existing as any[])[0]);
    }
  } catch (err: any) {
    console.error("[CHECK] Error:", err.message);
  } finally {
    await pool.end();
  }
}

main();
