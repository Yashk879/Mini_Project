# FaceAuth Backend (Node.js + Express + PostgreSQL)

REST API for the FaceAuth college attendance frontend. It replaces the browser's mock data
(`USE_MOCK = true` in `api.js`) with a real database.

## 1. Run it
```bash
npm install
cp .env.example .env        # then edit DATABASE_URL (your Postgres password) and JWT_SECRET
createdb faceauth           # or: psql -U postgres -c "CREATE DATABASE faceauth;"
npm run setup               # creates the tables + sample teachers
npm start                   # http://localhost:8000
```
Sample logins (password `Test@1234`): **T101** (CSE HOD), **T104** (CSE faculty), T103 (IT HOD), T102 (IT faculty).
Optional: set `FRONTEND_DIR=../miniproject_frontend` in `.env` and open http://localhost:8000 to serve the frontend from the same server.

## 2. Connect the frontend (5 small edits in `api.js`)
```js
// (1) top of file
const USE_MOCK = false;

// (2) apiRequest: send the login token with every request
async function apiRequest(path, options = {}) {
  try {
    const token = localStorage.getItem('faceauthToken');
    const headers = { ...(options.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
    // ...rest unchanged

// (3) new helper: load the user's data from PostgreSQL after login
async function loadFromServer() {
  const data = await apiRequest('/bootstrap');
  if (!data.ok) return;
  Object.assign(DB, { teachers: data.teachers, students: data.students, classes: data.classes,
                      subjects: data.subjects, history: data.history, auditLog: data.auditLog });
  DB.save();
}

// (4) FaceAPI.login (non-mock part): make the callback async and save the token first
}).then(async result => {
  if (result.ok && result.token) { localStorage.setItem('faceauthToken', result.token); await loadFromServer(); }
  // ...existing code unchanged

// (5) FaceAPI.registerTeacher (non-mock part): save the token; FaceAPI.logout: remove it
if (result.ok && result.token) localStorage.setItem('faceauthToken', result.token);
localStorage.removeItem('faceauthToken');   // inside logout()
```
Notes: the "1-Click Demo Login" button is frontend-only (no token), so use a real login while connected.
Passwords must be at least 6 characters (the signup form allows 4).

## 3. Endpoints (all JSON, errors look like `{ "ok": false, "error": "..." }`)
| Method | URL | Who | Purpose |
|---|---|---|---|
| POST | /api/login | public | Sign in (Teacher ID or email) -> token |
| POST | /api/teachers | public | Register faculty (always role `faculty`) |
| PUT | /api/teachers/:id/role | HOD | Make HOD / faculty (one HOD per department) |
| PUT | /api/teachers/:id | HOD | Change Teacher ID |
| POST/PUT/DELETE | /api/subjects[/:id] | HOD | Manage subjects |
| POST | /api/classes | any teacher | Create a section (faculty: only their own) |
| PATCH | /api/classes/:id | HOD or its teacher | Edit schedule / subject / teacher |
| DELETE | /api/classes/:id | HOD | Remove a section (history is kept) |
| POST/DELETE | /api/classes/:id/students[/:studentId] | HOD | Enrol / unenrol |
| POST/PUT/DELETE | /api/students[/:id] | HOD | Student profiles (POST accepts 5 face images) |
| POST | /api/students/:id/face-captures | HOD | Replace the 5 face images |
| POST | /api/sessions/end | HOD or the class teacher | Save a lecture's attendance |
| PUT | /api/sessions/:id/records/:studentId | HOD or class teacher | Correct a status (reason required, audited) |
| DELETE | /api/sessions/:id | HOD or class teacher | Delete a lecture |
| GET | /api/bootstrap | any teacher | Everything the user may see (own department) |
| POST | /api/recognize | any teacher | Placeholder: needs a separate face-recognition service |

## 4. Design points to explain
- **Layers:** `routes/` (HTTP) -> `queries.js` / `db.js` (SQL) -> PostgreSQL. `helpers.js` holds validation and the single error handler.
- **Security:** salted `scrypt` password hashes; JWT login (8 h); role checks (`hodOnly`) and department scoping on every write;
  every SQL value is a parameter (`$1, $2`) and column names come from fixed whitelists, so no SQL injection;
  a client can never register itself as HOD; face images are JPEG-only, size-limited and not served publicly.
- **Database rules live in the schema:** foreign keys, `CHECK` constraints, unique roll numbers, one HOD per department,
  the same lecture cannot be saved twice, `ON UPDATE CASCADE` when a Teacher ID changes.
- **Transactions:** saving a lecture (session + one record per student) and changing the HOD happen all-or-nothing.
- **Normalised attendance:** present/absent counts are computed from `session_records`, never stored twice.

## 5. Not included / limits
- Real face matching (`/api/recognize` is a stub). Semesters/terms are still created in the browser.
- No rate limiting on login and no password reset. Add `express-rate-limit` before real-world use.
