// Saving a lecture's attendance, plus HOD/teacher corrections with an audit trail.
const router = require('express').Router();
const { randomUUID } = require('crypto');
const { q, tx } = require('../db');
const { getSessions } = require('../queries');
const { fail, need, sameDept } = require('../helpers');
const { auth } = require('../auth');

// HODs manage their whole department; faculty only their own classes.
function canTeach(user, cls) {
  return user.role === 'hod' ? sameDept(cls.department, user.department) : cls.teacher_id === user.id;
}
async function getManagedSession(id, user) {
  const [s] = await q(`SELECT s.id, c.department, c.teacher_id FROM sessions s LEFT JOIN classes c ON c.id = s.class_id WHERE s.id = $1`, [id]);
  if (!s) fail(404, 'Session not found.');
  if (!canTeach(user, s)) fail(403, 'You can edit attendance only for your assigned subjects.');
  return s;
}

// Called when a teacher presses "Finish & Save Register".
router.post('/sessions/end', auth, async (req, res) => {
  const s = req.body;
  need(s, ['id', 'lectureDate', 'subject']);
  if (!Array.isArray(s.studentIds)) fail(400, 'studentIds must be a list.');
  const [cls] = await q('SELECT * FROM classes WHERE id = $1', [s.id]);   // the frontend sends the class id as "id"
  if (!cls) fail(404, 'Class not found.');
  if (!canTeach(req.user, cls)) fail(403, 'You do not have access to this teaching assignment.');

  // Everyone on the roll gets a row; students not marked present are saved as "absent".
  const present = s.present || {};
  const ids = s.studentIds.map(Number);
  const mark = id => present[id];
  const statuses = ids.map(id => !mark(id) ? 'absent' : mark(id).late ? 'late' : mark(id).status || 'present');
  const methods = ids.map(id => mark(id)?.method || 'system');
  const times = ids.map(id => mark(id)?.time || null);
  const scores = ids.map(id => mark(id)?.score ?? null);

  const sessionId = `sess-${randomUUID().slice(0, 8)}`;
  await tx(async db => {
    await db.query(
      `INSERT INTO sessions (id, class_id, date_iso, lecture_time, subject, subject_id, subject_code, section, room, notes, unknown_count, term_id, academic_year, semester)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [sessionId, cls.id, s.lectureDate, s.lectureTime || '', s.subject, s.subjectId || null, s.subjectCode || null, s.label || cls.label,
       s.room || '', s.notes || '', Number(s.unknownCount) || 0, s.termId || null, s.academicYear || null, s.semester || null]);
    await db.query(
      `INSERT INTO session_records (session_id, student_id, status, method, marked_at, score)
       SELECT $1, * FROM unnest($2::int[], $3::text[], $4::text[], $5::text[], $6::real[])`,
      [sessionId, ids, statuses, methods, times, scores]);
  });
  res.status(201).json({ ok: true, session: (await getSessions('WHERE s.id = $1', [sessionId]))[0] });
});

// Correct one student's status in a saved lecture. A reason is mandatory and logged.
router.put('/sessions/:id/records/:studentId', auth, async (req, res) => {
  need(req.body, ['status', 'reason']);
  await getManagedSession(req.params.id, req.user);
  await tx(async db => {
    const { rows: [old] } = await db.query('SELECT status FROM session_records WHERE session_id = $1 AND student_id = $2', [req.params.id, req.params.studentId]);
    if (!old) fail(404, 'Student record not found in this session.');
    await db.query(`UPDATE session_records SET status = $1, method = 'manual (override)' WHERE session_id = $2 AND student_id = $3`, [req.body.status, req.params.id, req.params.studentId]);
    await db.query('INSERT INTO audit_log (session_id, student_id, from_status, to_status, changed_by, reason) VALUES ($1, $2, $3, $4, $5, $6)',
      [req.params.id, req.params.studentId, old.status, req.body.status, req.user.id, req.body.reason]);
  });
  res.json({ ok: true, session: (await getSessions('WHERE s.id = $1', [req.params.id]))[0] });
});

router.delete('/sessions/:id', auth, async (req, res) => {
  await getManagedSession(req.params.id, req.user);
  await q('DELETE FROM sessions WHERE id = $1', [req.params.id]);   // its records cascade
  res.json({ ok: true });
});

module.exports = router;
