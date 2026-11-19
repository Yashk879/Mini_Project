// Subjects and classes (sections), including who is enrolled in each class.
const router = require('express').Router();
const { randomUUID } = require('crypto');
const { q, getOwn, updateRow } = require('../db');
const { getClasses } = require('../queries');
const { camel, fail, need, sameDept } = require('../helpers');
const { auth, hodOnly } = require('../auth');

// Whitelists: only these request fields can ever be written.
const SUBJECT_FIELDS = { code: 'code', name: 'name', department: 'department', year: 'year', semester: 'semester',
  semesterNumber: 'semester_number', termId: 'term_id', credits: 'credits' };
const CLASS_FIELDS = { label: 'label', section: 'section', subject: 'subject', code: 'code', subjectId: 'subject_id', room: 'room',
  time: 'time', days: 'days', teacherId: 'teacher_id', year: 'year', termId: 'term_id' };

const idOf = prefix => `${prefix}-${randomUUID().slice(0, 8)}`;
const getClass = async id => (await getClasses('WHERE c.id = $1', [id]))[0];

// ---------- Subjects (HOD only) ----------
router.post('/subjects', auth, hodOnly, async (req, res) => {
  const b = req.body;
  need(b, ['code', 'name', 'department', 'year']);
  if (!sameDept(b.department, req.user.department)) fail(403, 'You can only manage subjects in your own department.');
  const [subject] = await q(
    `INSERT INTO subjects (id, code, name, department, year, semester, semester_number, term_id, credits)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [b.id || idOf('sub'), b.code.trim(), b.name.trim(), b.department, b.year, b.semester || null, b.semesterNumber || null, b.termId || null, b.credits || 0]);
  res.status(201).json({ ok: true, subject: camel(subject) });
});

router.put('/subjects/:id', auth, hodOnly, async (req, res) => {
  await getOwn('subjects', req.params.id, req.user);
  if (req.body.department && !sameDept(req.body.department, req.user.department)) fail(403, 'You can only manage subjects in your own department.');
  res.json({ ok: true, subject: camel(await updateRow('subjects', req.params.id, req.body, SUBJECT_FIELDS)) });
});

router.delete('/subjects/:id', auth, hodOnly, async (req, res) => {
  await getOwn('subjects', req.params.id, req.user);
  await q('DELETE FROM subjects WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ---------- Classes ----------
router.post('/classes', auth, async (req, res) => {
  const b = req.body, user = req.user;
  need(b, ['department', 'year', 'label']);
  if (!sameDept(b.department, user.department)) fail(403, 'Classes can only be created in your own department.');
  const teacherId = b.teacherId || user.id;
  if (user.role !== 'hod' && teacherId !== user.id) fail(403, 'Faculty can only create their own assignments.');
  const id = idOf('class');
  await q(
    `INSERT INTO classes (id, label, department, year, section, subject, code, subject_id, room, time, days, term_id, teacher_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [id, b.label, b.department, b.year, b.section || b.label, b.subject || '', b.code || '', b.subjectId || null,
     b.room || '', b.time || '', b.days || [], b.termId || null, teacherId]);
  res.status(201).json({ ok: true, class: await getClass(id) });
});

router.patch('/classes/:id', auth, async (req, res) => {
  const cls = await getOwn('classes', req.params.id, req.user);
  const isHod = req.user.role === 'hod';
  if (!isHod && cls.teacher_id !== req.user.id) fail(403, 'You do not have access to this class.');
  if (!isHod && req.body.teacherId !== undefined) fail(403, 'Only the HOD can assign classes to other faculty.');
  await updateRow('classes', cls.id, req.body, CLASS_FIELDS);
  res.json({ ok: true, class: await getClass(cls.id) });
});

router.delete('/classes/:id', auth, hodOnly, async (req, res) => {
  await getOwn('classes', req.params.id, req.user);
  await q('DELETE FROM classes WHERE id = $1', [req.params.id]);   // saved attendance history is kept
  res.json({ ok: true });
});

// ---------- Enrolment ----------
router.post('/classes/:id/students', auth, hodOnly, async (req, res) => {
  need(req.body, ['studentId']);
  const cls = await getOwn('classes', req.params.id, req.user);
  await q('INSERT INTO class_students (class_id, student_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [cls.id, Number(req.body.studentId)]);
  res.json({ ok: true, class: await getClass(cls.id) });
});

router.delete('/classes/:id/students/:studentId', auth, hodOnly, async (req, res) => {
  const cls = await getOwn('classes', req.params.id, req.user);
  await q('DELETE FROM class_students WHERE class_id = $1 AND student_id = $2', [cls.id, Number(req.params.studentId)]);
  res.json({ ok: true, class: await getClass(cls.id) });
});

module.exports = router;
