/**
 * Unit tests for the consolidated network-security helpers used to defend
 * against SSRF in cover downloads, OIDC discovery, and any other outbound
 * fetch with a user-supplied URL.
 */

const {
  isPrivateIp,
  isPrivateHostname,
  resolvePublicHost,
} = require('../../server/utils/networkSecurity');

describe('isPrivateIp', () => {
  describe('IPv4', () => {
    test.each([
      ['10.0.0.1', true],
      ['10.255.255.255', true],
      ['127.0.0.1', true],
      ['0.0.0.0', true],
      ['169.254.169.254', true], // cloud metadata endpoint
      ['172.16.0.1', true],
      ['172.31.255.255', true],
      ['172.32.0.1', false], // outside private range
      ['172.15.0.1', false], // outside private range
      ['192.168.0.1', true],
      ['192.168.255.255', true],
      ['100.64.0.1', true], // CGNAT
      ['100.127.255.255', true],
      ['100.128.0.1', false], // outside CGNAT
      ['8.8.8.8', false],
      ['1.1.1.1', false],
      ['203.0.113.1', false],
    ])('%s → %s', (ip, expected) => {
      expect(isPrivateIp(ip)).toBe(expected);
    });
  });

  describe('IPv6', () => {
    test.each([
      ['::1', true],
      ['::', true],
      ['fe80::1', true],
      ['fe90::1', true],
      ['feaf::1', true],
      ['feb0::1', true],
      ['fc00::1', true],
      ['fd12:3456:789a::1', true],
      ['2001:db8::1', false],
      ['2606:4700:4700::1111', false], // cloudflare DNS
      ['::ffff:127.0.0.1', true], // IPv4-mapped private
      ['::ffff:8.8.8.8', false], // IPv4-mapped public
    ])('%s → %s', (ip, expected) => {
      expect(isPrivateIp(ip)).toBe(expected);
    });
  });

  test('null/empty/garbage is treated as unsafe', () => {
    expect(isPrivateIp(null)).toBe(true);
    expect(isPrivateIp('')).toBe(true);
    expect(isPrivateIp('not-an-ip')).toBe(true);
    expect(isPrivateIp(undefined)).toBe(true);
  });
});

describe('isPrivateHostname', () => {
  test('blocks localhost label and 0.0.0.0', () => {
    expect(isPrivateHostname('localhost')).toBe(true);
    expect(isPrivateHostname('LOCALHOST')).toBe(true);
    expect(isPrivateHostname('0.0.0.0')).toBe(true);
  });

  test('blocks private TLD suffixes', () => {
    expect(isPrivateHostname('myrouter.local')).toBe(true);
    expect(isPrivateHostname('intranet.internal')).toBe(true);
    expect(isPrivateHostname('app.localhost')).toBe(true);
  });

  test('defers to isPrivateIp for IP literals', () => {
    expect(isPrivateHostname('192.168.1.1')).toBe(true);
    expect(isPrivateHostname('::1')).toBe(true);
    expect(isPrivateHostname('8.8.8.8')).toBe(false);
  });

  test('allows public domains', () => {
    expect(isPrivateHostname('example.com')).toBe(false);
    expect(isPrivateHostname('images.amazon.com')).toBe(false);
    expect(isPrivateHostname('covers.openlibrary.org')).toBe(false);
  });

  test('null/empty is treated as unsafe', () => {
    expect(isPrivateHostname(null)).toBe(true);
    expect(isPrivateHostname('')).toBe(true);
  });
});

describe('resolvePublicHost', () => {
  // We can't reach DNS in unit tests reliably; instead, we exercise the
  // synchronous fast paths (IP literals + allowPrivate bypass) and trust
  // the integration tests for end-to-end DNS behaviour.

  test('resolves a public IP literal as itself', async () => {
    const result = await resolvePublicHost('8.8.8.8');
    expect(result).toEqual(['8.8.8.8']);
  });

  test('rejects a private IP literal', async () => {
    await expect(resolvePublicHost('10.0.0.1')).rejects.toThrow(/private/);
  });

  test('rejects loopback IPv6', async () => {
    await expect(resolvePublicHost('::1')).rejects.toThrow(/private/);
  });

  test('allowPrivate bypasses the check', async () => {
    const result = await resolvePublicHost('127.0.0.1', { allowPrivate: true });
    expect(result).toEqual(['127.0.0.1']);
  });
});
