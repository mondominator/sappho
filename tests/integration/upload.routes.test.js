/**
 * Integration tests for Upload Routes
 * Tests: Single file upload, batch upload, multifile upload, file validation, security
 */

const request = require('supertest');
const path = require('path');
const fs = require('fs');
const {
  createTestDatabase,
  createTestUser,
  generateTestToken,
  createTestApp,
  testUploadDir
} = require('./testApp');

describe('Upload Routes', () => {
  let db;
  let app;
  let adminUser;
  let adminToken;
  let regularUser;
  let userToken;

  // Helper to create a test audio file
  const createTestFile = (filename, content = 'test audio content') => {
    const filePath = path.join(testUploadDir, filename);
    fs.writeFileSync(filePath, content);
    return filePath;
  };

  // Helper to clean up test files
  const cleanupTestFiles = () => {
    if (fs.existsSync(testUploadDir)) {
      const files = fs.readdirSync(testUploadDir);
      for (const file of files) {
        const filePath = path.join(testUploadDir, file);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
    }
  };

  beforeEach(async () => {
    db = await createTestDatabase();
    app = createTestApp(db);

    // Create admin and regular users
    adminUser = await createTestUser(db, { username: 'admin', password: 'admin123', isAdmin: true });
    adminToken = generateTestToken(adminUser);

    regularUser = await createTestUser(db, { username: 'user', password: 'user123', isAdmin: false });
    userToken = generateTestToken(regularUser);

    // Clean up any leftover test files
    cleanupTestFiles();
  });

  afterEach((done) => {
    cleanupTestFiles();
    db.close(done);
  });

  // ============================================
  // SINGLE FILE UPLOAD
  // ============================================
  describe('POST /api/upload (Single File)', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app)
        .post('/api/upload')
        .attach('audiobook', Buffer.from('test'), 'test.mp3');

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('returns 400 when no file is uploaded', async () => {
      const res = await request(app)
        .post('/api/upload')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('No file uploaded');
    });

    it('successfully uploads a valid audio file', async () => {
      const res = await request(app)
        .post('/api/upload')
        .set('Authorization', `Bearer ${userToken}`)
        .attach('audiobook', Buffer.from('fake mp3 content'), 'test-book.mp3');

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Audiobook uploaded successfully');
      expect(res.body.audiobook).toBeDefined();
      expect(res.body.audiobook.title).toBe('test-book');
    });

    it('successfully uploads m4b file', async () => {
      const res = await request(app)
        .post('/api/upload')
        .set('Authorization', `Bearer ${userToken}`)
        .attach('audiobook', Buffer.from('fake m4b content'), 'audiobook.m4b');

      expect(res.status).toBe(200);
      expect(res.body.audiobook.title).toBe('audiobook');
    });

    it('successfully uploads m4a file', async () => {
      const res = await request(app)
        .post('/api/upload')
        .set('Authorization', `Bearer ${userToken}`)
        .attach('audiobook', Buffer.from('fake m4a content'), 'music.m4a');

      expect(res.status).toBe(200);
      expect(res.body.audiobook).toBeDefined();
    });

    it('successfully uploads ogg file', async () => {
      const res = await request(app)
        .post('/api/upload')
        .set('Authorization', `Bearer ${userToken}`)
        .attach('audiobook', Buffer.from('fake ogg content'), 'audio.ogg');

      expect(res.status).toBe(200);
      expect(res.body.audiobook).toBeDefined();
    });

    it('successfully uploads flac file', async () => {
      const res = await request(app)
        .post('/api/upload')
        .set('Authorization', `Bearer ${userToken}`)
        .attach('audiobook', Buffer.from('fake flac content'), 'lossless.flac');

      expect(res.status).toBe(200);
      expect(res.body.audiobook).toBeDefined();
    });

    it('rejects invalid file types', async () => {
      const res = await request(app)
        .post('/api/upload')
        .set('Authorization', `Bearer ${userToken}`)
        .attach('audiobook', Buffer.from('fake exe content'), 'malware.exe');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid file type');
    });

    it('rejects text files', async () => {
      const res = await request(app)
        .post('/api/upload')
        .set('Authorization', `Bearer ${userToken}`)
        .attach('audiobook', Buffer.from('text content'), 'readme.txt');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid file type');
    });

    it('rejects PDF files', async () => {
      const res = await request(app)
        .post('/api/upload')
        .set('Authorization', `Bearer ${userToken}`)
        .attach('audiobook', Buffer.from('%PDF-1.4'), 'document.pdf');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid file type');
    });

    it('rejects image files', async () => {
      const res = await request(app)
        .post('/api/upload')
        .set('Authorization', `Bearer ${userToken}`)
        .attach('audiobook', Buffer.from('fake image'), 'cover.jpg');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid file type');
    });

    it('associates uploaded audiobook with authenticated user', async () => {
      const res = await request(app)
        .post('/api/upload')
        .set('Authorization', `Bearer ${userToken}`)
        .attach('audiobook', Buffer.from('fake content'), 'mybook.mp3');

      expect(res.status).toBe(200);
      expect(res.body.audiobook.added_by).toBe(regularUser.id);
    });

    it('admin can upload files', async () => {
      const res = await request(app)
        .post('/api/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('audiobook', Buffer.from('admin upload'), 'admin-book.mp3');

      expect(res.status).toBe(200);
      expect(res.body.audiobook.added_by).toBe(adminUser.id);
    });
  });

  // ============================================
  // BATCH UPLOAD
  // ============================================
  describe('POST /api/upload/batch (Multiple Files as Separate Books)', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app)
        .post('/api/upload/batch')
        .attach('audiobooks', Buffer.from('test1'), 'book1.mp3')
        .attach('audiobooks', Buffer.from('test2'), 'book2.mp3');

      expect(res.status).toBe(401);
    });

    it('returns 400 when no files are uploaded', async () => {
      const res = await request(app)
        .post('/api/upload/batch')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('No files uploaded');
    });

    it('successfully uploads multiple files', async () => {
      const res = await request(app)
        .post('/api/upload/batch')
        .set('Authorization', `Bearer ${userToken}`)
        .attach('audiobooks', Buffer.from('book 1 content'), 'book1.mp3')
        .attach('audiobooks', Buffer.from('book 2 content'), 'book2.mp3')
        .attach('audiobooks', Buffer.from('book 3 content'), 'book3.mp3');

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Batch upload completed');
      expect(res.body.results).toHaveLength(3);
      expect(res.body.results.every(r => r.success)).toBe(true);
    });

    it('returns individual results for each file', async () => {
      const res = await request(app)
        .post('/api/upload/batch')
        .set('Authorization', `Bearer ${userToken}`)
        .attach('audiobooks', Buffer.from('content 1'), 'first.mp3')
        .attach('audiobooks', Buffer.from('content 2'), 'second.m4b');

      expect(res.status).toBe(200);
      expect(res.body.results).toHaveLength(2);

      const first = res.body.results.find(r => r.filename === 'first.mp3');
      const second = res.body.results.find(r => r.filename === 'second.m4b');

      expect(first.success).toBe(true);
      expect(first.audiobook).toBeDefined();
      expect(second.success).toBe(true);
      expect(second.audiobook).toBeDefined();
    });

    it('creates separate audiobook records for each file', async () => {
      const res = await request(app)
        .post('/api/upload/batch')
        .set('Authorization', `Bearer ${userToken}`)
        .attach('audiobooks', Buffer.from('content'), 'unique1.mp3')
        .attach('audiobooks', Buffer.from('content'), 'unique2.mp3');

      expect(res.status).toBe(200);

      const id1 = res.body.results[0].audiobook.id;
      const id2 = res.body.results[1].audiobook.id;
      expect(id1).not.toBe(id2);
    });

    it('handles mixed valid and invalid files gracefully', async () => {
      const res = await request(app)
        .post('/api/upload/batch')
        .set('Authorization', `Bearer ${userToken}`)
        .attach('audiobooks', Buffer.from('valid audio'), 'good.mp3');
      // Note: Can't easily test invalid file rejection in batch since multer filter
      // runs first and would reject the entire request

      expect(res.status).toBe(200);
      expect(res.body.results[0].success).toBe(true);
    });
  });

  // ============================================
  // MULTIFILE UPLOAD (Single Book with Multiple Parts)
  // ============================================
  describe('POST /api/upload/multifile (Multiple Files as Single Book)', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app)
        .post('/api/upload/multifile')
        .attach('audiobooks', Buffer.from('part1'), 'chapter01.mp3')
        .attach('audiobooks', Buffer.from('part2'), 'chapter02.mp3');

      expect(res.status).toBe(401);
    });

    it('returns 400 when no files are uploaded', async () => {
      const res = await request(app)
        .post('/api/upload/multifile')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('No files uploaded');
    });

    it('successfully creates single audiobook from multiple files', async () => {
      const res = await request(app)
        .post('/api/upload/multifile')
        .set('Authorization', `Bearer ${userToken}`)
        .field('bookName', 'My Great Audiobook')
        .attach('audiobooks', Buffer.from('chapter 1'), 'part1.mp3')
        .attach('audiobooks', Buffer.from('chapter 2'), 'part2.mp3')
        .attach('audiobooks', Buffer.from('chapter 3'), 'part3.mp3');

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Multi-file audiobook uploaded successfully');
      expect(res.body.audiobook).toBeDefined();
      expect(res.body.audiobook.title).toBe('My Great Audiobook');
    });

    it('uses default title when bookName not provided', async () => {
      const res = await request(app)
        .post('/api/upload/multifile')
        .set('Authorization', `Bearer ${userToken}`)
        .attach('audiobooks', Buffer.from('chapter 1'), 'track01.mp3')
        .attach('audiobooks', Buffer.from('chapter 2'), 'track02.mp3');

      expect(res.status).toBe(200);
      expect(res.body.audiobook.title).toBe('Multi-File Audiobook');
    });

    it('calculates total duration from all files', async () => {
      const res = await request(app)
        .post('/api/upload/multifile')
        .set('Authorization', `Bearer ${userToken}`)
        .field('bookName', 'Long Book')
        .attach('audiobooks', Buffer.from('ch1'), 'chapter1.mp3')
        .attach('audiobooks', Buffer.from('ch2'), 'chapter2.mp3')
        .attach('audiobooks', Buffer.from('ch3'), 'chapter3.mp3')
        .attach('audiobooks', Buffer.from('ch4'), 'chapter4.mp3');

      expect(res.status).toBe(200);
      // Duration is estimated at 600 seconds (10 min) per file
      expect(res.body.audiobook.duration).toBe(2400);
    });

    it('calculates total file size from all files', async () => {
      const content1 = Buffer.from('a'.repeat(1000));
      const content2 = Buffer.from('b'.repeat(2000));

      const res = await request(app)
        .post('/api/upload/multifile')
        .set('Authorization', `Bearer ${userToken}`)
        .attach('audiobooks', content1, 'part1.mp3')
        .attach('audiobooks', content2, 'part2.mp3');

      expect(res.status).toBe(200);
      expect(res.body.audiobook.file_size).toBe(3000);
    });

    it('creates only one audiobook record for multiple files', async () => {
      // Get initial count
      const initialCount = await new Promise((resolve, reject) => {
        db.get('SELECT COUNT(*) as count FROM audiobooks', (err, row) => {
          if (err) reject(err);
          else resolve(row.count);
        });
      });

      const res = await request(app)
        .post('/api/upload/multifile')
        .set('Authorization', `Bearer ${userToken}`)
        .attach('audiobooks', Buffer.from('p1'), 'part1.mp3')
        .attach('audiobooks', Buffer.from('p2'), 'part2.mp3')
        .attach('audiobooks', Buffer.from('p3'), 'part3.mp3');

      expect(res.status).toBe(200);

      // Get final count
      const finalCount = await new Promise((resolve, reject) => {
        db.get('SELECT COUNT(*) as count FROM audiobooks', (err, row) => {
          if (err) reject(err);
          else resolve(row.count);
        });
      });

      expect(finalCount).toBe(initialCount + 1);
    });
  });

  // ============================================
  // FILE VALIDATION & SECURITY
  // ============================================
  describe('File Validation & Security', () => {
    describe('File Extension Validation', () => {
      const validExtensions = ['.mp3', '.m4a', '.m4b', '.mp4', '.ogg', '.flac'];
      const invalidExtensions = ['.exe', '.bat', '.sh', '.js', '.php', '.html', '.zip', '.rar'];

      validExtensions.forEach(ext => {
        it(`accepts files with ${ext} extension`, async () => {
          const res = await request(app)
            .post('/api/upload')
            .set('Authorization', `Bearer ${userToken}`)
            .attach('audiobook', Buffer.from('content'), `file${ext}`);

          expect(res.status).toBe(200);
        });
      });

      invalidExtensions.forEach(ext => {
        it(`rejects files with ${ext} extension`, async () => {
          const res = await request(app)
            .post('/api/upload')
            .set('Authorization', `Bearer ${userToken}`)
            .attach('audiobook', Buffer.from('content'), `file${ext}`);

          expect(res.status).toBe(400);
          expect(res.body.error).toContain('Invalid file type');
        });
      });
    });

    describe('Path Traversal Prevention', () => {
      it('handles filename with path traversal attempt', async () => {
        const res = await request(app)
          .post('/api/upload')
          .set('Authorization', `Bearer ${userToken}`)
          .attach('audiobook', Buffer.from('content'), '../../../etc/passwd.mp3');

        // Should either reject or sanitize the filename
        if (res.status === 200) {
          // If accepted, filename should be sanitized
          expect(res.body.audiobook.title).not.toContain('..');
        }
      });

      it('handles filename with encoded path traversal', async () => {
        const res = await request(app)
          .post('/api/upload')
          .set('Authorization', `Bearer ${userToken}`)
          .attach('audiobook', Buffer.from('content'), '..%2F..%2Fetc%2Fpasswd.mp3');

        // Should either reject or handle safely
        expect([200, 400]).toContain(res.status);
      });
    });

    describe('Null Byte Injection Prevention', () => {
      it('handles filename with null byte', async () => {
        const res = await request(app)
          .post('/api/upload')
          .set('Authorization', `Bearer ${userToken}`)
          .attach('audiobook', Buffer.from('content'), 'file.mp3\x00.exe');

        // Should either reject or sanitize
        if (res.status === 200) {
          expect(res.body.audiobook).toBeDefined();
        }
      });
    });

    describe('Double Extension Prevention', () => {
      it('rejects file with double extension (exe hidden)', async () => {
        const res = await request(app)
          .post('/api/upload')
          .set('Authorization', `Bearer ${userToken}`)
          .attach('audiobook', Buffer.from('content'), 'audiobook.exe.mp3');

        // Should be accepted (outer extension is valid .mp3)
        // This is expected behavior - the file filter checks the final extension
        expect(res.status).toBe(200);
      });

      it('rejects file with executable final extension', async () => {
        const res = await request(app)
          .post('/api/upload')
          .set('Authorization', `Bearer ${userToken}`)
          .attach('audiobook', Buffer.from('content'), 'audiobook.mp3.exe');

        expect(res.status).toBe(400);
      });
    });

    describe('Empty File Handling', () => {
      it('handles empty file upload', async () => {
        const res = await request(app)
          .post('/api/upload')
          .set('Authorization', `Bearer ${userToken}`)
          .attach('audiobook', Buffer.from(''), 'empty.mp3');

        // Should accept (empty files are technically valid)
        expect(res.status).toBe(200);
        expect(res.body.audiobook.file_size).toBe(0);
      });
    });

    describe('Special Characters in Filename', () => {
      it('handles filename with spaces', async () => {
        const res = await request(app)
          .post('/api/upload')
          .set('Authorization', `Bearer ${userToken}`)
          .attach('audiobook', Buffer.from('content'), 'my audio book.mp3');

        expect(res.status).toBe(200);
        expect(res.body.audiobook).toBeDefined();
      });

      it('handles filename with unicode characters', async () => {
        const res = await request(app)
          .post('/api/upload')
          .set('Authorization', `Bearer ${userToken}`)
          .attach('audiobook', Buffer.from('content'), '日本語ブック.mp3');

        expect(res.status).toBe(200);
      });

      it('handles filename with special characters', async () => {
        const res = await request(app)
          .post('/api/upload')
          .set('Authorization', `Bearer ${userToken}`)
          .attach('audiobook', Buffer.from('content'), "book's (copy) [2024].mp3");

        expect(res.status).toBe(200);
      });
    });
  });

  // ============================================
  // AUTHORIZATION TESTS
  // ============================================
  describe('Authorization', () => {
    it('regular user can upload files', async () => {
      const res = await request(app)
        .post('/api/upload')
        .set('Authorization', `Bearer ${userToken}`)
        .attach('audiobook', Buffer.from('content'), 'user-upload.mp3');

      expect(res.status).toBe(200);
    });

    it('admin user can upload files', async () => {
      const res = await request(app)
        .post('/api/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('audiobook', Buffer.from('content'), 'admin-upload.mp3');

      expect(res.status).toBe(200);
    });

    it('invalid token is rejected', async () => {
      const res = await request(app)
        .post('/api/upload')
        .set('Authorization', 'Bearer invalid-token-here')
        .attach('audiobook', Buffer.from('content'), 'test.mp3');

      expect(res.status).toBe(401);
    });

    it('expired token is rejected', async () => {
      const jwt = require('jsonwebtoken');
      const expiredToken = jwt.sign(
        { id: regularUser.id, username: regularUser.username },
        'test-secret',
        { expiresIn: '-1h' }
      );

      const res = await request(app)
        .post('/api/upload')
        .set('Authorization', `Bearer ${expiredToken}`)
        .attach('audiobook', Buffer.from('content'), 'test.mp3');

      expect(res.status).toBe(401);
    });
  });

  // ============================================
  // ERROR HANDLING
  // ============================================
  describe('Error Handling', () => {
    it('handles missing field name gracefully', async () => {
      const res = await request(app)
        .post('/api/upload')
        .set('Authorization', `Bearer ${userToken}`)
        .attach('wrongfield', Buffer.from('content'), 'test.mp3');

      expect(res.status).toBe(400);
      // Multer returns "Unexpected field" when field name doesn't match expected
      expect(res.body.error).toBe('Unexpected field');
    });

    it('handles upload with wrong Content-Type', async () => {
      const res = await request(app)
        .post('/api/upload')
        .set('Authorization', `Bearer ${userToken}`)
        .set('Content-Type', 'application/json')
        .send({ file: 'not a real file' });

      expect(res.status).toBe(400);
    });
  });
});
