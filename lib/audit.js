const fs   = require('fs');
const path = require('path');

const DATA_DIR   = path.join(__dirname, '..', 'data');
const AUDIT_FILE = path.join(DATA_DIR, 'audit.log');

function logAudit(entry) {
  const record = {
    timestamp: new Date().toISOString(),
    ...entry,
  };

  const line = JSON.stringify(record) + '\n';

  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.appendFileSync(AUDIT_FILE, line);
  } catch (err) {
    // Audit logging should never crash the app
    console.error('Audit write failed:', err.message);
  }
}

function getRecentAuditEntries(limit = 50) {
  try {
    const content = fs.readFileSync(AUDIT_FILE, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map(line => JSON.parse(line));
  } catch {
    return [];
  }
}

module.exports = { logAudit, getRecentAuditEntries };
