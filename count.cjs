
const mysql = require('mysql2/promise');
async function count() {
    const conn = await mysql.createConnection('mysql://3aB5mZmKUqE2oxd.root:2gt8ofhPD6BQfJJHqvanr8uDh4PWZS0t@ep-t4ni387b5e83b7519dc8.epsrv-t4n281l4mrmemi4zls9a.ap-southeast-1.privatelink.aliyuncs.com:4000/19de1f67-cdc2-8cf9-8000-09e4db1c7daf');
    const [eq] = await conn.execute('SELECT COUNT(*) as c FROM equipment');
    const [tk] = await conn.execute('SELECT COUNT(*) as c FROM tasks');
    console.log('Equipment:', eq[0].c);
    console.log('Tasks:', tk[0].c);
    await conn.end();
}
count().catch(e => { console.error(e); process.exit(1); });
