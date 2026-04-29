import {tryAcquire, release, isBusy} from '../src/core/reentrancyGuard';

beforeEach(() => {
  release();
});

describe('reentrancyGuard', () => {
  test('first acquire succeeds', () => {
    expect(tryAcquire()).toBe(true);
    expect(isBusy()).toBe(true);
  });

  test('second acquire while busy fails', () => {
    expect(tryAcquire()).toBe(true);
    expect(tryAcquire()).toBe(false);
    expect(isBusy()).toBe(true);
  });

  test('release allows reacquire', () => {
    tryAcquire();
    release();
    expect(isBusy()).toBe(false);
    expect(tryAcquire()).toBe(true);
  });
});
