const mysql = require('mysql2/promise');
async function drop() {
    const conn = await mysql.createConnection('mysql://3aB5mZmKUqE2oxd.root:2gt8ofhPD6BQfJJHqvanr8uDh4PWZS0t@ep-t4ni387b5e83b7519dc8.epsrv-t4n281l4mrmemi4zls9a.ap-southeast-1.privatelink.aliyuncs.com:4000/19de1f67-cdc2-8cf9-8000-09e4db1c7daf');
    await conn.execute('DROP TABLE IF EXISTS tasks');
    await conn.execute('DROP TABLE IF EXISTS equipment');
    console.log('Tables dropped');
    await conn.end();
}
drop().catch(e => { console.error(e); process.exit(1); });
