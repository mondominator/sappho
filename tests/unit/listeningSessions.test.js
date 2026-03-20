/**
 * Unit tests for listening sessions route handlers
 * Tests: GET /:id/sessions, POST /:id/sessions (start/stop)
 */

const express = require('express');
const request = require('supertest');
const sqlite3 = require('sqlite3').verbose();
const { createDbHelpers } = require('../../server/utils/db');

// Helper: create in-memory database with listening_sessions table
function createTestDb() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(':memory:', (err) => {
      if (err) return reject(err);
      db.serialize(() => {
        db.run(`
          CREATE TABLE listening_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            audiobook_id INTEGER NOT NULL,
            started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            stopped_at DATETIME,
            start_position INTEGER NOT NULL DEFAULT 0,
            end_position INTEGER,
            device_name TEXT
          )
        `, (err) => {
          if (err) return reject(err);
          resolve(db);
        });
      });
    });
  });
}

// Helper: build a minimal Express app that mounts the sessions route
function createApp(db) {
  const app = express();
  app.use(express.json());

  // Fake authenticateToken middleware that sets req.user
  const authenticateToken = (req, _res, next) => {
    req.user = { id: 1, username: 'testuser' };
    next();
  };

  const router = express.Router();
  const { register } = require('../../server/routes/audiobooks/sessions');
  register(router, { db, authenticateToken });

  app.use('/api/audiobooks', router);
  return app;
}

// Helper: insert a session row directly for test setup
function insertSession(db, { userId, audiobookId, startedAt, stoppedAt, startPosition, endPosition, deviceName }) {
  const { dbRun } = createDbHelpers(db);
  return dbRun(
    `INSERT INTO listening_sessions (user_id, audiobook_id, started_at, stopped_at, start_position, end_position, device_name)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userId, audiobookId, startedAt, stoppedAt || null, startPosition, endPosition || null, deviceName || null]
  );
}

describe('Listening Sessions Routes', () => {
  let db;
  let app;

  beforeEach(async () => {
    db = await createTestDb();
    app = createApp(db);
  });

  afterEach((done) => {
    db.close(done);
  });

  describe('GET /:id/sessions', () => {
    test('returns empty array when no sessions exist', async () => {
      const res = await request(app)
        .get('/api/audiobooks/1/sessions')
        .expect(200);

      expect(res.body).toEqual({ sessions: [] });
    });

    test('returns sessions ordered by started_at DESC', async () => {
      await insertSession(db, {
        userId: 1, audiobookId: 42, startedAt: '2025-01-01T10:00:00',
        stoppedAt: '2025-01-01T10:30:00', startPosition: 0, endPosition: 1800
      });
      await insertSession(db, {
        userId: 1, audiobookId: 42, startedAt: '2025-01-02T10:00:00',
        stoppedAt: '2025-01-02T10:30:00', startPosition: 1800, endPosition: 3600
      });
      await insertSession(db, {
        userId: 1, audiobookId: 42, startedAt: '2025-01-03T10:00:00',
        stoppedAt: null, startPosition: 3600, endPosition: null
      });

      const res = await request(app)
        .get('/api/audiobooks/42/sessions')
        .expect(200);

      expect(res.body.sessions).toHaveLength(3);
      // Most recent first
      expect(res.body.sessions[0].start_position).toBe(3600);
      expect(res.body.sessions[1].start_position).toBe(1800);
      expect(res.body.sessions[2].start_position).toBe(0);
    });

    test('only returns sessions for the authenticated user', async () => {
      // Insert session for user 1 (authenticated) and user 2 (other)
      await insertSession(db, {
        userId: 1, audiobookId: 42, startedAt: '2025-01-01T10:00:00',
        stoppedAt: '2025-01-01T10:30:00', startPosition: 0, endPosition: 1800
      });
      await insertSession(db, {
        userId: 2, audiobookId: 42, startedAt: '2025-01-01T11:00:00',
        stoppedAt: '2025-01-01T11:30:00', startPosition: 0, endPosition: 900
      });

      const res = await request(app)
        .get('/api/audiobooks/42/sessions')
        .expect(200);

      expect(res.body.sessions).toHaveLength(1);
      expect(res.body.sessions[0].start_position).toBe(0);
      expect(res.body.sessions[0].end_position).toBe(1800);
    });

    test('pagination works with limit and offset params', async () => {
      // Insert 5 sessions
      for (let i = 0; i < 5; i++) {
        await insertSession(db, {
          userId: 1, audiobookId: 42,
          startedAt: `2025-01-0${i + 1}T10:00:00`,
          stoppedAt: `2025-01-0${i + 1}T10:30:00`,
          startPosition: i * 100,
          endPosition: (i + 1) * 100
        });
      }

      // Request with limit=2, offset=0
      const res1 = await request(app)
        .get('/api/audiobooks/42/sessions?limit=2&offset=0')
        .expect(200);

      expect(res1.body.sessions).toHaveLength(2);
      // DESC order: most recent first (i=4, i=3)
      expect(res1.body.sessions[0].start_position).toBe(400);
      expect(res1.body.sessions[1].start_position).toBe(300);

      // Request with limit=2, offset=2
      const res2 = await request(app)
        .get('/api/audiobooks/42/sessions?limit=2&offset=2')
        .expect(200);

      expect(res2.body.sessions).toHaveLength(2);
      expect(res2.body.sessions[0].start_position).toBe(200);
      expect(res2.body.sessions[1].start_position).toBe(100);

      // Request with limit=2, offset=4
      const res3 = await request(app)
        .get('/api/audiobooks/42/sessions?limit=2&offset=4')
        .expect(200);

      expect(res3.body.sessions).toHaveLength(1);
      expect(res3.body.sessions[0].start_position).toBe(0);
    });
  });

  describe('POST /:id/sessions', () => {
    test('action:"start" creates a session and returns its id', async () => {
      const res = await request(app)
        .post('/api/audiobooks/42/sessions')
        .send({ action: 'start', position: 100, deviceName: 'Android' })
        .expect(200);

      expect(res.body).toHaveProperty('id');
      expect(res.body.message).toBe('Session started');

      // Verify session was persisted
      const getRes = await request(app)
        .get('/api/audiobooks/42/sessions')
        .expect(200);

      expect(getRes.body.sessions).toHaveLength(1);
      expect(getRes.body.sessions[0].start_position).toBe(100);
      expect(getRes.body.sessions[0].device_name).toBe('Android');
      expect(getRes.body.sessions[0].stopped_at).toBeNull();
    });

    test('action:"stop" closes the open session', async () => {
      // Start a session first
      await request(app)
        .post('/api/audiobooks/42/sessions')
        .send({ action: 'start', position: 0 })
        .expect(200);

      // Stop the session
      const stopRes = await request(app)
        .post('/api/audiobooks/42/sessions')
        .send({ action: 'stop', position: 500 })
        .expect(200);

      expect(stopRes.body.message).toBe('Session stopped');
      expect(stopRes.body.updated).toBe(true);

      // Verify session was closed
      const getRes = await request(app)
        .get('/api/audiobooks/42/sessions')
        .expect(200);

      expect(getRes.body.sessions).toHaveLength(1);
      expect(getRes.body.sessions[0].end_position).toBe(500);
      expect(getRes.body.sessions[0].stopped_at).not.toBeNull();
    });

    test('starting a new session auto-closes any open session for the same user+book', async () => {
      // Start first session
      await request(app)
        .post('/api/audiobooks/42/sessions')
        .send({ action: 'start', position: 0 })
        .expect(200);

      // Start second session — should auto-close the first
      await request(app)
        .post('/api/audiobooks/42/sessions')
        .send({ action: 'start', position: 300 })
        .expect(200);

      const getRes = await request(app)
        .get('/api/audiobooks/42/sessions')
        .expect(200);

      expect(getRes.body.sessions).toHaveLength(2);

      // Find the open (new) session and the closed (auto-closed) session
      const openSession = getRes.body.sessions.find(s => s.stopped_at === null);
      const closedSession = getRes.body.sessions.find(s => s.stopped_at !== null);

      expect(openSession).toBeDefined();
      expect(openSession.start_position).toBe(300);

      expect(closedSession).toBeDefined();
      expect(closedSession.start_position).toBe(0);
      expect(closedSession.end_position).toBe(300);
    });

    test('returns 400 for invalid action', async () => {
      const res = await request(app)
        .post('/api/audiobooks/42/sessions')
        .send({ action: 'pause', position: 100 })
        .expect(400);

      expect(res.body.error).toBe('action must be "start" or "stop"');
    });

    test('returns 400 when action is missing', async () => {
      const res = await request(app)
        .post('/api/audiobooks/42/sessions')
        .send({ position: 100 })
        .expect(400);

      expect(res.body.error).toBe('action must be "start" or "stop"');
    });

    test('returns 400 without position', async () => {
      const res = await request(app)
        .post('/api/audiobooks/42/sessions')
        .send({ action: 'start' })
        .expect(400);

      expect(res.body.error).toBe('position must be a number');
    });

    test('returns 400 when position is not a number', async () => {
      const res = await request(app)
        .post('/api/audiobooks/42/sessions')
        .send({ action: 'start', position: 'abc' })
        .expect(400);

      expect(res.body.error).toBe('position must be a number');
    });

    test('stop returns updated:false when no open session exists', async () => {
      const res = await request(app)
        .post('/api/audiobooks/42/sessions')
        .send({ action: 'stop', position: 100 })
        .expect(200);

      expect(res.body.message).toBe('Session stopped');
      expect(res.body.updated).toBe(false);
    });
  });
});
