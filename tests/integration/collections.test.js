/**
 * Integration tests for Collections Routes
 * Tests: CRUD operations, item management, visibility, authorization
 */

const request = require('supertest');
const {
  createTestDatabase,
  createTestUser,
  generateTestToken,
  createTestApp,
  createTestAudiobook,
  createTestCollection,
  addToCollection
} = require('./testApp');

describe('Collections Routes', () => {
  let db;
  let app;
  let user1, user2, adminUser;
  let user1Token, user2Token, adminToken;
  let book1, book2, book3;

  beforeAll(async () => {
    db = await createTestDatabase();
    app = createTestApp(db);

    // Create test users
    user1 = await createTestUser(db, { username: 'user1', password: 'User1Pass123!' });
    user2 = await createTestUser(db, { username: 'user2', password: 'User2Pass123!' });
    adminUser = await createTestUser(db, { username: 'admin', password: 'AdminPass123!', isAdmin: true });

    user1Token = generateTestToken(user1);
    user2Token = generateTestToken(user2);
    adminToken = generateTestToken(adminUser);

    // Create test audiobooks
    book1 = await createTestAudiobook(db, { title: 'Book One', author: 'Author A' });
    book2 = await createTestAudiobook(db, { title: 'Book Two', author: 'Author B' });
    book3 = await createTestAudiobook(db, { title: 'Book Three', author: 'Author C' });
  });

  afterAll((done) => {
    db.close(done);
  });

  describe('GET /api/collections', () => {
    describe('Authentication', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app)
          .get('/api/collections')
          .expect(401);

        expect(res.body.error).toBe('Access token required');
      });

      it('returns collections with valid token', async () => {
        const res = await request(app)
          .get('/api/collections')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(Array.isArray(res.body)).toBe(true);
      });
    });

    describe('Visibility', () => {
      let privateCollection, publicCollection;

      beforeAll(async () => {
        // Create collections for visibility tests
        privateCollection = await createTestCollection(db, {
          user_id: user1.id,
          name: 'User1 Private',
          is_public: 0
        });

        publicCollection = await createTestCollection(db, {
          user_id: user1.id,
          name: 'User1 Public',
          is_public: 1
        });
      });

      it('user sees own private collections', async () => {
        const res = await request(app)
          .get('/api/collections')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        const names = res.body.map(c => c.name);
        expect(names).toContain('User1 Private');
      });

      it('user sees own public collections', async () => {
        const res = await request(app)
          .get('/api/collections')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        const names = res.body.map(c => c.name);
        expect(names).toContain('User1 Public');
      });

      it('other user does not see private collections', async () => {
        const res = await request(app)
          .get('/api/collections')
          .set('Authorization', `Bearer ${user2Token}`)
          .expect(200);

        const names = res.body.map(c => c.name);
        expect(names).not.toContain('User1 Private');
      });

      it('other user sees public collections', async () => {
        const res = await request(app)
          .get('/api/collections')
          .set('Authorization', `Bearer ${user2Token}`)
          .expect(200);

        const names = res.body.map(c => c.name);
        expect(names).toContain('User1 Public');
      });

      it('marks owned collections with is_owner=1', async () => {
        const res = await request(app)
          .get('/api/collections')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        const ownedCollection = res.body.find(c => c.name === 'User1 Private');
        expect(ownedCollection.is_owner).toBe(1);
      });

      it('marks non-owned collections with is_owner=0', async () => {
        const res = await request(app)
          .get('/api/collections')
          .set('Authorization', `Bearer ${user2Token}`)
          .expect(200);

        const publicColl = res.body.find(c => c.name === 'User1 Public');
        expect(publicColl.is_owner).toBe(0);
      });
    });

    describe('Response data', () => {
      let collectionWithBooks;

      beforeAll(async () => {
        collectionWithBooks = await createTestCollection(db, {
          user_id: user1.id,
          name: 'Collection With Books',
          description: 'Test description',
          is_public: 0
        });

        await addToCollection(db, collectionWithBooks.id, book1.id, 0);
        await addToCollection(db, collectionWithBooks.id, book2.id, 1);
      });

      it('includes book_count', async () => {
        const res = await request(app)
          .get('/api/collections')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        const coll = res.body.find(c => c.name === 'Collection With Books');
        expect(coll.book_count).toBe(2);
      });

      it('includes total_duration', async () => {
        const res = await request(app)
          .get('/api/collections')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        const coll = res.body.find(c => c.name === 'Collection With Books');
        expect(coll.total_duration).toBeGreaterThan(0);
      });

      it('includes book_ids array', async () => {
        const res = await request(app)
          .get('/api/collections')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        const coll = res.body.find(c => c.name === 'Collection With Books');
        expect(Array.isArray(coll.book_ids)).toBe(true);
        expect(coll.book_ids).toContain(book1.id);
        expect(coll.book_ids).toContain(book2.id);
      });

      it('includes creator_username', async () => {
        const res = await request(app)
          .get('/api/collections')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        const coll = res.body.find(c => c.name === 'Collection With Books');
        expect(coll.creator_username).toBe('user1');
      });
    });
  });

  describe('POST /api/collections', () => {
    describe('Authentication', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app)
          .post('/api/collections')
          .send({ name: 'New Collection' })
          .expect(401);

        expect(res.body.error).toBe('Access token required');
      });
    });

    describe('Validation', () => {
      it('returns 400 without name', async () => {
        const res = await request(app)
          .post('/api/collections')
          .set('Authorization', `Bearer ${user1Token}`)
          .send({})
          .expect(400);

        expect(res.body.error).toBe('Collection name is required');
      });

      it('returns 400 with empty name', async () => {
        const res = await request(app)
          .post('/api/collections')
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ name: '   ' })
          .expect(400);

        expect(res.body.error).toBe('Collection name is required');
      });
    });

    describe('Success', () => {
      it('creates collection with name only', async () => {
        const res = await request(app)
          .post('/api/collections')
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ name: 'Minimal Collection' })
          .expect(201);

        expect(res.body.name).toBe('Minimal Collection');
        expect(res.body.is_public).toBe(0);
        expect(res.body.is_owner).toBe(1);
      });

      it('creates collection with all fields', async () => {
        const res = await request(app)
          .post('/api/collections')
          .set('Authorization', `Bearer ${user1Token}`)
          .send({
            name: 'Full Collection',
            description: 'A full description',
            is_public: true
          })
          .expect(201);

        expect(res.body.name).toBe('Full Collection');
        expect(res.body.description).toBe('A full description');
        expect(res.body.is_public).toBe(1);
      });

      it('trims whitespace from name', async () => {
        const res = await request(app)
          .post('/api/collections')
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ name: '  Trimmed Name  ' })
          .expect(201);

        expect(res.body.name).toBe('Trimmed Name');
      });

      it('includes creator_username in response', async () => {
        const res = await request(app)
          .post('/api/collections')
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ name: 'Creator Test' })
          .expect(201);

        expect(res.body.creator_username).toBe('user1');
      });
    });
  });

  describe('GET /api/collections/for-book/:bookId', () => {
    let collWithBook, collWithoutBook, publicCollWithBook;

    beforeAll(async () => {
      collWithBook = await createTestCollection(db, {
        user_id: user1.id,
        name: 'Has Book One',
        is_public: 0
      });
      await addToCollection(db, collWithBook.id, book1.id, 0);

      collWithoutBook = await createTestCollection(db, {
        user_id: user1.id,
        name: 'No Book One',
        is_public: 0
      });

      publicCollWithBook = await createTestCollection(db, {
        user_id: user2.id,
        name: 'Public Has Book One',
        is_public: 1
      });
      await addToCollection(db, publicCollWithBook.id, book1.id, 0);
    });

    it('returns 401 without authentication', async () => {
      const res = await request(app)
        .get(`/api/collections/for-book/${book1.id}`)
        .expect(401);

      expect(res.body.error).toBe('Access token required');
    });

    it('returns collections with contains_book flag', async () => {
      const res = await request(app)
        .get(`/api/collections/for-book/${book1.id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      const withBook = res.body.find(c => c.name === 'Has Book One');
      const withoutBook = res.body.find(c => c.name === 'No Book One');

      expect(withBook.contains_book).toBe(1);
      expect(withoutBook.contains_book).toBe(0);
    });

    it('includes public collections from other users', async () => {
      const res = await request(app)
        .get(`/api/collections/for-book/${book1.id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      const publicColl = res.body.find(c => c.name === 'Public Has Book One');
      expect(publicColl).toBeDefined();
      expect(publicColl.contains_book).toBe(1);
    });

    it('marks ownership correctly', async () => {
      const res = await request(app)
        .get(`/api/collections/for-book/${book1.id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      const owned = res.body.find(c => c.name === 'Has Book One');
      const notOwned = res.body.find(c => c.name === 'Public Has Book One');

      expect(owned.is_owner).toBe(1);
      expect(notOwned.is_owner).toBe(0);
    });
  });

  describe('GET /api/collections/:id', () => {
    let privateCollection, publicCollection;

    beforeAll(async () => {
      privateCollection = await createTestCollection(db, {
        user_id: user1.id,
        name: 'Get Private Test',
        description: 'Private desc',
        is_public: 0
      });
      await addToCollection(db, privateCollection.id, book1.id, 0);
      await addToCollection(db, privateCollection.id, book2.id, 1);

      publicCollection = await createTestCollection(db, {
        user_id: user1.id,
        name: 'Get Public Test',
        is_public: 1
      });
    });

    describe('Authentication', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app)
          .get(`/api/collections/${privateCollection.id}`)
          .expect(401);

        expect(res.body.error).toBe('Access token required');
      });
    });

    describe('Authorization', () => {
      it('owner can access private collection', async () => {
        const res = await request(app)
          .get(`/api/collections/${privateCollection.id}`)
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body.name).toBe('Get Private Test');
      });

      it('non-owner cannot access private collection', async () => {
        const res = await request(app)
          .get(`/api/collections/${privateCollection.id}`)
          .set('Authorization', `Bearer ${user2Token}`)
          .expect(404);

        expect(res.body.error).toBe('Collection not found');
      });

      it('non-owner can access public collection', async () => {
        const res = await request(app)
          .get(`/api/collections/${publicCollection.id}`)
          .set('Authorization', `Bearer ${user2Token}`)
          .expect(200);

        expect(res.body.name).toBe('Get Public Test');
      });
    });

    describe('Response data', () => {
      it('includes collection details', async () => {
        const res = await request(app)
          .get(`/api/collections/${privateCollection.id}`)
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body.name).toBe('Get Private Test');
        expect(res.body.description).toBe('Private desc');
        expect(res.body.is_owner).toBe(1);
        expect(res.body.creator_username).toBe('user1');
      });

      it('includes books array', async () => {
        const res = await request(app)
          .get(`/api/collections/${privateCollection.id}`)
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(Array.isArray(res.body.books)).toBe(true);
        expect(res.body.books.length).toBe(2);
      });

      it('books are ordered by position', async () => {
        const res = await request(app)
          .get(`/api/collections/${privateCollection.id}`)
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body.books[0].id).toBe(book1.id);
        expect(res.body.books[1].id).toBe(book2.id);
      });

      it('includes book details', async () => {
        const res = await request(app)
          .get(`/api/collections/${privateCollection.id}`)
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        const firstBook = res.body.books[0];
        expect(firstBook.title).toBe('Book One');
        expect(firstBook.author).toBe('Author A');
        expect(firstBook.position).toBe(0);
      });
    });

    describe('Not found', () => {
      it('returns 404 for non-existent collection', async () => {
        const res = await request(app)
          .get('/api/collections/99999')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(404);

        expect(res.body.error).toBe('Collection not found');
      });
    });
  });

  describe('PUT /api/collections/:id', () => {
    let testCollection;

    beforeEach(async () => {
      testCollection = await createTestCollection(db, {
        user_id: user1.id,
        name: 'Update Test',
        description: 'Original description',
        is_public: 0
      });
    });

    describe('Authentication', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app)
          .put(`/api/collections/${testCollection.id}`)
          .send({ name: 'Updated' })
          .expect(401);

        expect(res.body.error).toBe('Access token required');
      });
    });

    describe('Authorization', () => {
      it('owner can update collection', async () => {
        const res = await request(app)
          .put(`/api/collections/${testCollection.id}`)
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ name: 'Updated Name' })
          .expect(200);

        expect(res.body.name).toBe('Updated Name');
      });

      it('non-owner cannot update collection', async () => {
        const res = await request(app)
          .put(`/api/collections/${testCollection.id}`)
          .set('Authorization', `Bearer ${user2Token}`)
          .send({ name: 'Hacked Name' })
          .expect(404);

        expect(res.body.error).toBe('Collection not found or not owned by you');
      });

      it('non-owner cannot update public collection', async () => {
        // Make it public first
        await new Promise((resolve, reject) => {
          db.run(
            'UPDATE user_collections SET is_public = 1 WHERE id = ?',
            [testCollection.id],
            (err) => err ? reject(err) : resolve()
          );
        });

        const res = await request(app)
          .put(`/api/collections/${testCollection.id}`)
          .set('Authorization', `Bearer ${user2Token}`)
          .send({ name: 'Hacked Name' })
          .expect(404);

        expect(res.body.error).toBe('Collection not found or not owned by you');
      });
    });

    describe('Validation', () => {
      it('returns 400 without name', async () => {
        const res = await request(app)
          .put(`/api/collections/${testCollection.id}`)
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ description: 'No name' })
          .expect(400);

        expect(res.body.error).toBe('Collection name is required');
      });
    });

    describe('Success', () => {
      it('updates name', async () => {
        const res = await request(app)
          .put(`/api/collections/${testCollection.id}`)
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ name: 'New Name' })
          .expect(200);

        expect(res.body.name).toBe('New Name');
      });

      it('updates description', async () => {
        const res = await request(app)
          .put(`/api/collections/${testCollection.id}`)
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ name: 'Update Test', description: 'New description' })
          .expect(200);

        expect(res.body.description).toBe('New description');
      });

      it('updates visibility', async () => {
        const res = await request(app)
          .put(`/api/collections/${testCollection.id}`)
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ name: 'Update Test', is_public: true })
          .expect(200);

        expect(res.body.is_public).toBe(1);
      });

      it('clears description when set to null', async () => {
        const res = await request(app)
          .put(`/api/collections/${testCollection.id}`)
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ name: 'Update Test', description: null })
          .expect(200);

        expect(res.body.description).toBeNull();
      });
    });
  });

  describe('DELETE /api/collections/:id', () => {
    describe('Authentication', () => {
      it('returns 401 without authentication', async () => {
        const collection = await createTestCollection(db, {
          user_id: user1.id,
          name: 'Delete Auth Test'
        });

        const res = await request(app)
          .delete(`/api/collections/${collection.id}`)
          .expect(401);

        expect(res.body.error).toBe('Access token required');
      });
    });

    describe('Authorization', () => {
      it('owner can delete collection', async () => {
        const collection = await createTestCollection(db, {
          user_id: user1.id,
          name: 'Delete Owner Test'
        });

        const res = await request(app)
          .delete(`/api/collections/${collection.id}`)
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body.success).toBe(true);
      });

      it('non-owner cannot delete collection', async () => {
        const collection = await createTestCollection(db, {
          user_id: user1.id,
          name: 'Delete Non-Owner Test'
        });

        const res = await request(app)
          .delete(`/api/collections/${collection.id}`)
          .set('Authorization', `Bearer ${user2Token}`)
          .expect(404);

        expect(res.body.error).toBe('Collection not found or not owned by you');
      });

      it('non-owner cannot delete public collection', async () => {
        const collection = await createTestCollection(db, {
          user_id: user1.id,
          name: 'Delete Public Test',
          is_public: 1
        });

        const res = await request(app)
          .delete(`/api/collections/${collection.id}`)
          .set('Authorization', `Bearer ${user2Token}`)
          .expect(404);

        expect(res.body.error).toBe('Collection not found or not owned by you');
      });
    });

    describe('Not found', () => {
      it('returns 404 for non-existent collection', async () => {
        const res = await request(app)
          .delete('/api/collections/99999')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(404);

        expect(res.body.error).toBe('Collection not found or not owned by you');
      });
    });
  });

  describe('POST /api/collections/:id/items', () => {
    let privateCollection, publicCollection, user2Collection;

    beforeAll(async () => {
      privateCollection = await createTestCollection(db, {
        user_id: user1.id,
        name: 'Add Items Private',
        is_public: 0
      });

      publicCollection = await createTestCollection(db, {
        user_id: user1.id,
        name: 'Add Items Public',
        is_public: 1
      });

      user2Collection = await createTestCollection(db, {
        user_id: user2.id,
        name: 'User2 Private',
        is_public: 0
      });
    });

    describe('Authentication', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app)
          .post(`/api/collections/${privateCollection.id}/items`)
          .send({ audiobook_id: book1.id })
          .expect(401);

        expect(res.body.error).toBe('Access token required');
      });
    });

    describe('Validation', () => {
      it('returns 400 without audiobook_id', async () => {
        const res = await request(app)
          .post(`/api/collections/${privateCollection.id}/items`)
          .set('Authorization', `Bearer ${user1Token}`)
          .send({})
          .expect(400);

        expect(res.body.error).toBe('audiobook_id is required');
      });
    });

    describe('Authorization', () => {
      it('owner can add to private collection', async () => {
        const res = await request(app)
          .post(`/api/collections/${privateCollection.id}/items`)
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ audiobook_id: book3.id })
          .expect(201);

        expect(res.body.success).toBe(true);
      });

      it('non-owner cannot add to private collection', async () => {
        const res = await request(app)
          .post(`/api/collections/${user2Collection.id}/items`)
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ audiobook_id: book1.id })
          .expect(404);

        expect(res.body.error).toBe('Collection not found');
      });

      it('non-owner can add to public collection', async () => {
        const res = await request(app)
          .post(`/api/collections/${publicCollection.id}/items`)
          .set('Authorization', `Bearer ${user2Token}`)
          .send({ audiobook_id: book1.id })
          .expect(201);

        expect(res.body.success).toBe(true);
      });
    });

    describe('Duplicate prevention', () => {
      it('returns 409 when adding duplicate book', async () => {
        // First add
        await request(app)
          .post(`/api/collections/${privateCollection.id}/items`)
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ audiobook_id: book1.id })
          .expect(201);

        // Try to add again
        const res = await request(app)
          .post(`/api/collections/${privateCollection.id}/items`)
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ audiobook_id: book1.id })
          .expect(409);

        expect(res.body.error).toBe('Book already in collection');
      });
    });

    describe('Position assignment', () => {
      it('assigns incremental positions', async () => {
        const collection = await createTestCollection(db, {
          user_id: user1.id,
          name: 'Position Test'
        });

        await request(app)
          .post(`/api/collections/${collection.id}/items`)
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ audiobook_id: book1.id })
          .expect(201);

        await request(app)
          .post(`/api/collections/${collection.id}/items`)
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ audiobook_id: book2.id })
          .expect(201);

        const res = await request(app)
          .get(`/api/collections/${collection.id}`)
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body.books[0].position).toBe(0);
        expect(res.body.books[1].position).toBe(1);
      });
    });
  });

  describe('DELETE /api/collections/:id/items/:bookId', () => {
    let privateCollection, publicCollection;

    beforeEach(async () => {
      privateCollection = await createTestCollection(db, {
        user_id: user1.id,
        name: 'Remove Items Private',
        is_public: 0
      });
      await addToCollection(db, privateCollection.id, book1.id, 0);

      publicCollection = await createTestCollection(db, {
        user_id: user1.id,
        name: 'Remove Items Public',
        is_public: 1
      });
      await addToCollection(db, publicCollection.id, book2.id, 0);
    });

    describe('Authentication', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app)
          .delete(`/api/collections/${privateCollection.id}/items/${book1.id}`)
          .expect(401);

        expect(res.body.error).toBe('Access token required');
      });
    });

    describe('Authorization', () => {
      it('owner can remove from private collection', async () => {
        const res = await request(app)
          .delete(`/api/collections/${privateCollection.id}/items/${book1.id}`)
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body.success).toBe(true);
      });

      it('non-owner cannot remove from private collection', async () => {
        const res = await request(app)
          .delete(`/api/collections/${privateCollection.id}/items/${book1.id}`)
          .set('Authorization', `Bearer ${user2Token}`)
          .expect(404);

        expect(res.body.error).toBe('Collection not found');
      });

      it('non-owner can remove from public collection', async () => {
        const res = await request(app)
          .delete(`/api/collections/${publicCollection.id}/items/${book2.id}`)
          .set('Authorization', `Bearer ${user2Token}`)
          .expect(200);

        expect(res.body.success).toBe(true);
      });
    });

    describe('Not found', () => {
      it('returns 404 for book not in collection', async () => {
        const res = await request(app)
          .delete(`/api/collections/${privateCollection.id}/items/${book3.id}`)
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(404);

        expect(res.body.error).toBe('Book not in collection');
      });

      it('returns 404 for non-existent collection', async () => {
        const res = await request(app)
          .delete(`/api/collections/99999/items/${book1.id}`)
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(404);

        expect(res.body.error).toBe('Collection not found');
      });
    });
  });

  describe('PUT /api/collections/:id/items/reorder', () => {
    let collection;

    beforeEach(async () => {
      collection = await createTestCollection(db, {
        user_id: user1.id,
        name: 'Reorder Test',
        is_public: 0
      });
      await addToCollection(db, collection.id, book1.id, 0);
      await addToCollection(db, collection.id, book2.id, 1);
      await addToCollection(db, collection.id, book3.id, 2);
    });

    describe('Authentication', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app)
          .put(`/api/collections/${collection.id}/items/reorder`)
          .send({ order: [book3.id, book1.id, book2.id] })
          .expect(401);

        expect(res.body.error).toBe('Access token required');
      });
    });

    describe('Validation', () => {
      it('returns 400 when order is not an array', async () => {
        const res = await request(app)
          .put(`/api/collections/${collection.id}/items/reorder`)
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ order: 'not-an-array' })
          .expect(400);

        expect(res.body.error).toBe('order must be an array of audiobook IDs');
      });

      it('returns 400 when order is missing', async () => {
        const res = await request(app)
          .put(`/api/collections/${collection.id}/items/reorder`)
          .set('Authorization', `Bearer ${user1Token}`)
          .send({})
          .expect(400);

        expect(res.body.error).toBe('order must be an array of audiobook IDs');
      });
    });

    describe('Authorization', () => {
      it('owner can reorder private collection', async () => {
        const res = await request(app)
          .put(`/api/collections/${collection.id}/items/reorder`)
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ order: [book3.id, book1.id, book2.id] })
          .expect(200);

        expect(res.body.success).toBe(true);
      });

      it('non-owner cannot reorder private collection', async () => {
        const res = await request(app)
          .put(`/api/collections/${collection.id}/items/reorder`)
          .set('Authorization', `Bearer ${user2Token}`)
          .send({ order: [book3.id, book1.id, book2.id] })
          .expect(404);

        expect(res.body.error).toBe('Collection not found');
      });

      it('non-owner can reorder public collection', async () => {
        // Make collection public
        await new Promise((resolve, reject) => {
          db.run(
            'UPDATE user_collections SET is_public = 1 WHERE id = ?',
            [collection.id],
            (err) => err ? reject(err) : resolve()
          );
        });

        const res = await request(app)
          .put(`/api/collections/${collection.id}/items/reorder`)
          .set('Authorization', `Bearer ${user2Token}`)
          .send({ order: [book3.id, book1.id, book2.id] })
          .expect(200);

        expect(res.body.success).toBe(true);
      });
    });

    describe('Success', () => {
      it('reorders books correctly', async () => {
        // Reorder: book3, book1, book2
        await request(app)
          .put(`/api/collections/${collection.id}/items/reorder`)
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ order: [book3.id, book1.id, book2.id] })
          .expect(200);

        // Verify order
        const res = await request(app)
          .get(`/api/collections/${collection.id}`)
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body.books[0].id).toBe(book3.id);
        expect(res.body.books[1].id).toBe(book1.id);
        expect(res.body.books[2].id).toBe(book2.id);
      });

      it('handles empty order array', async () => {
        const res = await request(app)
          .put(`/api/collections/${collection.id}/items/reorder`)
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ order: [] })
          .expect(200);

        expect(res.body.success).toBe(true);
      });
    });
  });

  describe('Security', () => {
    it('cannot access other user private collection by ID guessing', async () => {
      const privateCollection = await createTestCollection(db, {
        user_id: user1.id,
        name: 'Secret Collection',
        is_public: 0
      });

      // User2 tries to access
      const res = await request(app)
        .get(`/api/collections/${privateCollection.id}`)
        .set('Authorization', `Bearer ${user2Token}`)
        .expect(404);

      expect(res.body.error).toBe('Collection not found');
    });

    it('cannot modify other user private collection', async () => {
      const privateCollection = await createTestCollection(db, {
        user_id: user1.id,
        name: 'Protected Collection',
        is_public: 0
      });

      // User2 tries to update
      const res = await request(app)
        .put(`/api/collections/${privateCollection.id}`)
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ name: 'Hacked' })
        .expect(404);

      expect(res.body.error).toBe('Collection not found or not owned by you');
    });

    it('SQL injection attempt in collection name is safe', async () => {
      const res = await request(app)
        .post('/api/collections')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ name: "'; DROP TABLE user_collections; --" })
        .expect(201);

      expect(res.body.name).toBe("'; DROP TABLE user_collections; --");

      // Verify table still exists
      const listRes = await request(app)
        .get('/api/collections')
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      expect(Array.isArray(listRes.body)).toBe(true);
    });

    it('XSS in collection name is stored safely', async () => {
      const res = await request(app)
        .post('/api/collections')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ name: '<script>alert("xss")</script>' })
        .expect(201);

      // Content is stored as-is (sanitization happens on display)
      expect(res.body.name).toBe('<script>alert("xss")</script>');
    });
  });
});
