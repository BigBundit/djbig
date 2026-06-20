import mysql from 'mysql2/promise';

let pool: mysql.Pool | null = null;

export function getDb(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST || 'sv158.hostsevenplus.com',
      user: process.env.MYSQL_USER || 'lastprize_djbig',
      password: process.env.MYSQL_PASSWORD || '',
      database: process.env.MYSQL_DATABASE || 'lastprize_djbig',
      port: parseInt(process.env.MYSQL_PORT || '3306'),
      waitForConnections: true,
      connectionLimit: 10,
      connectTimeout: 10000,
    });
  }
  return pool;
}

export async function initMysqlDb(): Promise<void> {
  const db = getDb();

  await db.execute(`
    CREATE TABLE IF NOT EXISTS djbig_users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      google_id VARCHAR(128) UNIQUE NOT NULL,
      email VARCHAR(255) NOT NULL,
      name VARCHAR(255),
      picture VARCHAR(500),
      created_at DATETIME DEFAULT NOW()
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS djbig_payment_slips (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      email VARCHAR(255) NOT NULL,
      name VARCHAR(255),
      slip_filename VARCHAR(255),
      status ENUM('pending','approved','rejected') DEFAULT 'pending',
      submitted_at DATETIME DEFAULT NOW(),
      reviewed_at DATETIME NULL,
      notes TEXT NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS djbig_license_keys (
      id INT AUTO_INCREMENT PRIMARY KEY,
      license_key VARCHAR(36) UNIQUE NOT NULL,
      user_id INT NOT NULL,
      email VARCHAR(255) NOT NULL,
      slip_id INT NOT NULL,
      created_at DATETIME DEFAULT NOW(),
      activated_at DATETIME NULL,
      machine_id VARCHAR(64) DEFAULT NULL,
      status ENUM('unused','active','revoked') DEFAULT 'unused'
    )
  `);

  // Migration: add machine_id to existing tables that were created before this column
  try {
    await db.execute(`ALTER TABLE djbig_license_keys ADD COLUMN machine_id VARCHAR(64) DEFAULT NULL`);
    console.log('[MySQL] Added machine_id column');
  } catch (e: any) {
    if (!e.message?.includes('Duplicate column')) console.warn('[MySQL] machine_id migration:', e.message);
  }

  console.log('[MySQL] Tables ready');
}
