const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('./db'); // Use our adapter

const app = express();
const PORT = process.env.PORT || 3000;

// Admin password
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Database Tables
async function initDb() {
  const pkType = db.isPostgres ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
  const timestampType = db.isPostgres ? 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' : 'DATETIME DEFAULT CURRENT_TIMESTAMP';

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id ${pkType},
      firstName TEXT NOT NULL,
      lastName TEXT NOT NULL,
      createdAt ${timestampType}
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS entries (
      id ${pkType},
      userId INTEGER NOT NULL,
      locationId INTEGER NOT NULL,
      date TEXT NOT NULL,
      bottles INTEGER NOT NULL,
      createdAt ${timestampType},
      FOREIGN KEY (userId) REFERENCES users(id)
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS schedules (
      id ${pkType},
      userId INTEGER NOT NULL,
      locationId INTEGER NOT NULL,
      date TEXT NOT NULL,
      createdAt ${timestampType},
      FOREIGN KEY (userId) REFERENCES users(id)
    )
  `).run();

  console.log('Database tables initialized');
}

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
app.post('/api/login', async (req, res) => {
  try {
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
    let user = await db.prepare('SELECT * FROM users WHERE firstName = ? AND lastName = ?')
      .get(allowedUser.firstName, allowedUser.lastName);

    if (!user) {
      // Create user on first login
      const insertSql = 'INSERT INTO users (firstName, lastName) VALUES (?, ?)' + (db.isPostgres ? ' RETURNING id' : '');
      const result = await db.prepare(insertSql).run(allowedUser.firstName, allowedUser.lastName);

      const newId = db.isPostgres ? result.lastInsertRowid : result.lastInsertRowid;
      // In our adapter, result.lastInsertRowid is populated for Postgres if RETURNING id is used (see adapter logic check)
      // Actually my adapter logic for Postgres set lastInsertRowid from res.rows[0]?.id.

      user = await db.prepare('SELECT * FROM users WHERE id = ?').get(newId);
    }

    res.json({ success: true, user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
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
app.get('/api/admin/users', async (req, res) => {
  const users = await db.prepare('SELECT * FROM users ORDER BY createdAt DESC').all();
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
app.post('/api/entries', async (req, res) => {
  try {
    const { userId, locationId, date, bottles } = req.body;

    if (!userId || !locationId || !date || bottles === undefined) {
      return res.status(400).json({ error: 'Λείπουν απαιτούμενα πεδία' });
    }

    // Check if entry already exists for this user/location/date
    const existing = await db.prepare('SELECT * FROM entries WHERE userId = ? AND locationId = ? AND date = ?').get(userId, locationId, date);

    if (existing) {
      // Update existing entry
      await db.prepare('UPDATE entries SET bottles = ? WHERE id = ?').run(bottles, existing.id);
      res.json({ success: true, updated: true });
    } else {
      // Create new entry
      const insertSql = 'INSERT INTO entries (userId, locationId, date, bottles) VALUES (?, ?, ?, ?)' + (db.isPostgres ? ' RETURNING id' : '');
      await db.prepare(insertSql).run(userId, locationId, date, bottles);
      res.json({ success: true, created: true });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update entry
app.put('/api/entries/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { bottles, userId } = req.body;

    if (!bottles || bottles < 0) {
      return res.status(400).json({ error: 'Μη έγκυρος αριθμός μπουκαλιών' });
    }

    const entry = await db.prepare('SELECT * FROM entries WHERE id = ?').get(id);
    if (!entry) {
      return res.status(404).json({ error: 'Η καταχώρηση δεν βρέθηκε' });
    }

    if (entry.userId !== userId) {
      return res.status(403).json({ error: 'Δεν έχετε δικαίωμα επεξεργασίας' });
    }

    await db.prepare('UPDATE entries SET bottles = ? WHERE id = ?').run(bottles, id);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete entry
app.delete('/api/entries/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = parseInt(req.query.userId);

    const entry = await db.prepare('SELECT * FROM entries WHERE id = ?').get(id);
    if (!entry) {
      return res.status(404).json({ error: 'Η καταχώρηση δεν βρέθηκε' });
    }

    if (entry.userId !== userId) {
      return res.status(403).json({ error: 'Δεν έχετε δικαίωμα διαγραφής' });
    }

    await db.prepare('DELETE FROM entries WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get entries for a location
app.get('/api/entries/:locationId', async (req, res) => {
  try {
    const { locationId } = req.params;

    const entries = await db.prepare(`
      SELECT e.*, u.firstName, u.lastName 
      FROM entries e 
      JOIN users u ON e.userId = u.id 
      WHERE e.locationId = ? 
      ORDER BY e.date DESC
    `).all(locationId);

    const total = await db.prepare('SELECT SUM(bottles) as total FROM entries WHERE locationId = ?').get(locationId);

    res.json({ entries, total: total.total || 0 });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all totals
app.get('/api/totals', async (req, res) => {
  try {
    const locationTotals = await db.prepare(`
      SELECT locationId, SUM(bottles) as total 
      FROM entries 
      GROUP BY locationId
    `).all();

    const grandTotal = await db.prepare('SELECT SUM(bottles) as total FROM entries').get();

    // Get today's date in YYYY-MM-DD format (Greek timezone)
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Athens' });

    // Get locations that have entries today
    const todayEntries = await db.prepare(`
      SELECT DISTINCT locationId 
      FROM entries 
      WHERE date = ?
    `).all(today);

    // Get locations with upcoming schedules
    const scheduledEntries = await db.prepare(`
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
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get user's entries
app.get('/api/user/:userId/entries', async (req, res) => {
  try {
    const { userId } = req.params;

    const entries = await db.prepare(`
      SELECT e.* 
      FROM entries e 
      WHERE e.userId = ? 
      ORDER BY e.date DESC
    `).all(userId);

    const total = await db.prepare('SELECT SUM(bottles) as total FROM entries WHERE userId = ?').get(userId);

    res.json({ entries, total: total.total || 0 });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ====== SCHEDULE ROUTES ======

// Add schedule
app.post('/api/schedules', async (req, res) => {
  try {
    const { userId, locationId, date } = req.body;

    if (!userId || !locationId || !date) {
      return res.status(400).json({ error: 'Λείπουν απαιτούμενα πεδία' });
    }

    // Check if already scheduled for this user/location/date
    const existing = await db.prepare('SELECT * FROM schedules WHERE userId = ? AND locationId = ? AND date = ?').get(userId, locationId, date);
    if (existing) {
      return res.status(400).json({ error: 'Έχετε ήδη προγραμματίσει αυτή την ημερομηνία' });
    }

    const insertSql = 'INSERT INTO schedules (userId, locationId, date) VALUES (?, ?, ?)' + (db.isPostgres ? ' RETURNING id' : '');
    await db.prepare(insertSql).run(userId, locationId, date);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get schedules for a location (history + upcoming)
app.get('/api/schedules/:locationId', async (req, res) => {
  try {
    const { locationId } = req.params;

    // Get today's date in Greek timezone for frontend comparison
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Athens' });

    // Join with entries to see if completed
    const schedules = await db.prepare(`
      SELECT s.*, u.firstName, u.lastName, e.bottles,
             CASE WHEN e.id IS NOT NULL THEN 1 ELSE 0 END as completed
      FROM schedules s 
      JOIN users u ON s.userId = u.id 
      LEFT JOIN entries e ON s.userId = e.userId AND s.locationId = e.locationId AND s.date = e.date
      WHERE s.locationId = ?
      ORDER BY s.date DESC
    `).all(locationId);

    res.json({ schedules, today });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete schedule
app.delete('/api/schedules/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = parseInt(req.query.userId);

    const schedule = await db.prepare('SELECT * FROM schedules WHERE id = ?').get(id);
    if (!schedule) {
      return res.status(404).json({ error: 'Δεν βρέθηκε' });
    }

    if (schedule.userId !== userId) {
      return res.status(403).json({ error: 'Δεν έχετε δικαίωμα διαγραφής' });
    }

    await db.prepare('DELETE FROM schedules WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Temporary endpoint to fix data
app.get('/api/fix-data', async (req, res) => {
  try {
    // 1. Clear schedules
    await db.prepare('DELETE FROM schedules').run();

    // 2. Restore Mixalis
    // Try to find him
    let mixalis = await db.prepare('SELECT * FROM users WHERE firstName LIKE ? OR firstName LIKE ?')
      .get('%Mixalis%', '%Μιχάλης%');

    let msg = 'Schedules cleared. ';

    if (mixalis) {
      // Insert dummy bottles if not exist
      // Check if he has entries
      const entries = await db.prepare('SELECT * FROM entries WHERE userId = ?').all(mixalis.id);
      if (entries.length === 0) {
        const insertSql = 'INSERT INTO entries (userId, locationId, date, bottles) VALUES (?, ?, ?, ?)' + (db.isPostgres ? ' RETURNING id' : '');
        // Add a past entry
        await db.prepare(insertSql).run(mixalis.id, 141, '2025-01-01', 35);
        msg += 'Restored 35 bottles for Mixalis.';
      } else {
        msg += 'Mixalis already has bottles.';
      }
    } else {
      msg += 'Mixalis user not found (he needs to login first).';
    }

    res.json({ success: true, message: msg });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Start server
(async () => {
  await initDb();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
})();
