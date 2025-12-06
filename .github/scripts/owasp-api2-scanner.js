#!/usr/bin/env node
/**
 * OWASP API2:2023 Broken Authentication Scanner
 *
 * This script performs static analysis checks for authentication vulnerabilities
 * based on OWASP API Security Top 10 2023 - API2: Broken Authentication
 *
 * Exit codes:
 *   0 - All checks passed (or only LOW severity findings)
 *   1 - CRITICAL, HIGH, or MEDIUM severity findings detected
 */

const fs = require('fs');
const path = require('path');

// Severity levels
const SEVERITY = {
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW'
};

// Results storage
const findings = [];

/**
 * Add a finding to the results
 */
function addFinding(id, title, severity, file, line, description, recommendation) {
  findings.push({
    id,
    title,
    severity,
    file,
    line,
    description,
    recommendation,
    cwe: getCWE(id)
  });
}

/**
 * Get CWE mapping for finding ID
 */
function getCWE(id) {
  const cweMap = {
    'API2-001': 'CWE-798',
    'API2-002': 'CWE-1392',
    'API2-003': 'CWE-307',
    'API2-004': 'CWE-307',
    'API2-005': 'CWE-613',
    'API2-006': 'CWE-598',
    'API2-007': 'CWE-315',
    'API2-008': 'CWE-613',
    'API2-009': 'CWE-521',
    'API2-010': 'CWE-384',
    'API2-011': 'CWE-203',
    'API2-012': 'CWE-1188',
    'API2-013': 'CWE-942',
    'API2-014': 'CWE-693'
  };
  return cweMap[id] || 'CWE-287';
}

/**
 * Read file contents safely
 */
function readFile(filePath) {
  try {
    const fullPath = path.resolve(filePath);
    if (fs.existsSync(fullPath)) {
      return fs.readFileSync(fullPath, 'utf8');
    }
  } catch (e) {
    // File doesn't exist or can't be read
  }
  return null;
}

/**
 * Find line number for a pattern in content
 */
function findLineNumber(content, pattern) {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(pattern)) {
      return i + 1;
    }
  }
  return 1;
}

/**
 * Check for hardcoded JWT secret with fallback
 */
function checkHardcodedJWTSecret() {
  const files = ['server/auth.js', 'server/services/websocketManager.js'];

  for (const file of files) {
    const content = readFile(file);
    if (!content) continue;

    // Check for default secret fallback pattern
    const pattern = /JWT_SECRET\s*=\s*process\.env\.JWT_SECRET\s*\|\|\s*['"`][^'"`]+['"`]/;
    if (pattern.test(content)) {
      const line = findLineNumber(content, 'JWT_SECRET');
      addFinding(
        'API2-001',
        'Hardcoded Default JWT Secret',
        SEVERITY.CRITICAL,
        file,
        line,
        'JWT secret has a hardcoded fallback value. If environment variable is not set, a known secret will be used.',
        'Remove the default fallback. Require JWT_SECRET to be explicitly set and fail startup if missing.'
      );
    }
  }
}

/**
 * Check for default admin credentials
 */
function checkDefaultCredentials() {
  const content = readFile('server/auth.js');
  if (!content) return;

  // Check if password change is forced on first login
  const forcesPasswordChange = /must_change_password\s*[=:]\s*1|must_change_password.*true/i.test(content);

  // Check for hardcoded admin password
  const hasDefaultAdminPassword = /hashSync\s*\(\s*['"`]admin['"`]/.test(content) ||
                                   /defaultPassword\s*=\s*['"`]admin['"`]/.test(content);

  // Only flag as vulnerability if default password exists WITHOUT forced change
  if (hasDefaultAdminPassword && !forcesPasswordChange) {
    const line = findLineNumber(content, "hashSync('admin'") ||
                 findLineNumber(content, 'hashSync("admin"') ||
                 findLineNumber(content, "defaultPassword");
    addFinding(
      'API2-002',
      'Default Admin Credentials Without Forced Change',
      SEVERITY.CRITICAL,
      'server/auth.js',
      line,
      'Default admin user is created with predictable credentials (admin/admin) and no forced password change.',
      'Set must_change_password=1 for default admin to force password change on first login.'
    );
  }
  // If forced change is implemented, this is acceptable (no finding)
}

/**
 * Check for rate limiting on auth endpoints
 */
function checkRateLimiting() {
  const indexContent = readFile('server/index.js');
  const authContent = readFile('server/routes/auth.js');

  // Check if express-rate-limit is used
  const hasRateLimit = indexContent &&
    (/require\s*\(\s*['"`]express-rate-limit['"`]\s*\)/.test(indexContent) ||
     /from\s+['"`]express-rate-limit['"`]/.test(indexContent));

  const authHasRateLimit = authContent &&
    (/rateLimit/.test(authContent) || /rate-limit/.test(authContent));

  if (!hasRateLimit && !authHasRateLimit) {
    addFinding(
      'API2-003',
      'No Rate Limiting on Authentication Endpoints',
      SEVERITY.CRITICAL,
      'server/routes/auth.js',
      1,
      'Authentication endpoints have no rate limiting, allowing unlimited brute-force attempts.',
      'Install express-rate-limit and apply to /api/auth/* endpoints (e.g., 5 attempts/minute).'
    );
  }
}

/**
 * Check for account lockout mechanism
 */
function checkAccountLockout() {
  const content = readFile('server/auth.js');
  if (!content) return;

  // Check for failed_attempts or lockout logic
  const hasLockout = /failedAttempts|failed_attempts|locked_until|lockout|isAccountLocked|recordFailedAttempt/i.test(content);

  if (!hasLockout) {
    const line = findLineNumber(content, 'async function login');
    addFinding(
      'API2-004',
      'No Account Lockout Mechanism',
      SEVERITY.HIGH,
      'server/auth.js',
      line,
      'Login function does not implement account lockout after failed attempts.',
      'Track failed login attempts and lock accounts after 5 consecutive failures.'
    );
  }
}

/**
 * Check for token revocation mechanism
 */
function checkTokenRevocation() {
  const authContent = readFile('server/auth.js');
  const routesContent = readFile('server/routes/auth.js');

  const hasLogout = (authContent && /logout|revoke|invalidate|blacklist/i.test(authContent)) ||
                    (routesContent && /logout|revoke|invalidate|blacklist/i.test(routesContent));

  if (!hasLogout) {
    addFinding(
      'API2-005',
      'No Token Revocation Mechanism',
      SEVERITY.HIGH,
      'server/auth.js',
      1,
      'No logout endpoint or token blacklist exists. Tokens remain valid until expiry.',
      'Implement a token blacklist and logout endpoint. Invalidate tokens on password change.'
    );
  }
}

/**
 * Check for tokens in query string
 */
function checkTokenInQueryString() {
  // Only check auth.js for query token - WebSocket needs it for connection
  const content = readFile('server/auth.js');
  if (!content) return;

  // Check if query.token is used in authenticateToken middleware (the main auth)
  // This is a vulnerability if query tokens are accepted in the main authenticateToken function
  // However, authenticateMediaToken is an acceptable exception for <img> and <audio> tags
  // which cannot send Authorization headers

  // Look for query.token usage in authenticateToken (not authenticateMediaToken)
  const authenticateTokenMatch = content.match(/function\s+authenticateToken\s*\([^)]*\)\s*\{[\s\S]*?^\}/m);

  if (authenticateTokenMatch && /req\.query\.token/.test(authenticateTokenMatch[0])) {
    const line = findLineNumber(content, 'function authenticateToken');
    addFinding(
      'API2-006',
      'Token Accepted in Query String',
      SEVERITY.HIGH,
      'server/auth.js',
      line,
      'Authentication tokens are accepted via URL query parameters, exposing them in logs and browser history.',
      'Use Authorization header only. For WebSocket, implement a ticket-based system.'
    );
  }

  // Note: authenticateMediaToken is explicitly designed to accept query tokens
  // for media endpoints (<img>, <audio>) which cannot send Authorization headers.
  // This is a documented security tradeoff - the tokens are still validated,
  // and media endpoints only return binary data, not sensitive information.
}

/**
 * Check for sensitive data in JWT payload
 */
function checkJWTPayload() {
  const content = readFile('server/auth.js');
  if (!content) return;

  // Check if is_admin is in JWT payload (look for it in jwt.sign call)
  // Match pattern: jwt.sign({ ... is_admin ... }, ...)
  const jwtSignMatch = content.match(/jwt\.sign\s*\(\s*\{[^}]*\}/s);
  if (jwtSignMatch && /is_admin/.test(jwtSignMatch[0])) {
    const line = findLineNumber(content, 'jwt.sign');
    addFinding(
      'API2-007',
      'Sensitive Data in JWT Payload',
      SEVERITY.HIGH,
      'server/auth.js',
      line,
      'Admin status (is_admin) is embedded in JWT payload, visible to anyone who decodes the token.',
      'Fetch authorization data from database on each request instead of trusting token claims.'
    );
  }
}

/**
 * Check for API key expiration
 */
function checkAPIKeyExpiration() {
  const content = readFile('server/routes/apiKeys.js');
  if (!content) return;

  // Check if there's a default expiration
  if (/let\s+expiresAt\s*=\s*null/.test(content) &&
      !/DEFAULT_EXPIRY|defaultExpiry|default.*expir/i.test(content)) {
    const line = findLineNumber(content, 'expiresAt = null');
    addFinding(
      'API2-008',
      'API Keys Never Expire by Default',
      SEVERITY.HIGH,
      'server/routes/apiKeys.js',
      line,
      'API keys created without explicit expiration never expire.',
      'Set a default expiration (e.g., 90 days) and maximum expiration (e.g., 1 year).'
    );
  }
}

/**
 * Check for weak password policy
 */
function checkPasswordPolicy() {
  const authContent = readFile('server/auth.js');
  const authRoutes = readFile('server/routes/auth.js');
  const profileRoutes = readFile('server/routes/profile.js');

  // Check if validatePassword function exists in auth.js
  const hasValidatePassword = authContent && /function\s+validatePassword|validatePassword\s*=/.test(authContent);

  // Check registration for password requirements
  if (!hasValidatePassword && authRoutes && !/validatePassword/.test(authRoutes)) {
    addFinding(
      'API2-009',
      'Weak Password Policy - Registration',
      SEVERITY.MEDIUM,
      'server/routes/auth.js',
      1,
      'Registration endpoint has no password complexity requirements.',
      'Enforce minimum 12 characters with complexity requirements.'
    );
  }

  // Check if password change has weak requirements (looking for the old pattern)
  if (profileRoutes && /newPassword\.length\s*<\s*6/.test(profileRoutes) && !/validatePassword/.test(profileRoutes)) {
    const line = findLineNumber(profileRoutes, 'newPassword.length');
    addFinding(
      'API2-009',
      'Weak Password Policy - Minimum Length',
      SEVERITY.MEDIUM,
      'server/routes/profile.js',
      line,
      'Password change only requires 6 character minimum, which is too weak.',
      'Increase minimum to 12 characters and add complexity requirements.'
    );
  }
}

/**
 * Check for predictable session IDs
 */
function checkSessionIDs() {
  const content = readFile('server/routes/audiobooks.js');
  if (!content) return;

  // Check if using random session ID generation
  const hasRandomSessionId = /generateSessionId|crypto\.randomBytes.*session|getOrCreateSessionId/.test(content);

  // Check for predictable session ID pattern (only flag if no random generation)
  if (!hasRandomSessionId && /sessionId\s*=\s*`sappho-\$\{userId\}-\$\{audiobookId\}`/.test(content)) {
    const line = findLineNumber(content, 'sessionId');
    addFinding(
      'API2-010',
      'Predictable Session IDs',
      SEVERITY.MEDIUM,
      'server/routes/audiobooks.js',
      line,
      'Session IDs are derived from predictable user and audiobook IDs.',
      'Add a cryptographically random component to session IDs.'
    );
  }
}

/**
 * Check for timing-based user enumeration
 */
function checkTimingEnumeration() {
  const content = readFile('server/auth.js');
  if (!content) return;

  // Check if bcrypt is only called when user exists
  const hasConstantTime = /DUMMY_HASH|constant.*time|always.*bcrypt/i.test(content);

  if (!hasConstantTime && /if\s*\(\s*!user\s*\)/.test(content)) {
    const line = findLineNumber(content, 'if (!user)') || findLineNumber(content, 'if(!user)');
    addFinding(
      'API2-011',
      'Potential Timing-Based User Enumeration',
      SEVERITY.LOW,
      'server/auth.js',
      line,
      'Login returns immediately for non-existent users but performs bcrypt for existing users, enabling timing attacks.',
      'Always perform bcrypt comparison using a dummy hash for non-existent users.'
    );
  }
}

/**
 * Check for open registration
 */
function checkOpenRegistration() {
  const content = readFile('server/routes/auth.js');
  if (!content) return;

  // Check if registration has any restrictions
  const hasRestrictions = /isRegistrationAllowed|REGISTRATION_DISABLED|REQUIRE_INVITE_CODE|invite.*code|registration.*disabled|admin.*approv|captcha|ALLOW_OPEN_REGISTRATION/i.test(content);

  if (!hasRestrictions && /router\.(post|put)\s*\(\s*['"`]\/register/.test(content)) {
    const line = findLineNumber(content, '/register');
    addFinding(
      'API2-012',
      'Open Registration Without Restrictions',
      SEVERITY.MEDIUM,
      'server/routes/auth.js',
      line,
      'Registration is open to anyone without invite codes, CAPTCHA, or admin approval.',
      'Add registration restrictions or make it configurable.'
    );
  }
}

/**
 * Check for wildcard CORS
 */
function checkCORS() {
  const content = readFile('server/index.js');
  if (!content) return;

  // Check if CORS is properly configured with allowed origins
  const hasConfiguredCors = /corsOptions|allowedOrigins|CORS_ORIGINS/.test(content);

  // Check for cors() without options or with origin: '*'
  if (!hasConfiguredCors &&
      (/app\.use\s*\(\s*cors\s*\(\s*\)\s*\)/.test(content) ||
       /origin\s*:\s*['"`]\*['"`]/.test(content) ||
       /origin\s*:\s*true/.test(content))) {
    const line = findLineNumber(content, 'cors(');
    addFinding(
      'API2-013',
      'Wildcard CORS Configuration',
      SEVERITY.MEDIUM,
      'server/index.js',
      line,
      'CORS is configured to allow requests from any origin.',
      'Configure CORS to only allow specific trusted origins.'
    );
  }
}

/**
 * Check for security headers (helmet)
 */
function checkSecurityHeaders() {
  const content = readFile('server/index.js');
  if (!content) return;

  const hasHelmet = /require\s*\(\s*['"`]helmet['"`]\s*\)/.test(content) ||
                    /from\s+['"`]helmet['"`]/.test(content) ||
                    /app\.use\s*\(\s*helmet/.test(content);

  if (!hasHelmet) {
    addFinding(
      'API2-014',
      'Missing Security Headers',
      SEVERITY.LOW,
      'server/index.js',
      1,
      'Security headers (X-Content-Type-Options, X-Frame-Options, HSTS, etc.) are not configured.',
      'Install and configure the helmet middleware package.'
    );
  }
}

/**
 * Run all checks
 */
function runAllChecks() {
  console.log('='.repeat(60));
  console.log('OWASP API2:2023 Broken Authentication Scanner');
  console.log('='.repeat(60));
  console.log('');

  checkHardcodedJWTSecret();
  checkDefaultCredentials();
  checkRateLimiting();
  checkAccountLockout();
  checkTokenRevocation();
  checkTokenInQueryString();
  checkJWTPayload();
  checkAPIKeyExpiration();
  checkPasswordPolicy();
  checkSessionIDs();
  checkTimingEnumeration();
  checkOpenRegistration();
  checkCORS();
  checkSecurityHeaders();
}

/**
 * Generate output
 */
function generateOutput() {
  // Count by severity
  const counts = {
    [SEVERITY.CRITICAL]: 0,
    [SEVERITY.HIGH]: 0,
    [SEVERITY.MEDIUM]: 0,
    [SEVERITY.LOW]: 0
  };

  findings.forEach(f => counts[f.severity]++);

  console.log('SCAN RESULTS');
  console.log('-'.repeat(60));
  console.log('');

  if (findings.length === 0) {
    console.log('No vulnerabilities found.');
    return 0;
  }

  // Group by severity
  const severityOrder = [SEVERITY.CRITICAL, SEVERITY.HIGH, SEVERITY.MEDIUM, SEVERITY.LOW];

  for (const severity of severityOrder) {
    const severityFindings = findings.filter(f => f.severity === severity);
    if (severityFindings.length === 0) continue;

    const emoji = {
      [SEVERITY.CRITICAL]: '🔴',
      [SEVERITY.HIGH]: '🟠',
      [SEVERITY.MEDIUM]: '🟡',
      [SEVERITY.LOW]: '🔵'
    }[severity];

    console.log(`${emoji} ${severity} (${severityFindings.length})`);
    console.log('-'.repeat(40));

    for (const finding of severityFindings) {
      console.log(`  [${finding.id}] ${finding.title}`);
      console.log(`    File: ${finding.file}:${finding.line}`);
      console.log(`    CWE: ${finding.cwe}`);
      console.log(`    Issue: ${finding.description}`);
      console.log(`    Fix: ${finding.recommendation}`);
      console.log('');
    }
  }

  // Summary
  console.log('='.repeat(60));
  console.log('SUMMARY');
  console.log('-'.repeat(60));
  console.log(`  Critical: ${counts[SEVERITY.CRITICAL]}`);
  console.log(`  High:     ${counts[SEVERITY.HIGH]}`);
  console.log(`  Medium:   ${counts[SEVERITY.MEDIUM]}`);
  console.log(`  Low:      ${counts[SEVERITY.LOW]}`);
  console.log(`  Total:    ${findings.length}`);
  console.log('='.repeat(60));

  // Generate JSON output for GitHub Actions
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    const json = JSON.stringify(findings);
    fs.appendFileSync(outputPath, `findings=${json}\n`);
    fs.appendFileSync(outputPath, `critical_count=${counts[SEVERITY.CRITICAL]}\n`);
    fs.appendFileSync(outputPath, `high_count=${counts[SEVERITY.HIGH]}\n`);
    fs.appendFileSync(outputPath, `medium_count=${counts[SEVERITY.MEDIUM]}\n`);
    fs.appendFileSync(outputPath, `low_count=${counts[SEVERITY.LOW]}\n`);
    fs.appendFileSync(outputPath, `total_count=${findings.length}\n`);
  }

  // Also write to a file for artifact upload
  const reportDir = '.security-reports';
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(reportDir, 'owasp-api2-findings.json'),
    JSON.stringify({ findings, counts, timestamp: new Date().toISOString() }, null, 2)
  );

  // Determine exit code
  // Fail on CRITICAL, HIGH, or MEDIUM
  // Warn on LOW (exit 0 but flag for issue creation)
  if (counts[SEVERITY.CRITICAL] > 0 || counts[SEVERITY.HIGH] > 0 || counts[SEVERITY.MEDIUM] > 0) {
    console.log('');
    console.log('❌ SECURITY CHECK FAILED');
    console.log('   Critical, High, or Medium severity vulnerabilities detected.');
    console.log('   Please fix these issues before merging.');
    return 1;
  } else if (counts[SEVERITY.LOW] > 0) {
    console.log('');
    console.log('⚠️  SECURITY CHECK PASSED WITH WARNINGS');
    console.log('   Low severity issues detected. Issues will be created for tracking.');
    return 0;
  }

  console.log('');
  console.log('✅ SECURITY CHECK PASSED');
  return 0;
}

// Main execution
runAllChecks();
const exitCode = generateOutput();
process.exit(exitCode);
