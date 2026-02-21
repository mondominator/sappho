/**
 * Integration tests for Ratings Routes
 * Tests: Get, set, update, delete ratings and reviews
 */

const request = require('supertest');
const {
  createTestDatabase,
  createTestUser,
  generateTestToken,
  createTestApp,
  createTestAudiobook
} = require('./testApp');

describe('Ratings Routes', () => {
  let db;
  let app;
  let user1, user2, adminUser;
  let user1Token, user2Token, adminToken;
  let book1, book2, book3;

  beforeAll(async () => {
    db = await createTestDatabase();
    app = createTestApp(db);

    // Create test users
    user1 = await createTestUser(db, { username: 'ratinguser1', password: 'RatingPass123!' });
    user2 = await createTestUser(db, { username: 'ratinguser2', password: 'RatingPass123!' });
    adminUser = await createTestUser(db, { username: 'ratingadmin', password: 'AdminPass123!', isAdmin: true });

    user1Token = generateTestToken(user1);
    user2Token = generateTestToken(user2);
    adminToken = generateTestToken(adminUser);

    // Create test audiobooks
    book1 = await createTestAudiobook(db, { title: 'Rating Book 1', author: 'Test Author' });
    book2 = await createTestAudiobook(db, { title: 'Rating Book 2', author: 'Test Author' });
    book3 = await createTestAudiobook(db, { title: 'Rating Book 3', author: 'Another Author' });
  });

  afterAll((done) => {
    db.close(done);
  });

  describe('GET /api/ratings/audiobook/:audiobookId', () => {
    describe('Authentication', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app)
          .get(`/api/ratings/audiobook/${book1.id}`)
          .expect(401);

        expect(res.body.error).toBe('Access token required');
      });
    });

    describe('Response data', () => {
      it('returns null for unrated audiobook', async () => {
        const res = await request(app)
          .get(`/api/ratings/audiobook/${book1.id}`)
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body).toBeNull();
      });

      it('returns rating for rated audiobook', async () => {
        // First create a rating
        await request(app)
          .post(`/api/ratings/audiobook/${book1.id}`)
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ rating: 5, review: 'Excellent book!' });

        const res = await request(app)
          .get(`/api/ratings/audiobook/${book1.id}`)
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body).toHaveProperty('id');
        expect(res.body).toHaveProperty('rating', 5);
        expect(res.body).toHaveProperty('review', 'Excellent book!');
        expect(res.body).toHaveProperty('user_id', user1.id);
        expect(res.body).toHaveProperty('audiobook_id', book1.id);
      });

      it('returns only current user\'s rating', async () => {
        // User2 has no rating for book1
        const res = await request(app)
          .get(`/api/ratings/audiobook/${book1.id}`)
          .set('Authorization', `Bearer ${user2Token}`)
          .expect(200);

        expect(res.body).toBeNull();
      });
    });
  });

  describe('GET /api/ratings/audiobook/:audiobookId/all', () => {
    beforeAll(async () => {
      // Add ratings from multiple users for book2
      await request(app)
        .post(`/api/ratings/audiobook/${book2.id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ rating: 4, review: 'Great book!' });

      await request(app)
        .post(`/api/ratings/audiobook/${book2.id}`)
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ rating: 5, review: 'Amazing!' });
    });

    describe('Authentication', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app)
          .get(`/api/ratings/audiobook/${book2.id}/all`)
          .expect(401);

        expect(res.body.error).toBe('Access token required');
      });
    });

    describe('Response data', () => {
      it('returns all ratings for an audiobook', async () => {
        const res = await request(app)
          .get(`/api/ratings/audiobook/${book2.id}/all`)
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBeGreaterThanOrEqual(2);
      });

      it('includes username and display_name', async () => {
        const res = await request(app)
          .get(`/api/ratings/audiobook/${book2.id}/all`)
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body[0]).toHaveProperty('username');
        expect(res.body[0]).toHaveProperty('display_name');
      });

      it('returns empty array for unrated audiobook', async () => {
        const res = await request(app)
          .get(`/api/ratings/audiobook/${book3.id}/all`)
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body).toEqual([]);
      });
    });
  });

  describe('GET /api/ratings/audiobook/:audiobookId/average', () => {
    describe('Authentication', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app)
          .get(`/api/ratings/audiobook/${book2.id}/average`)
          .expect(401);

        expect(res.body.error).toBe('Access token required');
      });
    });

    describe('Response data', () => {
      it('returns average rating', async () => {
        const res = await request(app)
          .get(`/api/ratings/audiobook/${book2.id}/average`)
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body).toHaveProperty('average');
        expect(res.body).toHaveProperty('count');
        expect(res.body.count).toBeGreaterThanOrEqual(2);
        // Average of 4 and 5 is 4.5
        expect(res.body.average).toBeCloseTo(4.5, 1);
      });

      it('returns null average for unrated audiobook', async () => {
        const res = await request(app)
          .get(`/api/ratings/audiobook/${book3.id}/average`)
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body.average).toBeNull();
        expect(res.body.count).toBe(0);
      });

      it('rounds average to one decimal place', async () => {
        const res = await request(app)
          .get(`/api/ratings/audiobook/${book2.id}/average`)
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        // Check it's rounded properly
        const decimalPlaces = (res.body.average.toString().split('.')[1] || '').length;
        expect(decimalPlaces).toBeLessThanOrEqual(1);
      });
    });
  });

  describe('POST /api/ratings/audiobook/:audiobookId', () => {
    let testBookId;

    beforeEach(async () => {
      // Create a fresh book for each test
      const book = await createTestAudiobook(db, { title: `Test Book ${Date.now()}` });
      testBookId = book.id;
    });

    describe('Authentication', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app)
          .post(`/api/ratings/audiobook/${testBookId}`)
          .send({ rating: 5 })
          .expect(401);

        expect(res.body.error).toBe('Access token required');
      });
    });

    describe('Validation', () => {
      it('returns 400 for rating below 1', async () => {
        const res = await request(app)
          .post(`/api/ratings/audiobook/${testBookId}`)
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ rating: 0 })
          .expect(400);

        expect(res.body.error).toBe('Rating must be between 1 and 5');
      });

      it('returns 400 for rating above 5', async () => {
        const res = await request(app)
          .post(`/api/ratings/audiobook/${testBookId}`)
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ rating: 6 })
          .expect(400);

        expect(res.body.error).toBe('Rating must be between 1 and 5');
      });

      it('returns 400 for non-numeric rating', async () => {
        const res = await request(app)
          .post(`/api/ratings/audiobook/${testBookId}`)
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ rating: 'five' })
          .expect(400);

        expect(res.body.error).toBe('Rating must be between 1 and 5');
      });
    });

    describe('Success - Create', () => {
      it('creates new rating', async () => {
        const res = await request(app)
          .post(`/api/ratings/audiobook/${testBookId}`)
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ rating: 4 })
          .expect(201);

        expect(res.body).toHaveProperty('id');
        expect(res.body.rating).toBe(4);
        expect(res.body.user_id).toBe(user1.id);
        expect(res.body.audiobook_id).toBe(testBookId);
      });

      it('creates rating with review', async () => {
        const res = await request(app)
          .post(`/api/ratings/audiobook/${testBookId}`)
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ rating: 5, review: 'This is my review' })
          .expect(201);

        expect(res.body.rating).toBe(5);
        expect(res.body.review).toBe('This is my review');
      });

      it('creates review without rating', async () => {
        const res = await request(app)
          .post(`/api/ratings/audiobook/${testBookId}`)
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ review: 'Just a review, no rating' })
          .expect(201);

        expect(res.body.rating).toBeNull();
        expect(res.body.review).toBe('Just a review, no rating');
      });

      it('accepts integer ratings 1-5', async () => {
        for (let rating = 1; rating <= 5; rating++) {
          const book = await createTestAudiobook(db, { title: `Rating ${rating} Book` });
          const res = await request(app)
            .post(`/api/ratings/audiobook/${book.id}`)
            .set('Authorization', `Bearer ${user1Token}`)
            .send({ rating })
            .expect(201);

          expect(res.body.rating).toBe(rating);
        }
      });
    });

    describe('Success - Update', () => {
      it('updates existing rating', async () => {
        // Create initial rating
        await request(app)
          .post(`/api/ratings/audiobook/${testBookId}`)
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ rating: 3 });

        // Update it
        const res = await request(app)
          .post(`/api/ratings/audiobook/${testBookId}`)
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ rating: 5 })
          .expect(200);

        expect(res.body.rating).toBe(5);
      });

      it('updates rating and adds review', async () => {
        // Create initial rating without review
        await request(app)
          .post(`/api/ratings/audiobook/${testBookId}`)
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ rating: 4 });

        // Update with review
        const res = await request(app)
          .post(`/api/ratings/audiobook/${testBookId}`)
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ rating: 5, review: 'Added review later' })
          .expect(200);

        expect(res.body.rating).toBe(5);
        expect(res.body.review).toBe('Added review later');
      });

      it('updates updated_at timestamp on update', async () => {
        // Create initial rating
        await request(app)
          .post(`/api/ratings/audiobook/${testBookId}`)
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ rating: 3 });

        // Wait a moment
        await new Promise(resolve => setTimeout(resolve, 100));

        // Update it
        const res = await request(app)
          .post(`/api/ratings/audiobook/${testBookId}`)
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ rating: 4 })
          .expect(200);

        expect(res.body).toHaveProperty('updated_at');
      });
    });
  });

  describe('DELETE /api/ratings/audiobook/:audiobookId', () => {
    let testBookId;

    beforeEach(async () => {
      const book = await createTestAudiobook(db, { title: `Delete Test Book ${Date.now()}` });
      testBookId = book.id;
      
      // Create a rating to delete
      await request(app)
        .post(`/api/ratings/audiobook/${testBookId}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ rating: 4, review: 'To be deleted' });
    });

    describe('Authentication', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app)
          .delete(`/api/ratings/audiobook/${testBookId}`)
          .expect(401);

        expect(res.body.error).toBe('Access token required');
      });
    });

    describe('Validation', () => {
      it('returns 404 for non-existent rating', async () => {
        const res = await request(app)
          .delete('/api/ratings/audiobook/99999')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(404);

        expect(res.body.error).toBe('Rating not found');
      });

      it('returns 404 when deleting another user\'s rating', async () => {
        const res = await request(app)
          .delete(`/api/ratings/audiobook/${testBookId}`)
          .set('Authorization', `Bearer ${user2Token}`)
          .expect(404);

        expect(res.body.error).toBe('Rating not found');
      });
    });

    describe('Success', () => {
      it('deletes rating successfully', async () => {
        const res = await request(app)
          .delete(`/api/ratings/audiobook/${testBookId}`)
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body.success).toBe(true);

        // Verify deletion
        const getRes = await request(app)
          .get(`/api/ratings/audiobook/${testBookId}`)
          .set('Authorization', `Bearer ${user1Token}`);

        expect(getRes.body).toBeNull();
      });
    });
  });

  describe('GET /api/ratings/my-ratings', () => {
    beforeAll(async () => {
      // Create some ratings for user1
      const bookA = await createTestAudiobook(db, { title: 'My Rating Book A' });
      const bookB = await createTestAudiobook(db, { title: 'My Rating Book B' });

      await request(app)
        .post(`/api/ratings/audiobook/${bookA.id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ rating: 5, review: 'Great!' });

      await request(app)
        .post(`/api/ratings/audiobook/${bookB.id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ rating: 3, review: 'Okay' });
    });

    describe('Authentication', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app)
          .get('/api/ratings/my-ratings')
          .expect(401);

        expect(res.body.error).toBe('Access token required');
      });
    });

    describe('Response data', () => {
      it('returns all ratings by current user', async () => {
        const res = await request(app)
          .get('/api/ratings/my-ratings')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBeGreaterThanOrEqual(2);
      });

      it('includes audiobook details', async () => {
        const res = await request(app)
          .get('/api/ratings/my-ratings')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body[0]).toHaveProperty('title');
        expect(res.body[0]).toHaveProperty('author');
        expect(res.body[0]).toHaveProperty('cover_image');
      });

      it('includes rating and review', async () => {
        const res = await request(app)
          .get('/api/ratings/my-ratings')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body[0]).toHaveProperty('rating');
        expect(res.body[0]).toHaveProperty('review');
      });

      it('only returns current user\'s ratings', async () => {
        const res = await request(app)
          .get('/api/ratings/my-ratings')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);

        // Admin hasn't rated these books, so their count should be lower
        res.body.forEach(rating => {
          expect(rating.user_id).toBe(adminUser.id);
        });
      });
    });
  });

  describe('Security', () => {
    it('users can only delete their own ratings', async () => {
      const book = await createTestAudiobook(db, { title: 'Security Test Book' });

      // User1 creates a rating
      await request(app)
        .post(`/api/ratings/audiobook/${book.id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ rating: 5 });

      // User2 cannot delete it
      await request(app)
        .delete(`/api/ratings/audiobook/${book.id}`)
        .set('Authorization', `Bearer ${user2Token}`)
        .expect(404);

      // User1 can still see their rating
      const res = await request(app)
        .get(`/api/ratings/audiobook/${book.id}`)
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.body.rating).toBe(5);
    });

    it('users can see all ratings but only modify their own', async () => {
      const book = await createTestAudiobook(db, { title: 'Multi User Rating Book' });

      // Both users rate the book
      await request(app)
        .post(`/api/ratings/audiobook/${book.id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ rating: 5 });

      await request(app)
        .post(`/api/ratings/audiobook/${book.id}`)
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ rating: 3 });

      // Both can see all ratings
      const allRatingsRes = await request(app)
        .get(`/api/ratings/audiobook/${book.id}/all`)
        .set('Authorization', `Bearer ${user1Token}`);

      expect(allRatingsRes.body.length).toBe(2);

      // But each can only get their own
      const user1Rating = await request(app)
        .get(`/api/ratings/audiobook/${book.id}`)
        .set('Authorization', `Bearer ${user1Token}`);

      expect(user1Rating.body.rating).toBe(5);

      const user2Rating = await request(app)
        .get(`/api/ratings/audiobook/${book.id}`)
        .set('Authorization', `Bearer ${user2Token}`);

      expect(user2Rating.body.rating).toBe(3);
    });
  });
});
