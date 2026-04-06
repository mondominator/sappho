/**
 * Unit tests for the consolidated network-security helpers used to defend
 * against SSRF in cover downloads, OIDC discovery, and any other outbound
 * fetch with a user-supplied URL.
 */

// Mock dns.promises.lookup so we can drive the resolvePublicHost tests
// without making real network calls.
jest.mock('dns', () => {
  const actual = jest.requireActual('dns');
  return {
    ...actual,
    promises: {
      lookup: jest.fn(),
    },
  };
});

const dns = require('dns');
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

    test('::ffff: prefix with non-IPv4 suffix returns false (not unsafe)', () => {
      // Synthetic edge case: an IPv6 address that starts with ::ffff: but
      // whose tail isn't a valid v4 dotted-quad — should fall through to
      // the default `return false` rather than recursing.
      expect(isPrivateIp('::ffff:abcd')).toBe(false);
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
  beforeEach(() => {
    dns.promises.lookup.mockReset();
  });

  test('resolves a public IP literal as itself', async () => {
    const result = await resolvePublicHost('8.8.8.8');
    expect(result).toEqual(['8.8.8.8']);
    expect(dns.promises.lookup).not.toHaveBeenCalled();
  });

  test('rejects a private IP literal', async () => {
    await expect(resolvePublicHost('10.0.0.1')).rejects.toThrow(/private/);
  });

  test('rejects loopback IPv6', async () => {
    await expect(resolvePublicHost('::1')).rejects.toThrow(/private/);
  });

  test('resolves a hostname to its public addresses', async () => {
    dns.promises.lookup.mockResolvedValueOnce([
      { address: '93.184.216.34', family: 4 },
    ]);
    const result = await resolvePublicHost('example.com');
    expect(result).toEqual(['93.184.216.34']);
    expect(dns.promises.lookup).toHaveBeenCalledWith('example.com', { all: true, verbatim: true });
  });

  test('rejects a hostname that resolves to a private address', async () => {
    dns.promises.lookup.mockResolvedValueOnce([
      { address: '10.0.0.5', family: 4 },
    ]);
    await expect(resolvePublicHost('intranet.example.com')).rejects.toThrow(/private IP 10\.0\.0\.5/);
  });

  test('rejects a hostname when ANY resolved address is private (rebinding defence)', async () => {
    dns.promises.lookup.mockResolvedValueOnce([
      { address: '8.8.8.8', family: 4 },
      { address: '192.168.1.1', family: 4 },
    ]);
    await expect(resolvePublicHost('rebind.example.com')).rejects.toThrow(/private IP 192\.168\.1\.1/);
  });

  test('rejects when DNS lookup fails', async () => {
    dns.promises.lookup.mockRejectedValueOnce(new Error('ENOTFOUND'));
    await expect(resolvePublicHost('nonexistent.example.com')).rejects.toThrow(/DNS lookup failed.*ENOTFOUND/);
  });

  test('rejects when DNS returns no addresses', async () => {
    dns.promises.lookup.mockResolvedValueOnce([]);
    await expect(resolvePublicHost('empty.example.com')).rejects.toThrow(/no addresses/);
  });

  test('rejects when DNS returns null', async () => {
    dns.promises.lookup.mockResolvedValueOnce(null);
    await expect(resolvePublicHost('null.example.com')).rejects.toThrow(/no addresses/);
  });

  test('allowPrivate bypasses IP check', async () => {
    const result = await resolvePublicHost('127.0.0.1', { allowPrivate: true });
    expect(result).toEqual(['127.0.0.1']);
  });

  test('allowPrivate bypasses DNS check for hostnames', async () => {
    dns.promises.lookup.mockResolvedValueOnce([
      { address: '10.0.0.1', family: 4 },
    ]);
    const result = await resolvePublicHost('intranet.local', { allowPrivate: true });
    expect(result).toEqual(['10.0.0.1']);
  });
});
