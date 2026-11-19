// Small shared helpers: errors, validation, naming, and the central error handler.
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

// Throw 400 if any required field is missing or blank.
function need(body, fields) {
  const missing = fields.filter(f => body[f] === undefined || body[f] === null || String(body[f]).trim() === '');
  if (missing.length) fail(400, `Missing required field(s): ${missing.join(', ')}`);
}

const sameDept = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

// Database uses snake_case (date_iso); the frontend expects camelCase (dateISO).
const camel = row => Object.fromEntries(Object.entries(row).map(([key, value]) =>
  [key.replace(/_([a-z])/g, (_, c) => c.toUpperCase()).replace(/Iso$/, 'ISO'), value]));

// Express 5 forwards errors from async handlers here automatically.
function errorHandler(err, req, res, next) {
  const send = (status, error) => res.status(status).json({ ok: false, error });
  if (err.status) return send(err.status, err.message);
  if (err.name === 'MulterError') return send(400, `Upload problem: ${err.message}`);
  if (err.type === 'entity.too.large') return send(413, 'Request is too large.');
  if (err instanceof SyntaxError && err.status === 400) return send(400, 'Invalid JSON.');
  if (err.code === '23505') return send(409, `Duplicate value: ${err.detail || 'record already exists.'}`);
  if (err.code === '23503') return send(400, 'A related record (teacher, subject, class or student) was not found.');
  if (err.code === '23514' || err.code === '22P02') return send(400, 'One of the values is invalid.');
  console.error(err);
  send(500, 'Internal server error.');
}

module.exports = { fail, need, sameDept, camel, errorHandler };
