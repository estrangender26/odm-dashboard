import mysql from "mysql2/promise";

async function main() {
  const pool = mysql.createPool(process.env.DATABASE_URL!);
  try {
    // Test the exact queries the API uses
    const [states] = await pool.query(
      `SELECT id, facility_slug, milestone_id, ppp_date, comp_date, custom_pct 
       FROM governance_milestone_state 
       WHERE facility_slug = 'aglipay'`
    );
    console.log("States:", (states as any[]).length);

    const [files] = await pool.query(
      `SELECT id, facility_slug, milestone_id, category, toc_item, file_name, uploaded_by, uploaded_at
       FROM governance_uploads 
       WHERE facility_slug = 'aglipay' OR facility_slug = 'all'
       ORDER BY id DESC`
    );
    const allFiles = files as any[];
    console.log("All files:", allFiles.length);

    const refFiles = allFiles.filter(f => f.milestone_id === '__ref' || f.category === 'references');
    const msFiles = allFiles.filter(f => f.milestone_id !== '__ref' && f.category !== 'references');
    console.log("Ref files:", refFiles.length);
    console.log("MS files:", msFiles.length);

    refFiles.forEach(f => console.log("  REF:", f.id, f.file_name));
    msFiles.slice(0, 5).forEach(f => console.log("  MS:", f.id, f.milestone_id, f.file_name));

  } catch (e: any) {
    console.error("Error:", e.message);
  } finally {
    await pool.end();
  }
}

main();
