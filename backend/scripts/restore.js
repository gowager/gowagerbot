#!/usr/bin/env node
// Restore from a JSON snapshot produced by backup.js.
// Usage:  node scripts/restore.js <snapshot.json> [--dry-run]
//         npm run db:restore -- <snapshot.json> [--dry-run]

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

const TABLES = ['users', 'wallets', 'transactions', 'withdrawal_requests', 'games'];

async function main() {
  const snapPath = process.argv[2];
  if (!snapPath || !fs.existsSync(snapPath)) {
    console.error('Usage: node scripts/restore.js <snapshot.json> [--dry-run]');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set — cannot restore.');
    process.exit(1);
  }

  const dryRun = process.argv.includes('--dry-run');
  const snapshot = JSON.parse(fs.readFileSync(snapPath, 'utf8'));

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    for (const table of TABLES) {
      const rows = snapshot.tables?.[table] || [];
      if (rows.length === 0) continue;
      // Build column list from the first row
      const cols = Object.keys(rows[0]);
      const colList = cols.map(c => `"${c}"`).join(', ');
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
      const insertSql = `INSERT INTO "${table}" (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
      if (dryRun) {
        console.log(`[dry-run] ${table}: would insert ${rows.length} rows`);
      } else {
        for (const row of rows) {
          await client.query(insertSql, cols.map(c => row[c] ?? null));
        }
        console.log(`${table}: inserted ${rows.length} rows`);
      }
    }
    if (!dryRun) await client.query('COMMIT');
    else console.log('[dry-run] no changes written');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Restore failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
