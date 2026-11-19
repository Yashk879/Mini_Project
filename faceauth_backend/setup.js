// One-time setup:  npm run setup   -> creates the tables and a few sample teachers.
const fs = require('fs');
const { pool } = require('./db');
const { hashPassword } = require('./auth');

const TEACHERS = [
  ['T101', 'Mrs. Anuksha Srivastava', 'anuksha.srivastava@college.edu', 'CSE', 'Associate Professor & HOD', 'hod'],
  ['T104', 'Prof. Karan Shah', 'karan.shah@college.edu', 'CSE', 'Assistant Professor', 'faculty'],
  ['T103', 'Dr. Meera Kulkarni', 'meera.kulkarni@college.edu', 'IT', 'Professor & HOD', 'hod'],
  ['T102', 'Dr. Rajesh Deshmukh', 'rajesh.deshmukh@college.edu', 'IT', 'Professor', 'faculty']
];

(async () => {
  await pool.query(fs.readFileSync(`${__dirname}/schema.sql`, 'utf8'));
  for (const [id, name, email, department, designation, role] of TEACHERS) {
    await pool.query(
      `INSERT INTO teachers (id, name, email, department, designation, role, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
      [id, name, email, department, designation, role, hashPassword('Test@1234')]);
  }
  console.log('Database ready. Sample logins: T101 (CSE HOD) or T104 (CSE faculty), password: Test@1234');
  await pool.end();
})().catch(err => { console.error('Setup failed:', err.message); process.exit(1); });
