/**
 * Unit tests for SSRF protection
 */

const { isPrivateHostname } = require('../../server/routes/audiobooks/helpers');
const { isPrivateIP } = require('../../server/services/coverDownloader');

describe('isPrivateHostname', () => {
  describe('blocks private/internal hostnames', () => {
    test('blocks null/empty hostname', () => {
      expect(isPrivateHostname(null)).toBe(true);
      expect(isPrivateHostname(undefined)).toBe(true);
      expect(isPrivateHostname('')).toBe(true);
    });

    test('blocks localhost', () => {
      expect(isPrivateHostname('localhost')).toBe(true);
      expect(isPrivateHostname('LOCALHOST')).toBe(true);
    });

    test('blocks loopback addresses', () => {
      expect(isPrivateHostname('127.0.0.1')).toBe(true);
      expect(isPrivateHostname('::1')).toBe(true);
    });

    test('blocks 0.0.0.0', () => {
      expect(isPrivateHostname('0.0.0.0')).toBe(true);
    });

    test('blocks 10.x.x.x range', () => {
      expect(isPrivateHostname('10.0.0.1')).toBe(true);
      expect(isPrivateHostname('10.255.255.255')).toBe(true);
    });

    test('blocks 192.168.x.x range', () => {
      expect(isPrivateHostname('192.168.0.1')).toBe(true);
      expect(isPrivateHostname('192.168.1.100')).toBe(true);
    });

    test('blocks 172.16-31.x.x range with proper octet check', () => {
      expect(isPrivateHostname('172.16.0.1')).toBe(true);
      expect(isPrivateHostname('172.20.0.1')).toBe(true);
      expect(isPrivateHostname('172.25.0.1')).toBe(true);
      expect(isPrivateHostname('172.31.255.255')).toBe(true);
    });

    test('allows 172.x outside 16-31 range', () => {
      expect(isPrivateHostname('172.15.0.1')).toBe(false);
      expect(isPrivateHostname('172.32.0.1')).toBe(false);
      expect(isPrivateHostname('172.100.0.1')).toBe(false);
    });

    test('blocks 169.254.x.x link-local / cloud metadata', () => {
      expect(isPrivateHostname('169.254.0.1')).toBe(true);
      expect(isPrivateHostname('169.254.169.254')).toBe(true);
    });

    test('blocks .local TLD', () => {
      expect(isPrivateHostname('myserver.local')).toBe(true);
    });

    test('blocks .internal TLD', () => {
      expect(isPrivateHostname('metadata.internal')).toBe(true);
      expect(isPrivateHostname('service.internal')).toBe(true);
    });

    test('blocks .localhost TLD', () => {
      expect(isPrivateHostname('anything.localhost')).toBe(true);
    });

    test('blocks IPv6 unique local (fc00::/7)', () => {
      expect(isPrivateHostname('fc00::1')).toBe(true);
      expect(isPrivateHostname('fd12:3456:789a::1')).toBe(true);
    });

    test('blocks IPv6 link-local (fe80::/10)', () => {
      expect(isPrivateHostname('fe80::1')).toBe(true);
      expect(isPrivateHostname('fe90::1')).toBe(true);
      expect(isPrivateHostname('feaf::1')).toBe(true);
    });
  });

  describe('allows public hostnames', () => {
    test('allows public domains', () => {
      expect(isPrivateHostname('example.com')).toBe(false);
      expect(isPrivateHostname('images.amazon.com')).toBe(false);
      expect(isPrivateHostname('covers.openlibrary.org')).toBe(false);
    });

    test('allows public IP addresses', () => {
      expect(isPrivateHostname('8.8.8.8')).toBe(false);
      expect(isPrivateHostname('1.1.1.1')).toBe(false);
      expect(isPrivateHostname('203.0.113.1')).toBe(false);
    });
  });
});

describe('isPrivateIP', () => {
  test('blocks null/empty IP', () => {
    expect(isPrivateIP(null)).toBe(true);
    expect(isPrivateIP(undefined)).toBe(true);
    expect(isPrivateIP('')).toBe(true);
  });

  test('blocks loopback', () => {
    expect(isPrivateIP('127.0.0.1')).toBe(true);
    expect(isPrivateIP('::1')).toBe(true);
  });

  test('blocks 0.0.0.0', () => {
    expect(isPrivateIP('0.0.0.0')).toBe(true);
  });

  test('blocks RFC1918 ranges', () => {
    expect(isPrivateIP('10.0.0.1')).toBe(true);
    expect(isPrivateIP('172.16.0.1')).toBe(true);
    expect(isPrivateIP('172.31.255.255')).toBe(true);
    expect(isPrivateIP('192.168.1.1')).toBe(true);
  });

  test('blocks link-local', () => {
    expect(isPrivateIP('169.254.169.254')).toBe(true);
  });

  test('blocks IPv6 private', () => {
    expect(isPrivateIP('fc00::1')).toBe(true);
    expect(isPrivateIP('fd12::1')).toBe(true);
    expect(isPrivateIP('fe80::1')).toBe(true);
  });

  test('allows public IPs', () => {
    expect(isPrivateIP('8.8.8.8')).toBe(false);
    expect(isPrivateIP('1.1.1.1')).toBe(false);
    expect(isPrivateIP('203.0.113.1')).toBe(false);
  });

  test('allows 172.x outside private range', () => {
    expect(isPrivateIP('172.15.0.1')).toBe(false);
    expect(isPrivateIP('172.32.0.1')).toBe(false);
  });
});
