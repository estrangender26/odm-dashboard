import { readFileSync } from "fs";
import mysql from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

async function main() {
  const pool = mysql.createPool(DATABASE_URL);
  try {
    // Read payload
    const payload = JSON.parse(readFileSync("/tmp/ref_pdf_payload.json", "utf-8"));

    // Delete old reference doc placeholder (the DOCX)
    await pool.execute(
      `DELETE FROM governance_uploads WHERE milestone_id = '__ref'`
    );
    console.log("[INSERT] Cleared old reference documents");

    // Insert the PDF as the new reference document
    const [result] = await pool.execute(
      `INSERT INTO governance_uploads 
        (facility_slug, milestone_id, category, toc_item, file_name, file_url, uploaded_by) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        "all",                          // facility_slug - visible to all
        "__ref",                        // milestone_id - identifies reference docs
        "references",                   // category
        "references",                   // toc_item
        "IOM for O&M Manual Table of Contents Structure.pdf",  // file_name (new display name)
        payload.fileData,               // base64 data URI
        "Gerald Balucan / EPM"          // uploaded_by
      ]
    );

    console.log("[INSERT] Reference PDF inserted successfully!");
    console.log("[INSERT] Insert ID:", (result as any).insertId);
  } catch (err: any) {
    console.error("[INSERT] Failed:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
