// Database layer: one shared connection pool + small helpers used by every route.
require('dotenv').config();
const { Pool, types } = require('pg');
const { fail, sameDept } = require('./helpers');

types.setTypeParser(1082, value => value); // keep DATE columns as plain 'YYYY-MM-DD' strings
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const q = (text, params) => pool.query(text, params).then(result => result.rows);

// Run several queries as ONE unit: all succeed, or everything is rolled back.
async function tx(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Fetch a row and make sure it belongs to the logged-in user's department.
async function getOwn(table, id, user) {
  const [row] = await q(`SELECT * FROM ${table} WHERE id = $1`, [id]);   // table name is a constant from our code
  if (!row) fail(404, 'Record not found.');
  if (!sameDept(row.department, user.department)) fail(403, 'This record belongs to another department.');
  return row;
}

// Partial UPDATE. `fields` maps request keys -> column names (a whitelist), values are always parameters.
async function updateRow(table, id, body, fields) {
  const sets = [], values = [];
  for (const [key, column] of Object.entries(fields)) {
    if (body[key] === undefined) continue;
    // An empty id ('' = "no teacher / no subject") must become NULL to satisfy foreign keys.
    values.push(column.endsWith('_id') && body[key] === '' ? null : body[key]);
    sets.push(`${column} = $${values.length}`);
  }
  if (!sets.length) return (await q(`SELECT * FROM ${table} WHERE id = $1`, [id]))[0];
  values.push(id);
  const rows = await q(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`, values);
  return rows[0];
}

module.exports = { pool, q, tx, getOwn, updateRow };
