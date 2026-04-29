import {unwrap} from '../src/sdk/unwrap';

describe('unwrap', () => {
  test('returns result on success', () => {
    expect(unwrap({success: true, result: 42}, 'op')).toBe(42);
  });

  test('throws with the SDK error message when present', () => {
    expect(() =>
      unwrap(
        {success: false, error: {code: 1, message: 'specific failure'}},
        'getThing',
      ),
    ).toThrow(/getThing failed: specific failure/);
  });

  test('throws with a fallback message when no SDK error is provided', () => {
    expect(() => unwrap({success: false}, 'getThing')).toThrow(
      /getThing failed: no error message/,
    );
  });

  test('throws when response itself is null', () => {
    expect(() => unwrap(null, 'getThing')).toThrow(
      /getThing failed: no error message/,
    );
  });

  test('throws when result is undefined even if success is true', () => {
    expect(() => unwrap({success: true}, 'getThing')).toThrow(
      /getThing failed: no error message/,
    );
  });
});
