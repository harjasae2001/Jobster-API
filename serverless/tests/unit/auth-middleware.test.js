'use strict';

const jwt = require('jsonwebtoken');
const { verifyToken } = require('../../src/lib/auth-middleware');

describe('verifyToken', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'unit-test-secret';
  });

  test('returns the authenticated identity for a valid bearer token', () => {
    const token = jwt.sign({ userId: 'user-1', name: 'Ada' }, process.env.JWT_SECRET);
    expect(verifyToken({ headers: { authorization: `Bearer ${token}` } })).toEqual({
      userId: 'user-1',
      name: 'Ada',
    });
  });

  test.each([
    {},
    { headers: {} },
    { headers: { authorization: 'Basic abc' } },
    { headers: { authorization: 'Bearer invalid' } },
  ])('rejects missing or invalid credentials', (event) => {
    expect(() => verifyToken(event)).toThrow('Authentication invalid');
  });
});
