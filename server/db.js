const { Pool, types } = require('pg');

// bigint ids (matches.id, counts) come back as strings by default; ours are small, so use real numbers.
types.setTypeParser(types.builtins.INT8, Number);

// Tiger URL carries sslmode=require. Call dotenv.config() before requiring this module.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Every repository query goes through here; pass a client to run inside a transaction.
const q = (sql, params = [], client = pool) => client.query(sql, params).then(r => r.rows);

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { pool, q, tx };
