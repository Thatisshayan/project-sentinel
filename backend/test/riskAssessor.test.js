const { assessRisk, isMarketingOnly } = require('../src/riskAssessor');

describe('assessRisk', () => {
  test('returns Low for empty file list', () => {
    expect(assessRisk([])).toBe('Low');
    expect(assessRisk(null)).toBe('Low');
  });

  test('returns Low for marketing/image files only', () => {
    expect(assessRisk(['public/hero.png', 'assets/logo.svg'])).toBe('Low');
  });

  test('returns High for auth file changes', () => {
    expect(assessRisk(['src/auth.js', 'src/index.js'])).toBe('High');
  });

  test('returns High for .env file changes', () => {
    expect(assessRisk(['.env.example', 'src/app.js'])).toBe('High');
  });

  test('returns High for payment file changes', () => {
    expect(assessRisk(['src/payment.js'])).toBe('High');
  });

  test('returns Medium for normal code changes', () => {
    expect(assessRisk(['src/utils.js', 'src/helpers.js'])).toBe('Medium');
  });
});

describe('isMarketingOnly', () => {
  test('returns false for empty list', () => {
    expect(isMarketingOnly([])).toBe(false);
  });

  test('returns true when all files are images', () => {
    expect(isMarketingOnly(['hero.png', 'logo.jpg', 'icon.svg'])).toBe(true);
  });

  test('returns false when mix of code and images', () => {
    expect(isMarketingOnly(['hero.png', 'src/index.js'])).toBe(false);
  });

  test('returns true for files in /public path', () => {
    expect(isMarketingOnly(['public/banner.webp'])).toBe(true);
  });
});
