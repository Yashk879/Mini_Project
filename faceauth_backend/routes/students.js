// Student profiles and face-capture images (HOD only).
const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { q, tx, getOwn, updateRow } = require('../db');
const { studentOut } = require('../queries');
const { fail, need, sameDept } = require('../helpers');
const { auth, hodOnly } = require('../auth');

const YEARS = ['1st Year', '2nd Year', '3rd Year', '4th Year'];
const STUDENT_FIELDS = { name: 'name', roll: 'roll', admissionNumber: 'admission_number', department: 'department', year: 'year',
  section: 'section', email: 'email', photo: 'photo', parentName: 'parent_name', parentPhone: 'parent_phone', parentEmail: 'parent_email' };

// Face images: JPEG only, max 5 files of 5 MB each, saved to ./uploads (never served publicly).
const upload = multer({ dest: 'uploads/', limits: { files: 5, fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype === 'image/jpeg') });

// FormData turns missing values into the text "undefined"; treat those as empty.
const clean = v => (v === undefined || v === null || v === 'undefined') ? '' : String(v).trim();
const removeFiles = rows => rows.forEach(r => fs.promises.unlink(r.file_path).catch(() => {}));

router.post('/students', auth, hodOnly, upload.array('images', 5), async (req, res) => {
  const b = req.body;
  need(b, ['name', 'roll', 'department', 'year']);
  if (!YEARS.includes(b.year)) fail(400, 'Choose a valid academic year (1st to 4th Year).');
  if (!sameDept(b.department, req.user.department)) fail(403, 'You can only register students in your own department.');
  const files = req.files || [];
  const student = await tx(async db => {
    const { rows: [s] } = await db.query(
      `INSERT INTO students (name, roll, admission_number, department, year, section, email, photo, face_capture_count, parent_name, parent_phone, parent_email)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [b.name.trim(), b.roll.trim(), clean(b.admissionNumber), b.department, b.year, clean(b.section) || 'Unassigned', clean(b.email),
       clean(b.photo), files.length, clean(b.parentName), clean(b.parentPhone), clean(b.parentEmail)]);
    for (const f of files) {
      await db.query('INSERT INTO student_faces (student_id, pose, file_path) VALUES ($1, $2, $3)', [s.id, path.parse(f.originalname).name, f.path]);
    }
    return s;
  });
  res.status(201).json({ ok: true, student: studentOut(student) });
});

router.put('/students/:id', auth, hodOnly, async (req, res) => {
  await getOwn('students', req.params.id, req.user);
  if (req.body.year && !YEARS.includes(req.body.year)) fail(400, 'Choose a valid academic year (1st to 4th Year).');
  if (req.body.department && !sameDept(req.body.department, req.user.department)) fail(403, 'You can only keep students in your own department.');
  res.json({ ok: true, student: studentOut(await updateRow('students', req.params.id, req.body, STUDENT_FIELDS)) });
});

router.delete('/students/:id', auth, hodOnly, async (req, res) => {
  await getOwn('students', req.params.id, req.user);
  const faces = await q('SELECT file_path FROM student_faces WHERE student_id = $1', [req.params.id]);
  await q('DELETE FROM students WHERE id = $1', [req.params.id]);   // enrolments, records and face rows cascade
  removeFiles(faces);
  res.json({ ok: true });
});

// Replace a student's 5 face captures.
router.post('/students/:id/face-captures', auth, hodOnly, upload.array('images', 5), async (req, res) => {
  await getOwn('students', req.params.id, req.user);
  const files = req.files || [];
  if (files.length !== 5) { removeFiles(files.map(f => ({ file_path: f.path }))); fail(400, 'Capture all five face poses before saving.'); }
  const { old, student } = await tx(async db => {
    const { rows: old } = await db.query('DELETE FROM student_faces WHERE student_id = $1 RETURNING file_path', [req.params.id]);
    for (const f of files) await db.query('INSERT INTO student_faces (student_id, pose, file_path) VALUES ($1, $2, $3)', [req.params.id, path.parse(f.originalname).name, f.path]);
    const { rows: [student] } = await db.query('UPDATE students SET face_capture_count = 5 WHERE id = $1 RETURNING *', [req.params.id]);
    return { old, student };
  });
  removeFiles(old);
  res.json({ ok: true, student: studentOut(student) });
});

module.exports = router;
