jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({ on: jest.fn() })),
}));

describe('dbClient.resolveSslConfig', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('disables SSL entirely outside production', () => {
    process.env.NODE_ENV = 'development';
    process.env.DATABASE_URL = 'postgresql://user:pass@postgres.railway.internal:5432/db';
    const dbClient = require('../src/dbClient');
    expect(dbClient.resolveSslConfig()).toBe(false);
  });

  it('uses strict rejectUnauthorized:true with the CA when DATABASE_CA_CERT is set, regardless of host', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://user:pass@postgres.railway.internal:5432/db';
    process.env.DATABASE_CA_CERT = '-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----';
    const dbClient = require('../src/dbClient');
    expect(dbClient.resolveSslConfig()).toEqual({
      ca: process.env.DATABASE_CA_CERT,
      rejectUnauthorized: true,
    });
  });

  it('relaxes rejectUnauthorized ONLY for Railway internal-network hosts with no CA configured', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://user:pass@postgres.railway.internal:5432/db';
    delete process.env.DATABASE_CA_CERT;
    const dbClient = require('../src/dbClient');
    expect(dbClient.resolveSslConfig()).toEqual({ rejectUnauthorized: false });
  });

  it('stays strict (rejectUnauthorized:true) for a non-Railway-internal host with no CA configured', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://user:pass@some-external-host.example.com:5432/db';
    delete process.env.DATABASE_CA_CERT;
    const dbClient = require('../src/dbClient');
    expect(dbClient.resolveSslConfig()).toEqual({ rejectUnauthorized: true });
  });

  it('stays strict when DATABASE_URL is unset (no host info to identify as internal)', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_CA_CERT;
    const dbClient = require('../src/dbClient');
    expect(dbClient.resolveSslConfig()).toEqual({ rejectUnauthorized: true });
  });

  it('is not fooled by ".railway.internal" appearing in the path/userinfo of a non-Railway host (CodeRabbit finding)', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DATABASE_CA_CERT;
    const dbClient = require('../src/dbClient');

    process.env.DATABASE_URL = 'postgresql://user:pass@evil.com:5432/.railway.internal';
    expect(dbClient.resolveSslConfig()).toEqual({ rejectUnauthorized: true });

    process.env.DATABASE_URL = 'postgresql://user.railway.internal:pass@evil.com:5432/db';
    expect(dbClient.resolveSslConfig()).toEqual({ rejectUnauthorized: true });
  });

  it('matches the bare "railway.internal" host, not just subdomains', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DATABASE_CA_CERT;
    process.env.DATABASE_URL = 'postgresql://user:pass@railway.internal:5432/db';
    const dbClient = require('../src/dbClient');
    expect(dbClient.resolveSslConfig()).toEqual({ rejectUnauthorized: false });
  });

  it('does not match a host that merely ends with the same characters but is a different domain (e.g. notrailway.internal)', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DATABASE_CA_CERT;
    process.env.DATABASE_URL = 'postgresql://user:pass@notrailway.internal:5432/db';
    const dbClient = require('../src/dbClient');
    expect(dbClient.resolveSslConfig()).toEqual({ rejectUnauthorized: true });
  });

  it('falls back to strict when DATABASE_URL fails to parse as a URL', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DATABASE_CA_CERT;
    process.env.DATABASE_URL = 'not a valid url';
    const dbClient = require('../src/dbClient');
    expect(dbClient.resolveSslConfig()).toEqual({ rejectUnauthorized: true });
  });
});
