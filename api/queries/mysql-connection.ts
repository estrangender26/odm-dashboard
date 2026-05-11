import mysql from "mysql2/promise";

let _pool: mysql.Pool | null = null;

export function getMySQLPool(): mysql.Pool {
  if (_pool) return _pool;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL not set");
  }

  _pool = mysql.createPool({
    uri: databaseUrl,
    connectionLimit: 10,
    enableKeepAlive: true,
  });

  return _pool;
}

export async function query<T = any>(sql: string, params?: any[]): Promise<T[]> {
  const pool = getMySQLPool();
  const [rows] = await pool.query(sql, params);
  return rows as T[];
}

export async function execute(sql: string, params?: any[]): Promise<any> {
  const pool = getMySQLPool();
  const [result] = await pool.execute(sql, params);
  return result;
}
