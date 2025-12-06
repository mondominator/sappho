/**
 * Docker Health Check Tests
 * Validates Dockerfile and docker-compose configuration
 */

const fs = require('fs');
const path = require('path');

describe('Docker Configuration', () => {
  const projectRoot = path.join(__dirname, '../..');
  const dockerfilePath = path.join(projectRoot, 'Dockerfile');
  const composePath = path.join(projectRoot, 'docker-compose.yml');

  describe('Dockerfile', () => {
    let dockerfileContent;

    beforeAll(() => {
      dockerfileContent = fs.readFileSync(dockerfilePath, 'utf8');
    });

    test('Dockerfile exists', () => {
      expect(fs.existsSync(dockerfilePath)).toBe(true);
    });

    test('uses Node.js Alpine base image', () => {
      expect(dockerfileContent).toMatch(/FROM node:\d+-alpine/);
    });

    test('sets production environment', () => {
      expect(dockerfileContent).toContain('NODE_ENV=production');
    });

    test('installs only production dependencies', () => {
      expect(dockerfileContent).toContain('npm install --only=production');
    });

    test('exposes application port', () => {
      expect(dockerfileContent).toMatch(/EXPOSE \d+/);
    });

    test('has proper CMD to start server', () => {
      expect(dockerfileContent).toMatch(/CMD.*node.*server\/index\.js/);
    });

    test('creates required data directories', () => {
      expect(dockerfileContent).toContain('/app/data/uploads');
      expect(dockerfileContent).toContain('/app/data/watch');
      expect(dockerfileContent).toContain('/app/data/audiobooks');
      expect(dockerfileContent).toContain('/app/data/covers');
    });

    test('includes ffmpeg for media processing', () => {
      expect(dockerfileContent).toContain('ffmpeg');
    });

    test('includes tone for metadata embedding', () => {
      expect(dockerfileContent).toContain('tone');
    });

    test('builds frontend in multi-stage build', () => {
      expect(dockerfileContent).toContain('frontend-builder');
      expect(dockerfileContent).toContain('npm run build');
    });
  });

  describe('docker-compose.yml', () => {
    let composeContent;

    beforeAll(() => {
      composeContent = fs.readFileSync(composePath, 'utf8');
    });

    test('docker-compose.yml exists', () => {
      expect(fs.existsSync(composePath)).toBe(true);
    });

    test('defines sappho service', () => {
      expect(composeContent).toContain('sappho:');
    });

    test('mounts data volume', () => {
      expect(composeContent).toMatch(/volumes:/);
      expect(composeContent).toContain('/app/data');
    });

    test('sets required environment variables', () => {
      expect(composeContent).toContain('NODE_ENV');
      expect(composeContent).toContain('JWT_SECRET');
      expect(composeContent).toContain('DATABASE_PATH');
    });

    test('exposes port mapping', () => {
      expect(composeContent).toMatch(/ports:/);
    });

    test('has restart policy', () => {
      expect(composeContent).toContain('restart:');
    });
  });

  describe('Required Files for Docker Build', () => {
    test('package.json exists', () => {
      expect(fs.existsSync(path.join(projectRoot, 'package.json'))).toBe(true);
    });

    test('server directory exists', () => {
      expect(fs.existsSync(path.join(projectRoot, 'server'))).toBe(true);
    });

    test('server/index.js exists', () => {
      expect(fs.existsSync(path.join(projectRoot, 'server', 'index.js'))).toBe(true);
    });

    test('client directory exists', () => {
      expect(fs.existsSync(path.join(projectRoot, 'client'))).toBe(true);
    });

    test('client/package.json exists', () => {
      expect(fs.existsSync(path.join(projectRoot, 'client', 'package.json'))).toBe(true);
    });
  });
});
