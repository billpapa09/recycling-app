const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Admin password
const ADMIN_PASSWORD = 'admin123';

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Database
const db = new Database(path.join(__dirname, 'database.sqlite'));

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    firstName TEXT NOT NULL,
    lastName TEXT NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  
  CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    locationId INTEGER NOT NULL,
    date TEXT NOT NULL,
    bottles INTEGER NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (userId) REFERENCES users(id)
  );
  
  CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    locationId INTEGER NOT NULL,
    date TEXT NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (userId) REFERENCES users(id)
  );
`);

// Load data
const locationsPath = path.join(__dirname, 'data', 'locations.json');
const locations = JSON.parse(fs.readFileSync(locationsPath, 'utf8'));

const allowedUsersPath = path.join(__dirname, 'data', 'users.json');
const allowedUsers = JSON.parse(fs.readFileSync(allowedUsersPath, 'utf8'));

// Normalize text: remove accents, lowercase
function normalizeText(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

// Find allowed user by name (case/accent insensitive)
function findAllowedUser(firstName, lastName) {
  const normFirst = normalizeText(firstName);
  const normLast = normalizeText(lastName);

  return allowedUsers.find(u =>
    normalizeText(u.firstName) === normFirst &&
    normalizeText(u.lastName) === normLast
  );
}

// ====== AUTH ROUTES ======

// Login user
app.post('/api/login', (req, res) => {
  const { firstName, lastName } = req.body;

  if (!firstName || !lastName) {
    return res.status(400).json({ error: 'Συμπληρώστε όνομα και επώνυμο' });
  }

  // Check if user is in allowed list
  const allowedUser = findAllowedUser(firstName, lastName);

  if (!allowedUser) {
    return res.status(403).json({ error: 'Δεν έχετε πρόσβαση στην εφαρμογή' });
  }

  // Check if user exists in database
  let user = db.prepare('SELECT * FROM users WHERE firstName = ? AND lastName = ?')
    .get(allowedUser.firstName, allowedUser.lastName);

  if (!user) {
    // Create user on first login
    const result = db.prepare('INSERT INTO users (firstName, lastName) VALUES (?, ?)')
      .run(allowedUser.firstName, allowedUser.lastName);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  }

  res.json({ success: true, user });
});

// ====== ADMIN ROUTES ======

// Verify admin password
app.post('/api/admin/verify', (req, res) => {
  const { password } = req.body;

  if (password === ADMIN_PASSWORD) {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Λάθος κωδικός' });
  }
});

// Get all users
app.get('/api/admin/users', (req, res) => {
  const users = db.prepare('SELECT * FROM users ORDER BY createdAt DESC').all();
  res.json(users);
});

// Get allowed users list
app.get('/api/admin/allowed', (req, res) => {
  res.json(allowedUsers);
});

// ====== LOCATIONS ROUTES ======

// Get all locations
app.get('/api/locations', (req, res) => {
  res.json(locations);
});

// ====== ENTRIES ROUTES ======

// Add bottle entry
app.post('/api/entries', (req, res) => {
  const { userId, locationId, date, bottles } = req.body;

  if (!userId || !locationId || !date || bottles === undefined) {
    return res.status(400).json({ error: 'Λείπουν απαιτούμενα πεδία' });
  }

  // Check if entry already exists for this user/location/date
  const existing = db.prepare('SELECT * FROM entries WHERE userId = ? AND locationId = ? AND date = ?').get(userId, locationId, date);

  if (existing) {
    // Update existing entry
    db.prepare('UPDATE entries SET bottles = ? WHERE id = ?').run(bottles, existing.id);
    res.json({ success: true, updated: true });
  } else {
    // Create new entry
    db.prepare('INSERT INTO entries (userId, locationId, date, bottles) VALUES (?, ?, ?, ?)').run(userId, locationId, date, bottles);
    res.json({ success: true, created: true });
  }
});

// Update entry
app.put('/api/entries/:id', (req, res) => {
  const { id } = req.params;
  const { bottles, userId } = req.body;

  if (!bottles || bottles < 0) {
    return res.status(400).json({ error: 'Μη έγκυρος αριθμός μπουκαλιών' });
  }

  const entry = db.prepare('SELECT * FROM entries WHERE id = ?').get(id);
  if (!entry) {
    return res.status(404).json({ error: 'Η καταχώρηση δεν βρέθηκε' });
  }

  if (entry.userId !== userId) {
    return res.status(403).json({ error: 'Δεν έχετε δικαίωμα επεξεργασίας' });
  }

  db.prepare('UPDATE entries SET bottles = ? WHERE id = ?').run(bottles, id);
  res.json({ success: true });
});

// Delete entry
app.delete('/api/entries/:id', (req, res) => {
  const { id } = req.params;
  const userId = parseInt(req.query.userId);

  const entry = db.prepare('SELECT * FROM entries WHERE id = ?').get(id);
  if (!entry) {
    return res.status(404).json({ error: 'Η καταχώρηση δεν βρέθηκε' });
  }

  if (entry.userId !== userId) {
    return res.status(403).json({ error: 'Δεν έχετε δικαίωμα διαγραφής' });
  }

  db.prepare('DELETE FROM entries WHERE id = ?').run(id);
  res.json({ success: true });
});

// Get entries for a location
app.get('/api/entries/:locationId', (req, res) => {
  const { locationId } = req.params;

  const entries = db.prepare(`
    SELECT e.*, u.firstName, u.lastName 
    FROM entries e 
    JOIN users u ON e.userId = u.id 
    WHERE e.locationId = ? 
    ORDER BY e.date DESC
  `).all(locationId);

  const total = db.prepare('SELECT SUM(bottles) as total FROM entries WHERE locationId = ?').get(locationId);

  res.json({ entries, total: total.total || 0 });
});

// Get all totals
app.get('/api/totals', (req, res) => {
  const locationTotals = db.prepare(`
    SELECT locationId, SUM(bottles) as total 
    FROM entries 
    GROUP BY locationId
  `).all();

  const grandTotal = db.prepare('SELECT SUM(bottles) as total FROM entries').get();

  // Get today's date in YYYY-MM-DD format (Greek timezone)
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Athens' });

  // Get locations that have entries today
  const todayEntries = db.prepare(`
    SELECT DISTINCT locationId 
    FROM entries 
    WHERE date = ?
  `).all(today);

  // Get locations with upcoming schedules
  const scheduledEntries = db.prepare(`
    SELECT DISTINCT locationId 
    FROM schedules 
    WHERE date >= ?
  `).all(today);

  const totalsMap = {};
  locationTotals.forEach(lt => {
    totalsMap[lt.locationId] = lt.total;
  });

  const todayLocations = todayEntries.map(e => e.locationId);
  const scheduledLocations = scheduledEntries.map(e => e.locationId);

  res.json({
    locationTotals: totalsMap,
    grandTotal: grandTotal.total || 0,
    todayLocations: todayLocations,
    scheduledLocations: scheduledLocations
  });
});

// Get user's entries
app.get('/api/user/:userId/entries', (req, res) => {
  const { userId } = req.params;

  const entries = db.prepare(`
    SELECT e.* 
    FROM entries e 
    WHERE e.userId = ? 
    ORDER BY e.date DESC
  `).all(userId);

  const total = db.prepare('SELECT SUM(bottles) as total FROM entries WHERE userId = ?').get(userId);

  res.json({ entries, total: total.total || 0 });
});

// ====== SCHEDULE ROUTES ======

// Add schedule
app.post('/api/schedules', (req, res) => {
  const { userId, locationId, date } = req.body;

  if (!userId || !locationId || !date) {
    return res.status(400).json({ error: 'Λείπουν απαιτούμενα πεδία' });
  }

  // Check if already scheduled for this user/location/date
  const existing = db.prepare('SELECT * FROM schedules WHERE userId = ? AND locationId = ? AND date = ?').get(userId, locationId, date);
  if (existing) {
    return res.status(400).json({ error: 'Έχετε ήδη προγραμματίσει αυτή την ημερομηνία' });
  }

  db.prepare('INSERT INTO schedules (userId, locationId, date) VALUES (?, ?, ?)').run(userId, locationId, date);
  res.json({ success: true });
});

// Get schedules for a location
app.get('/api/schedules/:locationId', (req, res) => {
  const { locationId } = req.params;

  // Get today's date in Greek timezone
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Athens' });

  const schedules = db.prepare(`
    SELECT s.*, u.firstName, u.lastName 
    FROM schedules s 
    JOIN users u ON s.userId = u.id 
    WHERE s.locationId = ? AND s.date >= ?
    ORDER BY s.date ASC
  `).all(locationId, today);

  res.json(schedules);
});

// Delete schedule
app.delete('/api/schedules/:id', (req, res) => {
  const { id } = req.params;
  const userId = parseInt(req.query.userId);

  const schedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id);
  if (!schedule) {
    return res.status(404).json({ error: 'Δεν βρέθηκε' });
  }

  if (schedule.userId !== userId) {
    return res.status(403).json({ error: 'Δεν έχετε δικαίωμα διαγραφής' });
  }

  db.prepare('DELETE FROM schedules WHERE id = ?').run(id);
  res.json({ success: true });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server: http://localhost:${PORT}`);
  console.log(`Κινητό: http://192.168.1.12:${PORT}`);
});
