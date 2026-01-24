/**
 * Integration tests for Audiobooks Routes
 * Tests: CRUD, progress tracking, favorites, meta endpoints, batch operations
 */

const request = require('supertest');
const {
  createTestDatabase,
  createTestUser,
  generateTestToken,
  createTestApp,
  createTestAudiobook
} = require('./testApp');

describe('Audiobooks Routes', () => {
  let db;
  let app;
  let adminUser;
  let adminToken;
  let regularUser;
  let userToken;

  beforeEach(async () => {
    db = await createTestDatabase();
    app = createTestApp(db);

    // Create admin and regular users
    adminUser = await createTestUser(db, { username: 'admin', password: 'admin123', isAdmin: true });
    adminToken = generateTestToken(adminUser);

    regularUser = await createTestUser(db, { username: 'user', password: 'user123', isAdmin: false });
    userToken = generateTestToken(regularUser);
  });

  afterEach((done) => {
    db.close(done);
  });

  // ============================================
  // LIST AUDIOBOOKS
  // ============================================
  describe('GET /api/audiobooks', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app).get('/api/audiobooks');
      expect(res.status).toBe(401);
    });

    it('returns empty list when no audiobooks exist', async () => {
      const res = await request(app)
        .get('/api/audiobooks')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.audiobooks).toEqual([]);
      expect(res.body.total).toBe(0);
    });

    it('returns list of audiobooks with pagination metadata', async () => {
      await createTestAudiobook(db, { title: 'Book A' });
      await createTestAudiobook(db, { title: 'Book B' });

      const res = await request(app)
        .get('/api/audiobooks')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.audiobooks).toHaveLength(2);
      expect(res.body.total).toBe(2);
      expect(res.body.limit).toBe(50);
      expect(res.body.offset).toBe(0);
    });

    it('supports pagination with limit and offset', async () => {
      for (let i = 1; i <= 5; i++) {
        await createTestAudiobook(db, { title: `Book ${String(i).padStart(2, '0')}` });
      }

      const res = await request(app)
        .get('/api/audiobooks?limit=2&offset=2')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.audiobooks).toHaveLength(2);
      expect(res.body.limit).toBe(2);
      expect(res.body.offset).toBe(2);
    });

    it('filters by genre', async () => {
      await createTestAudiobook(db, { title: 'Sci-Fi Book', genre: 'Science Fiction' });
      await createTestAudiobook(db, { title: 'Mystery Book', genre: 'Mystery' });

      const res = await request(app)
        .get('/api/audiobooks?genre=Science Fiction')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.audiobooks).toHaveLength(1);
      expect(res.body.audiobooks[0].title).toBe('Sci-Fi Book');
    });

    it('filters by author', async () => {
      await createTestAudiobook(db, { title: 'Book 1', author: 'John Smith' });
      await createTestAudiobook(db, { title: 'Book 2', author: 'Jane Doe' });

      const res = await request(app)
        .get('/api/audiobooks?author=John')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.audiobooks).toHaveLength(1);
      expect(res.body.audiobooks[0].author).toBe('John Smith');
    });

    it('filters by series', async () => {
      await createTestAudiobook(db, { title: 'Book 1', series: 'Epic Series' });
      await createTestAudiobook(db, { title: 'Book 2', series: null });

      const res = await request(app)
        .get('/api/audiobooks?series=Epic')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.audiobooks).toHaveLength(1);
      expect(res.body.audiobooks[0].series).toBe('Epic Series');
    });

    it('filters by search term across multiple fields', async () => {
      await createTestAudiobook(db, { title: 'The Dragon', author: 'Author A' });
      await createTestAudiobook(db, { title: 'Book B', author: 'Dragon Master' });
      await createTestAudiobook(db, { title: 'Book C', narrator: 'Dragon Voice' });
      await createTestAudiobook(db, { title: 'Book D', series: 'Dragon Tales' });
      await createTestAudiobook(db, { title: 'Unrelated', author: 'Someone' });

      const res = await request(app)
        .get('/api/audiobooks?search=Dragon')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.audiobooks).toHaveLength(4);
    });

    it('excludes unavailable audiobooks by default', async () => {
      await createTestAudiobook(db, { title: 'Available Book', is_available: 1 });
      await createTestAudiobook(db, { title: 'Unavailable Book', is_available: 0 });

      const res = await request(app)
        .get('/api/audiobooks')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.audiobooks).toHaveLength(1);
      expect(res.body.audiobooks[0].title).toBe('Available Book');
    });

    it('includes unavailable audiobooks when requested', async () => {
      await createTestAudiobook(db, { title: 'Available Book', is_available: 1 });
      await createTestAudiobook(db, { title: 'Unavailable Book', is_available: 0 });

      const res = await request(app)
        .get('/api/audiobooks?includeUnavailable=true')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.audiobooks).toHaveLength(2);
    });

    it('includes user progress in response', async () => {
      const book = await createTestAudiobook(db, { title: 'My Book', duration: 3600 });

      // Add progress for user
      await new Promise((resolve, reject) => {
        db.run(
          'INSERT INTO playback_progress (user_id, audiobook_id, position, completed) VALUES (?, ?, ?, ?)',
          [regularUser.id, book.id, 1800, 0],
          err => err ? reject(err) : resolve()
        );
      });

      const res = await request(app)
        .get('/api/audiobooks')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.audiobooks[0].progress).toBeTruthy();
      expect(res.body.audiobooks[0].progress.position).toBe(1800);
    });

    it('includes favorite status in response', async () => {
      const book = await createTestAudiobook(db, { title: 'Favorite Book' });

      // Add to favorites
      await new Promise((resolve, reject) => {
        db.run(
          'INSERT INTO user_favorites (user_id, audiobook_id) VALUES (?, ?)',
          [regularUser.id, book.id],
          err => err ? reject(err) : resolve()
        );
      });

      const res = await request(app)
        .get('/api/audiobooks')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.audiobooks[0].is_favorite).toBe(true);
    });

    it('filters to only favorites when requested', async () => {
      const book1 = await createTestAudiobook(db, { title: 'Favorite Book' });
      await createTestAudiobook(db, { title: 'Not Favorite' });

      // Add first book to favorites
      await new Promise((resolve, reject) => {
        db.run(
          'INSERT INTO user_favorites (user_id, audiobook_id) VALUES (?, ?)',
          [regularUser.id, book1.id],
          err => err ? reject(err) : resolve()
        );
      });

      const res = await request(app)
        .get('/api/audiobooks?favorites=true')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.audiobooks).toHaveLength(1);
      expect(res.body.audiobooks[0].title).toBe('Favorite Book');
    });
  });

  // ============================================
  // GET SINGLE AUDIOBOOK
  // ============================================
  describe('GET /api/audiobooks/:id', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app).get('/api/audiobooks/1');
      expect(res.status).toBe(401);
    });

    it('returns 404 for non-existent audiobook', async () => {
      const res = await request(app)
        .get('/api/audiobooks/999')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Audiobook not found');
    });

    it('returns audiobook with all fields', async () => {
      const book = await createTestAudiobook(db, {
        title: 'Test Book',
        author: 'Test Author',
        narrator: 'Test Narrator',
        genre: 'Fiction',
        series: 'Test Series',
        series_position: 1
      });

      const res = await request(app)
        .get(`/api/audiobooks/${book.id}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Test Book');
      expect(res.body.author).toBe('Test Author');
      expect(res.body.narrator).toBe('Test Narrator');
      expect(res.body.genre).toBe('Fiction');
      expect(res.body.series).toBe('Test Series');
      expect(res.body.series_position).toBe(1);
    });

    it('includes user-specific progress and favorite status', async () => {
      const book = await createTestAudiobook(db, { title: 'Test Book' });

      // Add progress
      await new Promise((resolve, reject) => {
        db.run(
          'INSERT INTO playback_progress (user_id, audiobook_id, position, completed) VALUES (?, ?, ?, ?)',
          [regularUser.id, book.id, 500, 0],
          err => err ? reject(err) : resolve()
        );
      });

      // Add to favorites
      await new Promise((resolve, reject) => {
        db.run(
          'INSERT INTO user_favorites (user_id, audiobook_id) VALUES (?, ?)',
          [regularUser.id, book.id],
          err => err ? reject(err) : resolve()
        );
      });

      const res = await request(app)
        .get(`/api/audiobooks/${book.id}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.progress.position).toBe(500);
      expect(res.body.is_favorite).toBe(true);
    });
  });

  // ============================================
  // UPDATE AUDIOBOOK
  // ============================================
  describe('PUT /api/audiobooks/:id', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app)
        .put('/api/audiobooks/1')
        .send({ title: 'New Title' });
      expect(res.status).toBe(401);
    });

    it('returns 404 for non-existent audiobook', async () => {
      const res = await request(app)
        .put('/api/audiobooks/999')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ title: 'New Title' });

      expect(res.status).toBe(404);
    });

    it('returns 400 with no fields to update', async () => {
      const book = await createTestAudiobook(db, { title: 'Test Book' });

      const res = await request(app)
        .put(`/api/audiobooks/${book.id}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('No fields to update');
    });

    it('updates audiobook title', async () => {
      const book = await createTestAudiobook(db, { title: 'Old Title' });

      const res = await request(app)
        .put(`/api/audiobooks/${book.id}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ title: 'New Title' });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Audiobook updated successfully');

      // Verify update
      const getRes = await request(app)
        .get(`/api/audiobooks/${book.id}`)
        .set('Authorization', `Bearer ${userToken}`);
      expect(getRes.body.title).toBe('New Title');
    });

    it('updates multiple fields at once', async () => {
      const book = await createTestAudiobook(db, {
        title: 'Old Title',
        author: 'Old Author',
        genre: 'Old Genre'
      });

      const res = await request(app)
        .put(`/api/audiobooks/${book.id}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          title: 'New Title',
          author: 'New Author',
          genre: 'New Genre'
        });

      expect(res.status).toBe(200);

      // Verify updates
      const getRes = await request(app)
        .get(`/api/audiobooks/${book.id}`)
        .set('Authorization', `Bearer ${userToken}`);
      expect(getRes.body.title).toBe('New Title');
      expect(getRes.body.author).toBe('New Author');
      expect(getRes.body.genre).toBe('New Genre');
    });
  });

  // ============================================
  // DELETE AUDIOBOOK (Admin Only)
  // ============================================
  describe('DELETE /api/audiobooks/:id', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app).delete('/api/audiobooks/1');
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin users', async () => {
      const book = await createTestAudiobook(db, { title: 'Test Book' });

      const res = await request(app)
        .delete(`/api/audiobooks/${book.id}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Admin access required');
    });

    it('returns 404 for non-existent audiobook', async () => {
      const res = await request(app)
        .delete('/api/audiobooks/999')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });

    it('allows admin to delete audiobook', async () => {
      const book = await createTestAudiobook(db, { title: 'Test Book' });

      const res = await request(app)
        .delete(`/api/audiobooks/${book.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Audiobook deleted successfully');

      // Verify deletion
      const getRes = await request(app)
        .get(`/api/audiobooks/${book.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(getRes.status).toBe(404);
    });
  });

  // ============================================
  // PROGRESS TRACKING
  // ============================================
  describe('Progress Tracking', () => {
    describe('GET /api/audiobooks/:id/progress', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app).get('/api/audiobooks/1/progress');
        expect(res.status).toBe(401);
      });

      it('returns default progress for new audiobook', async () => {
        const book = await createTestAudiobook(db, { title: 'Test Book' });

        const res = await request(app)
          .get(`/api/audiobooks/${book.id}/progress`)
          .set('Authorization', `Bearer ${userToken}`);

        expect(res.status).toBe(200);
        expect(res.body.position).toBe(0);
        expect(res.body.completed).toBe(0);
      });

      it('returns saved progress', async () => {
        const book = await createTestAudiobook(db, { title: 'Test Book' });

        await new Promise((resolve, reject) => {
          db.run(
            'INSERT INTO playback_progress (user_id, audiobook_id, position, completed) VALUES (?, ?, ?, ?)',
            [regularUser.id, book.id, 1500, 0],
            err => err ? reject(err) : resolve()
          );
        });

        const res = await request(app)
          .get(`/api/audiobooks/${book.id}/progress`)
          .set('Authorization', `Bearer ${userToken}`);

        expect(res.status).toBe(200);
        expect(res.body.position).toBe(1500);
      });
    });

    describe('POST /api/audiobooks/:id/progress', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app)
          .post('/api/audiobooks/1/progress')
          .send({ position: 100 });
        expect(res.status).toBe(401);
      });

      it('returns 400 without position', async () => {
        const book = await createTestAudiobook(db, { title: 'Test Book' });

        const res = await request(app)
          .post(`/api/audiobooks/${book.id}/progress`)
          .set('Authorization', `Bearer ${userToken}`)
          .send({});

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Position is required');
      });

      it('returns 404 for non-existent audiobook', async () => {
        const res = await request(app)
          .post('/api/audiobooks/999/progress')
          .set('Authorization', `Bearer ${userToken}`)
          .send({ position: 100 });

        expect(res.status).toBe(404);
      });

      it('saves progress and returns success', async () => {
        const book = await createTestAudiobook(db, { title: 'Test Book', duration: 3600 });

        const res = await request(app)
          .post(`/api/audiobooks/${book.id}/progress`)
          .set('Authorization', `Bearer ${userToken}`)
          .send({ position: 1800 });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.position).toBe(1800);
        expect(res.body.progressPercent).toBe(50);
      });

      it('auto-marks as completed when position >= 95%', async () => {
        const book = await createTestAudiobook(db, { title: 'Test Book', duration: 1000 });

        const res = await request(app)
          .post(`/api/audiobooks/${book.id}/progress`)
          .set('Authorization', `Bearer ${userToken}`)
          .send({ position: 960 });

        expect(res.status).toBe(200);
        expect(res.body.completed).toBe(1);
      });

      it('respects explicit completed flag', async () => {
        const book = await createTestAudiobook(db, { title: 'Test Book', duration: 1000 });

        const res = await request(app)
          .post(`/api/audiobooks/${book.id}/progress`)
          .set('Authorization', `Bearer ${userToken}`)
          .send({ position: 500, completed: 1 });

        expect(res.status).toBe(200);
        expect(res.body.completed).toBe(1);
      });

      it('updates existing progress', async () => {
        const book = await createTestAudiobook(db, { title: 'Test Book', duration: 3600 });

        // First save
        await request(app)
          .post(`/api/audiobooks/${book.id}/progress`)
          .set('Authorization', `Bearer ${userToken}`)
          .send({ position: 1000 });

        // Update
        const res = await request(app)
          .post(`/api/audiobooks/${book.id}/progress`)
          .set('Authorization', `Bearer ${userToken}`)
          .send({ position: 2000 });

        expect(res.status).toBe(200);
        expect(res.body.position).toBe(2000);

        // Verify
        const getRes = await request(app)
          .get(`/api/audiobooks/${book.id}/progress`)
          .set('Authorization', `Bearer ${userToken}`);
        expect(getRes.body.position).toBe(2000);
      });
    });

    describe('DELETE /api/audiobooks/:id/progress', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app).delete('/api/audiobooks/1/progress');
        expect(res.status).toBe(401);
      });

      it('deletes existing progress', async () => {
        const book = await createTestAudiobook(db, { title: 'Test Book' });

        // Create progress
        await new Promise((resolve, reject) => {
          db.run(
            'INSERT INTO playback_progress (user_id, audiobook_id, position, completed) VALUES (?, ?, ?, ?)',
            [regularUser.id, book.id, 1500, 0],
            err => err ? reject(err) : resolve()
          );
        });

        const res = await request(app)
          .delete(`/api/audiobooks/${book.id}/progress`)
          .set('Authorization', `Bearer ${userToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.deleted).toBe(true);

        // Verify deletion
        const getRes = await request(app)
          .get(`/api/audiobooks/${book.id}/progress`)
          .set('Authorization', `Bearer ${userToken}`);
        expect(getRes.body.position).toBe(0);
      });

      it('returns deleted: false when no progress exists', async () => {
        const book = await createTestAudiobook(db, { title: 'Test Book' });

        const res = await request(app)
          .delete(`/api/audiobooks/${book.id}/progress`)
          .set('Authorization', `Bearer ${userToken}`);

        expect(res.status).toBe(200);
        expect(res.body.deleted).toBe(false);
      });
    });
  });

  // ============================================
  // FAVORITES
  // ============================================
  describe('Favorites', () => {
    describe('GET /api/audiobooks/favorites', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app).get('/api/audiobooks/favorites');
        expect(res.status).toBe(401);
      });

      it('returns empty list when no favorites', async () => {
        const res = await request(app)
          .get('/api/audiobooks/favorites')
          .set('Authorization', `Bearer ${userToken}`);

        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
      });

      it('returns user favorites', async () => {
        const book1 = await createTestAudiobook(db, { title: 'Favorite 1' });
        const book2 = await createTestAudiobook(db, { title: 'Not Favorite' });

        await new Promise((resolve, reject) => {
          db.run(
            'INSERT INTO user_favorites (user_id, audiobook_id) VALUES (?, ?)',
            [regularUser.id, book1.id],
            err => err ? reject(err) : resolve()
          );
        });

        const res = await request(app)
          .get('/api/audiobooks/favorites')
          .set('Authorization', `Bearer ${userToken}`);

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);
        expect(res.body[0].title).toBe('Favorite 1');
      });
    });

    describe('GET /api/audiobooks/:id/favorite', () => {
      it('returns false for non-favorite', async () => {
        const book = await createTestAudiobook(db, { title: 'Test Book' });

        const res = await request(app)
          .get(`/api/audiobooks/${book.id}/favorite`)
          .set('Authorization', `Bearer ${userToken}`);

        expect(res.status).toBe(200);
        expect(res.body.is_favorite).toBe(false);
      });

      it('returns true for favorite', async () => {
        const book = await createTestAudiobook(db, { title: 'Test Book' });

        await new Promise((resolve, reject) => {
          db.run(
            'INSERT INTO user_favorites (user_id, audiobook_id) VALUES (?, ?)',
            [regularUser.id, book.id],
            err => err ? reject(err) : resolve()
          );
        });

        const res = await request(app)
          .get(`/api/audiobooks/${book.id}/favorite`)
          .set('Authorization', `Bearer ${userToken}`);

        expect(res.status).toBe(200);
        expect(res.body.is_favorite).toBe(true);
      });
    });

    describe('POST /api/audiobooks/:id/favorite', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app).post('/api/audiobooks/1/favorite');
        expect(res.status).toBe(401);
      });

      it('returns 404 for non-existent audiobook', async () => {
        const res = await request(app)
          .post('/api/audiobooks/999/favorite')
          .set('Authorization', `Bearer ${userToken}`);

        expect(res.status).toBe(404);
      });

      it('adds audiobook to favorites', async () => {
        const book = await createTestAudiobook(db, { title: 'Test Book' });

        const res = await request(app)
          .post(`/api/audiobooks/${book.id}/favorite`)
          .set('Authorization', `Bearer ${userToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.is_favorite).toBe(true);

        // Verify
        const checkRes = await request(app)
          .get(`/api/audiobooks/${book.id}/favorite`)
          .set('Authorization', `Bearer ${userToken}`);
        expect(checkRes.body.is_favorite).toBe(true);
      });

      it('handles duplicate favorite gracefully', async () => {
        const book = await createTestAudiobook(db, { title: 'Test Book' });

        await new Promise((resolve, reject) => {
          db.run(
            'INSERT INTO user_favorites (user_id, audiobook_id) VALUES (?, ?)',
            [regularUser.id, book.id],
            err => err ? reject(err) : resolve()
          );
        });

        const res = await request(app)
          .post(`/api/audiobooks/${book.id}/favorite`)
          .set('Authorization', `Bearer ${userToken}`);

        expect(res.status).toBe(200);
        expect(res.body.is_favorite).toBe(true);
      });
    });

    describe('DELETE /api/audiobooks/:id/favorite', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app).delete('/api/audiobooks/1/favorite');
        expect(res.status).toBe(401);
      });

      it('removes audiobook from favorites', async () => {
        const book = await createTestAudiobook(db, { title: 'Test Book' });

        await new Promise((resolve, reject) => {
          db.run(
            'INSERT INTO user_favorites (user_id, audiobook_id) VALUES (?, ?)',
            [regularUser.id, book.id],
            err => err ? reject(err) : resolve()
          );
        });

        const res = await request(app)
          .delete(`/api/audiobooks/${book.id}/favorite`)
          .set('Authorization', `Bearer ${userToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.is_favorite).toBe(false);

        // Verify
        const checkRes = await request(app)
          .get(`/api/audiobooks/${book.id}/favorite`)
          .set('Authorization', `Bearer ${userToken}`);
        expect(checkRes.body.is_favorite).toBe(false);
      });

      it('handles non-favorite gracefully', async () => {
        const book = await createTestAudiobook(db, { title: 'Test Book' });

        const res = await request(app)
          .delete(`/api/audiobooks/${book.id}/favorite`)
          .set('Authorization', `Bearer ${userToken}`);

        expect(res.status).toBe(200);
        expect(res.body.is_favorite).toBe(false);
      });
    });

    describe('POST /api/audiobooks/:id/favorite/toggle', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app).post('/api/audiobooks/1/favorite/toggle');
        expect(res.status).toBe(401);
      });

      it('returns 404 for non-existent audiobook when adding', async () => {
        const res = await request(app)
          .post('/api/audiobooks/999/favorite/toggle')
          .set('Authorization', `Bearer ${userToken}`);

        expect(res.status).toBe(404);
      });

      it('toggles non-favorite to favorite', async () => {
        const book = await createTestAudiobook(db, { title: 'Test Book' });

        const res = await request(app)
          .post(`/api/audiobooks/${book.id}/favorite/toggle`)
          .set('Authorization', `Bearer ${userToken}`);

        expect(res.status).toBe(200);
        expect(res.body.is_favorite).toBe(true);
      });

      it('toggles favorite to non-favorite', async () => {
        const book = await createTestAudiobook(db, { title: 'Test Book' });

        await new Promise((resolve, reject) => {
          db.run(
            'INSERT INTO user_favorites (user_id, audiobook_id) VALUES (?, ?)',
            [regularUser.id, book.id],
            err => err ? reject(err) : resolve()
          );
        });

        const res = await request(app)
          .post(`/api/audiobooks/${book.id}/favorite/toggle`)
          .set('Authorization', `Bearer ${userToken}`);

        expect(res.status).toBe(200);
        expect(res.body.is_favorite).toBe(false);
      });
    });
  });

  // ============================================
  // META ENDPOINTS
  // ============================================
  describe('Meta Endpoints', () => {
    describe('GET /api/audiobooks/meta/series', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app).get('/api/audiobooks/meta/series');
        expect(res.status).toBe(401);
      });

      it('returns empty list when no series', async () => {
        await createTestAudiobook(db, { title: 'No Series Book', series: null });

        const res = await request(app)
          .get('/api/audiobooks/meta/series')
          .set('Authorization', `Bearer ${userToken}`);

        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
      });

      it('returns grouped series with book counts', async () => {
        await createTestAudiobook(db, { title: 'Book 1', series: 'Epic Series', series_position: 1 });
        await createTestAudiobook(db, { title: 'Book 2', series: 'Epic Series', series_position: 2 });
        await createTestAudiobook(db, { title: 'Book 3', series: 'Other Series', series_position: 1 });

        const res = await request(app)
          .get('/api/audiobooks/meta/series')
          .set('Authorization', `Bearer ${userToken}`);

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(2);

        const epicSeries = res.body.find(s => s.series === 'Epic Series');
        expect(epicSeries.book_count).toBe(2);
      });

      it('excludes unavailable books from series count', async () => {
        await createTestAudiobook(db, { title: 'Available', series: 'Test Series', is_available: 1 });
        await createTestAudiobook(db, { title: 'Unavailable', series: 'Test Series', is_available: 0 });

        const res = await request(app)
          .get('/api/audiobooks/meta/series')
          .set('Authorization', `Bearer ${userToken}`);

        expect(res.status).toBe(200);
        expect(res.body[0].book_count).toBe(1);
      });
    });

    describe('GET /api/audiobooks/meta/authors', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app).get('/api/audiobooks/meta/authors');
        expect(res.status).toBe(401);
      });

      it('returns grouped authors with book counts', async () => {
        await createTestAudiobook(db, { title: 'Book 1', author: 'John Smith' });
        await createTestAudiobook(db, { title: 'Book 2', author: 'John Smith' });
        await createTestAudiobook(db, { title: 'Book 3', author: 'Jane Doe' });

        const res = await request(app)
          .get('/api/audiobooks/meta/authors')
          .set('Authorization', `Bearer ${userToken}`);

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(2);

        const johnSmith = res.body.find(a => a.author === 'John Smith');
        expect(johnSmith.book_count).toBe(2);
      });
    });

    describe('GET /api/audiobooks/meta/genres', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app).get('/api/audiobooks/meta/genres');
        expect(res.status).toBe(401);
      });

      it('returns grouped genres with book counts', async () => {
        await createTestAudiobook(db, { title: 'Book 1', genre: 'Fiction' });
        await createTestAudiobook(db, { title: 'Book 2', genre: 'Fiction' });
        await createTestAudiobook(db, { title: 'Book 3', genre: 'Non-Fiction' });

        const res = await request(app)
          .get('/api/audiobooks/meta/genres')
          .set('Authorization', `Bearer ${userToken}`);

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(2);
      });
    });

    describe('GET /api/audiobooks/meta/recent', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app).get('/api/audiobooks/meta/recent');
        expect(res.status).toBe(401);
      });

      it('returns recent audiobooks', async () => {
        await createTestAudiobook(db, { title: 'Old Book' });
        await createTestAudiobook(db, { title: 'New Book' });

        const res = await request(app)
          .get('/api/audiobooks/meta/recent')
          .set('Authorization', `Bearer ${userToken}`);

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(2);
      });

      it('respects limit parameter', async () => {
        for (let i = 1; i <= 15; i++) {
          await createTestAudiobook(db, { title: `Book ${i}` });
        }

        const res = await request(app)
          .get('/api/audiobooks/meta/recent?limit=5')
          .set('Authorization', `Bearer ${userToken}`);

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(5);
      });

      it('excludes unavailable books', async () => {
        await createTestAudiobook(db, { title: 'Available', is_available: 1 });
        await createTestAudiobook(db, { title: 'Unavailable', is_available: 0 });

        const res = await request(app)
          .get('/api/audiobooks/meta/recent')
          .set('Authorization', `Bearer ${userToken}`);

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);
      });
    });

    describe('GET /api/audiobooks/meta/in-progress', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app).get('/api/audiobooks/meta/in-progress');
        expect(res.status).toBe(401);
      });

      it('returns only in-progress books for current user', async () => {
        const book1 = await createTestAudiobook(db, { title: 'In Progress' });
        const book2 = await createTestAudiobook(db, { title: 'Not Started' });
        const book3 = await createTestAudiobook(db, { title: 'Completed' });

        // Add in-progress
        await new Promise((resolve, reject) => {
          db.run(
            'INSERT INTO playback_progress (user_id, audiobook_id, position, completed) VALUES (?, ?, ?, ?)',
            [regularUser.id, book1.id, 500, 0],
            err => err ? reject(err) : resolve()
          );
        });

        // Add completed
        await new Promise((resolve, reject) => {
          db.run(
            'INSERT INTO playback_progress (user_id, audiobook_id, position, completed) VALUES (?, ?, ?, ?)',
            [regularUser.id, book3.id, 3600, 1],
            err => err ? reject(err) : resolve()
          );
        });

        const res = await request(app)
          .get('/api/audiobooks/meta/in-progress')
          .set('Authorization', `Bearer ${userToken}`);

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);
        expect(res.body[0].title).toBe('In Progress');
      });

      it('does not show other users in-progress books', async () => {
        const book = await createTestAudiobook(db, { title: 'Test Book' });

        // Add progress for admin user
        await new Promise((resolve, reject) => {
          db.run(
            'INSERT INTO playback_progress (user_id, audiobook_id, position, completed) VALUES (?, ?, ?, ?)',
            [adminUser.id, book.id, 500, 0],
            err => err ? reject(err) : resolve()
          );
        });

        const res = await request(app)
          .get('/api/audiobooks/meta/in-progress')
          .set('Authorization', `Bearer ${userToken}`);

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(0);
      });
    });

    describe('GET /api/audiobooks/meta/finished', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app).get('/api/audiobooks/meta/finished');
        expect(res.status).toBe(401);
      });

      it('returns only finished books for current user', async () => {
        const book1 = await createTestAudiobook(db, { title: 'Finished' });
        const book2 = await createTestAudiobook(db, { title: 'In Progress' });

        // Add completed
        await new Promise((resolve, reject) => {
          db.run(
            'INSERT INTO playback_progress (user_id, audiobook_id, position, completed) VALUES (?, ?, ?, ?)',
            [regularUser.id, book1.id, 3600, 1],
            err => err ? reject(err) : resolve()
          );
        });

        // Add in-progress
        await new Promise((resolve, reject) => {
          db.run(
            'INSERT INTO playback_progress (user_id, audiobook_id, position, completed) VALUES (?, ?, ?, ?)',
            [regularUser.id, book2.id, 500, 0],
            err => err ? reject(err) : resolve()
          );
        });

        const res = await request(app)
          .get('/api/audiobooks/meta/finished')
          .set('Authorization', `Bearer ${userToken}`);

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);
        expect(res.body[0].title).toBe('Finished');
      });
    });

    describe('GET /api/audiobooks/meta/up-next', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app).get('/api/audiobooks/meta/up-next');
        expect(res.status).toBe(401);
      });

      it('returns queued books for current user', async () => {
        const book = await createTestAudiobook(db, { title: 'Queued Book' });

        await new Promise((resolve, reject) => {
          db.run(
            'INSERT INTO playback_progress (user_id, audiobook_id, position, completed, queued_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)',
            [regularUser.id, book.id, 0, 0],
            err => err ? reject(err) : resolve()
          );
        });

        const res = await request(app)
          .get('/api/audiobooks/meta/up-next')
          .set('Authorization', `Bearer ${userToken}`);

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);
        expect(res.body[0].title).toBe('Queued Book');
      });

      it('excludes completed queued books', async () => {
        const book = await createTestAudiobook(db, { title: 'Completed Queued' });

        await new Promise((resolve, reject) => {
          db.run(
            'INSERT INTO playback_progress (user_id, audiobook_id, position, completed, queued_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)',
            [regularUser.id, book.id, 3600, 1],
            err => err ? reject(err) : resolve()
          );
        });

        const res = await request(app)
          .get('/api/audiobooks/meta/up-next')
          .set('Authorization', `Bearer ${userToken}`);

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(0);
      });
    });
  });

  // ============================================
  // BATCH OPERATIONS
  // ============================================
  describe('Batch Operations', () => {
    describe('POST /api/audiobooks/batch/mark-finished', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app)
          .post('/api/audiobooks/batch/mark-finished')
          .send({ audiobook_ids: [1, 2] });
        expect(res.status).toBe(401);
      });

      it('returns 400 without audiobook_ids', async () => {
        const res = await request(app)
          .post('/api/audiobooks/batch/mark-finished')
          .set('Authorization', `Bearer ${userToken}`)
          .send({});

        expect(res.status).toBe(400);
      });

      it('returns 400 with empty audiobook_ids array', async () => {
        const res = await request(app)
          .post('/api/audiobooks/batch/mark-finished')
          .set('Authorization', `Bearer ${userToken}`)
          .send({ audiobook_ids: [] });

        expect(res.status).toBe(400);
      });

      it('marks multiple audiobooks as finished', async () => {
        const book1 = await createTestAudiobook(db, { title: 'Book 1' });
        const book2 = await createTestAudiobook(db, { title: 'Book 2' });

        const res = await request(app)
          .post('/api/audiobooks/batch/mark-finished')
          .set('Authorization', `Bearer ${userToken}`)
          .send({ audiobook_ids: [book1.id, book2.id] });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.updated).toBe(2);

        // Verify
        const finishedRes = await request(app)
          .get('/api/audiobooks/meta/finished')
          .set('Authorization', `Bearer ${userToken}`);
        expect(finishedRes.body).toHaveLength(2);
      });
    });

    describe('POST /api/audiobooks/batch/clear-progress', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app)
          .post('/api/audiobooks/batch/clear-progress')
          .send({ audiobook_ids: [1, 2] });
        expect(res.status).toBe(401);
      });

      it('returns 400 without audiobook_ids', async () => {
        const res = await request(app)
          .post('/api/audiobooks/batch/clear-progress')
          .set('Authorization', `Bearer ${userToken}`)
          .send({});

        expect(res.status).toBe(400);
      });

      it('clears progress for multiple audiobooks', async () => {
        const book1 = await createTestAudiobook(db, { title: 'Book 1' });
        const book2 = await createTestAudiobook(db, { title: 'Book 2' });

        // Add progress
        for (const book of [book1, book2]) {
          await new Promise((resolve, reject) => {
            db.run(
              'INSERT INTO playback_progress (user_id, audiobook_id, position, completed) VALUES (?, ?, ?, ?)',
              [regularUser.id, book.id, 1000, 0],
              err => err ? reject(err) : resolve()
            );
          });
        }

        const res = await request(app)
          .post('/api/audiobooks/batch/clear-progress')
          .set('Authorization', `Bearer ${userToken}`)
          .send({ audiobook_ids: [book1.id, book2.id] });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.deleted).toBe(2);

        // Verify progress cleared
        const progress1 = await request(app)
          .get(`/api/audiobooks/${book1.id}/progress`)
          .set('Authorization', `Bearer ${userToken}`);
        expect(progress1.body.position).toBe(0);
      });
    });

    describe('POST /api/audiobooks/batch/delete', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app)
          .post('/api/audiobooks/batch/delete')
          .send({ audiobook_ids: [1, 2] });
        expect(res.status).toBe(401);
      });

      it('returns 403 for non-admin users', async () => {
        const book = await createTestAudiobook(db, { title: 'Test Book' });

        const res = await request(app)
          .post('/api/audiobooks/batch/delete')
          .set('Authorization', `Bearer ${userToken}`)
          .send({ audiobook_ids: [book.id] });

        expect(res.status).toBe(403);
      });

      it('returns 400 without audiobook_ids', async () => {
        const res = await request(app)
          .post('/api/audiobooks/batch/delete')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({});

        expect(res.status).toBe(400);
      });

      it('deletes multiple audiobooks as admin', async () => {
        const book1 = await createTestAudiobook(db, { title: 'Book 1' });
        const book2 = await createTestAudiobook(db, { title: 'Book 2' });
        const book3 = await createTestAudiobook(db, { title: 'Book 3 - Keep' });

        const res = await request(app)
          .post('/api/audiobooks/batch/delete')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ audiobook_ids: [book1.id, book2.id] });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.deleted).toBe(2);

        // Verify deletions
        const listRes = await request(app)
          .get('/api/audiobooks')
          .set('Authorization', `Bearer ${adminToken}`);
        expect(listRes.body.audiobooks).toHaveLength(1);
        expect(listRes.body.audiobooks[0].title).toBe('Book 3 - Keep');
      });

      it('cleans up related data on batch delete', async () => {
        const book = await createTestAudiobook(db, { title: 'Book with Data' });

        // Add progress, favorite, rating
        await new Promise((resolve, reject) => {
          db.run(
            'INSERT INTO playback_progress (user_id, audiobook_id, position, completed) VALUES (?, ?, ?, ?)',
            [regularUser.id, book.id, 1000, 0],
            err => err ? reject(err) : resolve()
          );
        });
        await new Promise((resolve, reject) => {
          db.run(
            'INSERT INTO user_favorites (user_id, audiobook_id) VALUES (?, ?)',
            [regularUser.id, book.id],
            err => err ? reject(err) : resolve()
          );
        });
        await new Promise((resolve, reject) => {
          db.run(
            'INSERT INTO user_ratings (user_id, audiobook_id, rating) VALUES (?, ?, ?)',
            [regularUser.id, book.id, 5],
            err => err ? reject(err) : resolve()
          );
        });

        const res = await request(app)
          .post('/api/audiobooks/batch/delete')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ audiobook_ids: [book.id] });

        expect(res.status).toBe(200);

        // Verify related data cleaned up
        const countRes = await new Promise((resolve, reject) => {
          db.get(
            'SELECT COUNT(*) as c FROM playback_progress WHERE audiobook_id = ?',
            [book.id],
            (err, row) => err ? reject(err) : resolve(row)
          );
        });
        expect(countRes.c).toBe(0);
      });
    });
  });

  // ============================================
  // SECURITY TESTS
  // ============================================
  describe('Security', () => {
    it('user cannot see other user progress in list', async () => {
      const book = await createTestAudiobook(db, { title: 'Test Book' });

      // Add progress for admin
      await new Promise((resolve, reject) => {
        db.run(
          'INSERT INTO playback_progress (user_id, audiobook_id, position, completed) VALUES (?, ?, ?, ?)',
          [adminUser.id, book.id, 2000, 0],
          err => err ? reject(err) : resolve()
        );
      });

      const res = await request(app)
        .get('/api/audiobooks')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      // Regular user should not see admin's progress
      expect(res.body.audiobooks[0].progress).toBeNull();
    });

    it('user cannot see other user favorites', async () => {
      const book = await createTestAudiobook(db, { title: 'Test Book' });

      // Add favorite for admin
      await new Promise((resolve, reject) => {
        db.run(
          'INSERT INTO user_favorites (user_id, audiobook_id) VALUES (?, ?)',
          [adminUser.id, book.id],
          err => err ? reject(err) : resolve()
        );
      });

      const res = await request(app)
        .get('/api/audiobooks')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      // Regular user should not see admin's favorite status
      expect(res.body.audiobooks[0].is_favorite).toBe(false);
    });

    it('SQL injection attempt in search is safe', async () => {
      await createTestAudiobook(db, { title: 'Test Book' });

      const res = await request(app)
        .get('/api/audiobooks?search=\'; DROP TABLE audiobooks; --')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      // Table should still exist, search just returns no results
      expect(res.body.audiobooks).toHaveLength(0);

      // Verify table still works
      const listRes = await request(app)
        .get('/api/audiobooks')
        .set('Authorization', `Bearer ${userToken}`);
      expect(listRes.body.audiobooks).toHaveLength(1);
    });

    it('XSS in audiobook title is stored safely', async () => {
      const book = await createTestAudiobook(db, { title: '<script>alert("xss")</script>' });

      const res = await request(app)
        .get(`/api/audiobooks/${book.id}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      // Title should be stored as-is (sanitization happens on frontend)
      expect(res.body.title).toBe('<script>alert("xss")</script>');
    });
  });
});
