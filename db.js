const fs = require('fs');

let db;

const isVercel = process.env.VERCEL || process.env.DATABASE_URL;

if (isVercel) {
    // Vercel / Cloud Postgres
    const { Pool } = require('pg');
    console.log('Using PostgreSQL database');

    // Create connection pool
    // Vercel Postgres usually sets POSTGRES_URL or DATABASE_URL
    const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;

    if (!connectionString) {
        console.error('ERROR: DATABASE_URL or POSTGRES_URL environment variable is missing!');
    }

    const pool = new Pool({
        connectionString: connectionString,
        ssl: {
            rejectUnauthorized: false // Required for Neon/Vercel Postgres
        }
    });

    // Adapter for Postgres
    db = {
        pool,
        // Helper to mimic synchronous blocking call style (conceptually) via async
        // BUT server.js must be async now.

        query: async (text, params = []) => {
            return await pool.query(text, params);
        },

        // Prepare method compatibility shim (for easier migration)
        // Note: This returns an object with methods that return Promises
        prepare: (sql) => {
            return {
                all: async (...args) => {
                    const res = await pool.query(sql, args);
                    return res.rows;
                },
                get: async (...args) => {
                    const res = await pool.query(sql, args);
                    return res.rows[0];
                },
                run: async (...args) => {
                    const res = await pool.query(sql, args);
                    return {
                        changes: res.rowCount,
                        lastInsertRowid: res.rows[0]?.id // Postgres needs RETURNING id
                    };
                }
            };
        },

        // Transaction helper
        transaction: (fn) => {
            return async (...args) => {
                const client = await pool.connect();
                try {
                    await client.query('BEGIN');
                    // We need to pass the client to the function so it uses the same transaction
                    // But our current legacy code uses the global 'db' object.
                    // This is tricky. For simple apps, we might skip true DB transactions 
                    // or assume single queries.
                    // The 'transaction' in better-sqlite3 returns a function.

                    const result = await fn(...args);
                    await client.query('COMMIT');
                    return result;
                } catch (e) {
                    await client.query('ROLLBACK');
                    throw e;
                } finally {
                    client.release();
                }
            };
        }
    };
} else {
    // Local SQLite
    const Database = require('better-sqlite3');
    const localDb = new Database('recycling.db');
    console.log('Using local SQLite database');

    // We need to wrap synchronous SQLite to return Promises to match Postgres API
    // so we can use 'await' everywhere in server.js

    db = {
        // Expose raw instance if needed
        raw: localDb,

        prepare: (sql) => {
            const stmt = localDb.prepare(sql);
            return {
                all: async (...args) => {
                    return stmt.all(...args);
                },
                get: async (...args) => {
                    return stmt.get(...args);
                },
                run: async (...args) => {
                    return stmt.run(...args);
                }
            };
        },

        transaction: (fn) => {
            const tx = localDb.transaction(fn);
            return async (...args) => {
                return tx(...args);
            };
        }
    };
}

// Set flag
db.isPostgres = !!isVercel;

module.exports = db;
