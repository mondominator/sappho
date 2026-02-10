const { createQueryHelpers } = require('../../server/utils/queryHelpers');

describe('createQueryHelpers', () => {
  let mockDb;

  beforeEach(() => {
    mockDb = {
      get: jest.fn(),
      all: jest.fn(),
      run: jest.fn(),
    };
  });

  it('returns getAudiobookById and transformAudiobookRow functions', () => {
    const helpers = createQueryHelpers(mockDb);
    expect(typeof helpers.getAudiobookById).toBe('function');
    expect(typeof helpers.transformAudiobookRow).toBe('function');
  });

  describe('getAudiobookById', () => {
    it('fetches audiobook by id', async () => {
      const row = { id: 1, title: 'Test Book', author: 'Author' };
      mockDb.get.mockImplementation((sql, params, cb) => cb(null, row));

      const { getAudiobookById } = createQueryHelpers(mockDb);
      const result = await getAudiobookById(1);

      expect(result).toEqual(row);
      expect(mockDb.get).toHaveBeenCalledWith(
        'SELECT * FROM audiobooks WHERE id = ?',
        [1],
        expect.any(Function)
      );
    });

    it('returns null for non-existent id', async () => {
      mockDb.get.mockImplementation((sql, params, cb) => cb(null, null));

      const { getAudiobookById } = createQueryHelpers(mockDb);
      const result = await getAudiobookById(999);

      expect(result).toBeNull();
    });

    it('rejects on database error', async () => {
      mockDb.get.mockImplementation((sql, params, cb) => cb(new Error('DB error')));

      const { getAudiobookById } = createQueryHelpers(mockDb);
      await expect(getAudiobookById(1)).rejects.toThrow('DB error');
    });

    it('accepts string id', async () => {
      mockDb.get.mockImplementation((sql, params, cb) => cb(null, { id: 5 }));

      const { getAudiobookById } = createQueryHelpers(mockDb);
      await getAudiobookById('5');

      expect(mockDb.get).toHaveBeenCalledWith(
        'SELECT * FROM audiobooks WHERE id = ?',
        ['5'],
        expect.any(Function)
      );
    });
  });

  describe('transformAudiobookRow', () => {
    const baseRow = {
      id: 1,
      title: 'Test Book',
      author: 'Author',
      genre: 'Fiction',
      progress_position: 120,
      progress_completed: 0,
      progress_updated_at: '2024-01-01',
      is_favorite: 1,
      user_rating: 4,
      average_rating: 3.7777,
    };

    it('transforms a full row with all fields', () => {
      const { transformAudiobookRow } = createQueryHelpers(mockDb);
      const result = transformAudiobookRow(baseRow);

      expect(result).toEqual({
        id: 1,
        title: 'Test Book',
        author: 'Author',
        genre: 'Fiction',
        normalized_genre: 'Fiction',
        is_favorite: true,
        user_rating: 4,
        average_rating: 3.8,
        progress: {
          position: 120,
          completed: 0,
          updated_at: '2024-01-01',
        },
      });
    });

    it('strips progress fields from top-level', () => {
      const { transformAudiobookRow } = createQueryHelpers(mockDb);
      const result = transformAudiobookRow(baseRow);

      expect(result).not.toHaveProperty('progress_position');
      expect(result).not.toHaveProperty('progress_completed');
      expect(result).not.toHaveProperty('progress_updated_at');
    });

    it('returns null progress when progress_position is null', () => {
      const { transformAudiobookRow } = createQueryHelpers(mockDb);
      const row = { ...baseRow, progress_position: null, progress_completed: null, progress_updated_at: null };
      const result = transformAudiobookRow(row);

      expect(result.progress).toBeNull();
    });

    it('converts is_favorite to boolean', () => {
      const { transformAudiobookRow } = createQueryHelpers(mockDb);

      expect(transformAudiobookRow({ ...baseRow, is_favorite: 0 }).is_favorite).toBe(false);
      expect(transformAudiobookRow({ ...baseRow, is_favorite: 1 }).is_favorite).toBe(true);
      expect(transformAudiobookRow({ ...baseRow, is_favorite: undefined }).is_favorite).toBe(false);
    });

    it('returns null for missing user_rating', () => {
      const { transformAudiobookRow } = createQueryHelpers(mockDb);
      const result = transformAudiobookRow({ ...baseRow, user_rating: 0 });

      expect(result.user_rating).toBeNull();
    });

    it('returns null for missing average_rating', () => {
      const { transformAudiobookRow } = createQueryHelpers(mockDb);
      const result = transformAudiobookRow({ ...baseRow, average_rating: 0 });

      expect(result.average_rating).toBeNull();
    });

    it('rounds average_rating to one decimal place', () => {
      const { transformAudiobookRow } = createQueryHelpers(mockDb);
      const result = transformAudiobookRow({ ...baseRow, average_rating: 4.3333 });

      expect(result.average_rating).toBe(4.3);
    });

    it('uses normalizeGenres when provided', () => {
      const { transformAudiobookRow } = createQueryHelpers(mockDb);
      const normalizeGenres = jest.fn().mockReturnValue('Science Fiction');
      const result = transformAudiobookRow(baseRow, normalizeGenres);

      expect(normalizeGenres).toHaveBeenCalledWith('Fiction');
      expect(result.normalized_genre).toBe('Science Fiction');
    });

    it('falls back to raw genre when normalizeGenres is not provided', () => {
      const { transformAudiobookRow } = createQueryHelpers(mockDb);
      const result = transformAudiobookRow(baseRow);

      expect(result.normalized_genre).toBe('Fiction');
    });
  });
});
