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
});
