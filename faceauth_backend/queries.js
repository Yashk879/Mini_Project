// Reusable read queries. They return the same shapes the frontend already uses.
const { q } = require('./db');
const { camel } = require('./helpers');

const getClasses = (where = '', params = []) => q(`
  SELECT c.*, COALESCE(array_agg(cs.student_id ORDER BY cs.student_id) FILTER (WHERE cs.student_id IS NOT NULL), '{}') AS student_ids
  FROM classes c LEFT JOIN class_students cs ON cs.class_id = c.id
  ${where} GROUP BY c.id ORDER BY c.label`, params).then(rows => rows.map(camel));

const studentOut = row => { const { enrolledOn, ...s } = camel(row); return { ...s, date: enrolledOn }; };

// A lecture + its per-student records, rebuilt into the frontend's session shape.
const getSessions = (where = '', params = []) => q(`
  SELECT s.id, s.class_id, s.date_iso, to_char(s.date_iso, 'DD Mon YYYY') AS date,
         to_char(s.created_at, 'HH12:MI AM') AS time, s.lecture_time, s.subject, s.subject_id, s.subject_code,
         s.section, s.section AS class_label, s.room, s.notes, s.unknown_count, s.term_id, s.academic_year, s.semester,
         (COUNT(*) FILTER (WHERE r.status <> 'absent'))::int AS present,
         (COUNT(*) FILTER (WHERE r.status = 'absent'))::int  AS absent,
         COALESCE(array_agg(r.student_id::text) FILTER (WHERE r.student_id IS NOT NULL), '{}') AS student_ids,
         COALESCE(array_agg(r.student_id::text) FILTER (WHERE r.status <> 'absent'), '{}')     AS present_ids,
         COALESCE(array_agg(r.student_id::text) FILTER (WHERE r.status = 'absent'), '{}')      AS absent_ids,
         COALESCE(jsonb_object_agg(r.student_id::text, jsonb_build_object('status', r.status, 'method', r.method, 'time', r.marked_at, 'score', r.score))
                  FILTER (WHERE r.student_id IS NOT NULL), '{}') AS records
  FROM sessions s LEFT JOIN session_records r ON r.session_id = s.id
  ${where} GROUP BY s.id ORDER BY s.date_iso DESC, s.created_at DESC`, params).then(rows => rows.map(camel));

module.exports = { getClasses, studentOut, getSessions };
