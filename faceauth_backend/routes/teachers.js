// Login, faculty registration, and HOD-only teacher management.
const router = require('express').Router();
const crypto = require('crypto');
const { q, tx, getOwn } = require('../db');
const { camel, fail, need } = require('../helpers');
const { auth, hodOnly, hashPassword, verifyPassword, signToken } = require('../auth');

// Never send the password hash (or ID-card file) back to the browser.
const publicTeacher = row => { const { passwordHash, idCard, ...rest } = camel(row); return rest; };

router.post('/login', async (req, res) => {
  need(req.body, ['id', 'password']);
  const [teacher] = await q('SELECT * FROM teachers WHERE lower(id) = lower($1) OR lower(email) = lower($1)', [String(req.body.id).trim()]);
  if (!teacher || !verifyPassword(String(req.body.password), teacher.password_hash)) fail(401, 'Invalid Teacher ID/Email or Password.');
  res.json({ ok: true, token: signToken(teacher), teacher: publicTeacher(teacher) });
});

router.post('/teachers', async (req, res) => {
  need(req.body, ['name', 'email', 'password']);
  const { name, email, password, department = 'CSE', designation = 'Assistant Professor', facultyIdCard = null } = req.body;
  if (!/^\S+@\S+\.\S+$/.test(email)) fail(400, 'Enter a valid email address.');
  if (String(password).length < 6) fail(400, 'Password must be at least 6 characters.');
  const id = 'T' + crypto.randomBytes(4).toString('hex').toUpperCase();
  // Role is always "faculty" here: a client must never be able to register itself as HOD.
  const [teacher] = await q(
    `INSERT INTO teachers (id, name, email, department, designation, role, password_hash, id_card)
     VALUES ($1, $2, lower($3), $4, $5, 'faculty', $6, $7) RETURNING *`,
    [id, name.trim(), email.trim(), String(department).trim().toUpperCase(), designation, hashPassword(String(password)),
     facultyIdCard && JSON.stringify(facultyIdCard)]);
  res.status(201).json({ ok: true, token: signToken(teacher), teacher: publicTeacher(teacher) });
});

// Make someone HOD (the old HOD of that department becomes faculty, in one transaction).
router.put('/teachers/:id/role', auth, hodOnly, async (req, res) => {
  const { role } = req.body;
  if (!['hod', 'faculty'].includes(role)) fail(400, 'Choose a valid teacher role.');
  const target = await getOwn('teachers', req.params.id, req.user);
  const updated = await tx(async db => {
    if (role === 'hod') await db.query(`UPDATE teachers SET role = 'faculty' WHERE lower(department) = lower($1) AND role = 'hod'`, [target.department]);
    return (await db.query('UPDATE teachers SET role = $1 WHERE id = $2 RETURNING *', [role, target.id])).rows[0];
  });
  res.json({ ok: true, teacher: publicTeacher(updated) });
});

// Change a Teacher ID. Foreign keys use ON UPDATE CASCADE, so their classes follow automatically.
router.put('/teachers/:id', auth, hodOnly, async (req, res) => {
  need(req.body, ['id']);
  await getOwn('teachers', req.params.id, req.user);
  const [teacher] = await q('UPDATE teachers SET id = $1 WHERE id = $2 RETURNING *', [String(req.body.id).trim(), req.params.id]);
  res.json({ ok: true, teacher: publicTeacher(teacher) });
});

module.exports = router;