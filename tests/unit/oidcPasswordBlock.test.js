const fs = require('fs');
const path = require('path');

describe('OIDC password protection', () => {
  test('profile.js blocks password changes for OIDC users', () => {
    const profileSource = fs.readFileSync(
      path.join(__dirname, '../../server/routes/profile.js'), 'utf8'
    );
    expect(profileSource).toContain("auth_method === 'oidc'");
    expect(profileSource).toContain('Password changes are not available for SSO accounts');
  });

  test('verifyToken includes auth_method in user query and req.user', () => {
    const authSource = fs.readFileSync(
      path.join(__dirname, '../../server/auth.js'), 'utf8'
    );
    // Verify the SELECT query includes auth_method
    expect(authSource).toContain('must_change_password, auth_method FROM users');
    // Verify auth_method is set on req.user
    expect(authSource).toContain("auth_method: user.auth_method || 'local'");
  });

  test('GET /users query includes auth_method', () => {
    const usersSource = fs.readFileSync(
      path.join(__dirname, '../../server/routes/users.js'), 'utf8'
    );
    expect(usersSource).toContain('auth_method, created_at FROM users ORDER BY');
  });

  test('GET /users/:id/details query includes auth_method', () => {
    const usersSource = fs.readFileSync(
      path.join(__dirname, '../../server/routes/users.js'), 'utf8'
    );
    expect(usersSource).toContain('disabled_reason, auth_method, created_at FROM users WHERE id');
  });

  test('UsersSettings.jsx displays SSO badge for OIDC users', () => {
    const usersSettingsSource = fs.readFileSync(
      path.join(__dirname, '../../client/src/components/settings/UsersSettings.jsx'), 'utf8'
    );
    expect(usersSettingsSource).toContain("auth_method === 'oidc'");
    expect(usersSettingsSource).toContain('auth-badge sso');
    expect(usersSettingsSource).toContain('>SSO<');
  });
});
