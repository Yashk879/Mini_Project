-- FaceAuth database schema (PostgreSQL). Safe to run more than once.
CREATE TABLE IF NOT EXISTS teachers (
  id            TEXT PRIMARY KEY,                       -- e.g. T101
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  department    TEXT NOT NULL,
  designation   TEXT NOT NULL DEFAULT 'Assistant Professor',
  role          TEXT NOT NULL DEFAULT 'faculty' CHECK (role IN ('hod', 'faculty')),
  password_hash TEXT NOT NULL,                          -- salted scrypt hash, never the password
  id_card       JSONB,                                  -- optional uploaded faculty ID card
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Business rule enforced by the database: only ONE HOD per department.
CREATE UNIQUE INDEX IF NOT EXISTS one_hod_per_department ON teachers (lower(department)) WHERE role = 'hod';

CREATE TABLE IF NOT EXISTS subjects (
  id              TEXT PRIMARY KEY,
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  department      TEXT NOT NULL,
  year            TEXT NOT NULL,
  semester        TEXT,
  semester_number INT,
  term_id         TEXT,
  credits         INT NOT NULL DEFAULT 0 CHECK (credits >= 0),
  UNIQUE (code, term_id)
);

CREATE TABLE IF NOT EXISTS classes (                    -- a section, optionally linked to a subject + teacher
  id         TEXT PRIMARY KEY,
  label      TEXT NOT NULL,                             -- e.g. CSE-21
  department TEXT NOT NULL,
  year       TEXT NOT NULL,
  section    TEXT NOT NULL,
  subject    TEXT NOT NULL DEFAULT '',
  code       TEXT NOT NULL DEFAULT '',
  subject_id TEXT REFERENCES subjects(id) ON DELETE SET NULL,
  room       TEXT NOT NULL DEFAULT '',
  time       TEXT NOT NULL DEFAULT '',
  days       TEXT[] NOT NULL DEFAULT '{}',
  term_id    TEXT,
  teacher_id TEXT REFERENCES teachers(id) ON UPDATE CASCADE ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS one_class_per_subject_term
  ON classes (lower(department), year, lower(label), COALESCE(subject_id, ''), COALESCE(term_id, ''));
CREATE INDEX IF NOT EXISTS classes_department_idx ON classes (lower(department));

CREATE TABLE IF NOT EXISTS students (
  id               SERIAL PRIMARY KEY,
  name             TEXT NOT NULL,
  roll             TEXT NOT NULL UNIQUE,
  admission_number TEXT NOT NULL DEFAULT '',
  department       TEXT NOT NULL,
  year             TEXT NOT NULL CHECK (year IN ('1st Year', '2nd Year', '3rd Year', '4th Year')),
  section          TEXT NOT NULL DEFAULT 'Unassigned',
  email            TEXT NOT NULL DEFAULT '',
  photo            TEXT NOT NULL DEFAULT '',            -- profile photo as a data URL
  face_capture_count INT NOT NULL DEFAULT 0,
  parent_name      TEXT NOT NULL DEFAULT '',
  parent_phone     TEXT NOT NULL DEFAULT '',
  parent_email     TEXT NOT NULL DEFAULT '',
  enrolled_on      DATE NOT NULL DEFAULT CURRENT_DATE
);
CREATE UNIQUE INDEX IF NOT EXISTS students_admission_unique ON students (lower(admission_number)) WHERE admission_number <> '';
CREATE INDEX IF NOT EXISTS students_department_idx ON students (lower(department));

CREATE TABLE IF NOT EXISTS student_faces (              -- the 5 captured face poses (files stay on disk)
  id         SERIAL PRIMARY KEY,
  student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  pose       TEXT NOT NULL,
  file_path  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS class_students (             -- many-to-many: which students are in which class
  class_id   TEXT REFERENCES classes(id)  ON DELETE CASCADE,
  student_id INT  REFERENCES students(id) ON DELETE CASCADE,
  PRIMARY KEY (class_id, student_id)
);
CREATE INDEX IF NOT EXISTS class_students_student_idx ON class_students (student_id);

CREATE TABLE IF NOT EXISTS sessions (                   -- one conducted lecture
  id            TEXT PRIMARY KEY,
  class_id      TEXT REFERENCES classes(id) ON DELETE SET NULL,   -- history survives if a class is removed
  date_iso      DATE NOT NULL,
  lecture_time  TEXT NOT NULL DEFAULT '',
  subject       TEXT NOT NULL,
  subject_id    TEXT REFERENCES subjects(id) ON DELETE SET NULL,
  subject_code  TEXT,
  section       TEXT NOT NULL,
  room          TEXT NOT NULL DEFAULT '',
  notes         TEXT NOT NULL DEFAULT '',
  unknown_count INT NOT NULL DEFAULT 0,
  term_id       TEXT,
  academic_year TEXT,
  semester      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- The same lecture cannot be recorded twice.
CREATE UNIQUE INDEX IF NOT EXISTS one_session_per_slot ON sessions (class_id, date_iso, lecture_time, COALESCE(subject_id, ''));

CREATE TABLE IF NOT EXISTS session_records (            -- one row per student per lecture
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  student_id INT  REFERENCES students(id) ON DELETE CASCADE,
  status     TEXT NOT NULL CHECK (status IN ('present', 'late', 'on-duty', 'medical', 'absent')),
  method     TEXT NOT NULL DEFAULT 'manual',            -- face / manual
  marked_at  TEXT,
  score      REAL,                                      -- face-match confidence
  PRIMARY KEY (session_id, student_id)
);
CREATE INDEX IF NOT EXISTS session_records_student_idx ON session_records (student_id);

CREATE TABLE IF NOT EXISTS audit_log (                  -- every manual change to saved attendance
  id          SERIAL PRIMARY KEY,
  session_id  TEXT,
  student_id  INT,
  from_status TEXT,
  to_status   TEXT,
  changed_by  TEXT,
  reason      TEXT NOT NULL,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);