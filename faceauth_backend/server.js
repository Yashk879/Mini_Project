// Entry point: middleware, routes, error handling.
require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { q } = require('./db');
const { auth } = require('./auth');
const { camel, errorHandler } = require('./helpers');
const { getClasses, getSessions, studentOut } = require('./queries');

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true }));
app.use(express.json({ limit: '3mb' }));   // profile photos / ID cards arrive as base64 text

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api', require('./routes/teachers'));
app.use('/api', require('./routes/academic'));
app.use('/api', require('./routes/students'));
app.use('/api', require('./routes/sessions'));

// One call that loads everything the logged-in user may see (their department only).
app.get('/api/bootstrap', auth, async (req, res) => {
  const { department, role } = req.user;
  const dept = 'lower(department) = lower($1)';
  const [teachers, students, subjects, classes, history, auditLog] = await Promise.all([
    q(`SELECT id, name, email, department, designation, role FROM teachers WHERE ${dept}`, [department]),
    q(`SELECT * FROM students WHERE ${dept} ORDER BY name`, [department]),
    q(`SELECT * FROM subjects WHERE ${dept} ORDER BY code`, [department]),
    getClasses(`WHERE lower(c.department) = lower($1)`, [department]),
    getSessions(`WHERE s.class_id IN (SELECT id FROM classes WHERE ${dept})`, [department]),
    q(`SELECT session_id, student_id::text AS student_id, from_status AS "from", to_status AS "to", changed_by AS by, reason, changed_at AS at
       FROM audit_log WHERE session_id IN (SELECT s.id FROM sessions s JOIN classes c ON c.id = s.class_id WHERE lower(c.department) = lower($1)) ORDER BY id`, [department])
  ]);
  res.json({
    ok: true,
    teachers: teachers.map(camel),
    // Faculty see only the basics; contact details are for HODs.
    students: students.map(studentOut).map(s => role === 'hod' ? s : { id: s.id, name: s.name, roll: s.roll, section: s.section, photo: s.photo }),
    subjects: subjects.map(camel), classes, history, auditLog: auditLog.map(camel)
  });
});

// Face matching needs a separate recognition service (Python/ML). Until one is connected, say so politely.
app.post('/api/recognize', auth, (req, res) =>
  res.json({ status: 'unavailable', message: 'No face-recognition service is connected yet. Use manual roll call.' }));

if (process.env.FRONTEND_DIR) app.use(express.static(path.resolve(process.env.FRONTEND_DIR)));
app.use('/api', (req, res) => res.status(404).json({ ok: false, error: 'Route not found.' }));
app.use(errorHandler);

const PORT = process.env.PORT || 8000;   // the frontend's api.js expects port 8000
app.listen(PORT, () => console.log(`FaceAuth API running on http://localhost:${PORT}`));
