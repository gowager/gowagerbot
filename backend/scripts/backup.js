#!/usr/bin/env node
// Export all critical tables to a JSON snapshot.
// Usage:  node scripts/backup.js [output-path]
//         npm run db:backup

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const TABLES = ['users', 'wallets', 'transactions', 'withdrawal_requests', 'games'];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set — nothing to back up.');
    process.exit(1);
  }

  const outFile = process.argv[2] || `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const outPath = path.resolve(outFile);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();

  const snapshot = { exportedAt: new Date().toISOString(), tables: {} };
  try {
    for (const table of TABLES) {
      const res = await client.query(`SELECT * FROM "${table}"`);
      snapshot.tables[table] = res.rows;
    }
    fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
    const counts = TABLES.map(t => `${t}: ${snapshot.tables[t].length}`).join(', ');
    console.log(`Backup written to ${outPath}`);
    console.log(`Counts: ${counts}`);
  } catch (err) {
    console.error('Backup failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
