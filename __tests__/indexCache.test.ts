import {
  buildEnvelope,
  cacheKeyForSource,
  decodeIndexCache,
  encodeIndexCache,
  fingerprintBytes,
  hydrateIndex,
  type CachedIndexEnvelope,
} from '../src/core/dict/indexCache';
import type {IfoMeta} from '../src/core/dict/stardict/parseIfo';

const fakeMeta = (): IfoMeta => ({
  bookname: 'Test',
  wordcount: 3,
  idxoffsetbits: 32,
  sametypesequence: 'm',
});

describe('fingerprintBytes', () => {
  test('returns "absent" for undefined', () => {
    expect(fingerprintBytes(undefined)).toBe('absent');
  });

  test('returns "empty" for a zero-length buffer', () => {
    expect(fingerprintBytes(new Uint8Array(0))).toBe('empty');
  });

  test('encodes the full buffer when shorter than 2 × HEAD_TAIL_BYTES', () => {
    const bytes = new Uint8Array([0x01, 0x02, 0x03]);
    const fp = fingerprintBytes(bytes);
    expect(fp).toBe('3:010203');
  });

  test('encodes head + tail for buffers larger than 2 × HEAD_TAIL_BYTES', () => {
    const big = new Uint8Array(200);
    for (let i = 0; i < big.length; i++) {
      // eslint-disable-next-line no-bitwise
      big[i] = i & 0xff;
    }
    const fp = fingerprintBytes(big);
    // Length:headHex:tailHex — three colon-separated parts.
    expect(fp.split(':')).toHaveLength(3);
    expect(fp.startsWith('200:')).toBe(true);
  });

  test('different buffers produce different fingerprints', () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([4, 5, 6]);
    expect(fingerprintBytes(a)).not.toBe(fingerprintBytes(b));
  });
});

describe('encode / decode round-trip', () => {
  const meta = fakeMeta();
  const idxFp = '42:deadbeef';
  const synFp = '13:cafebabe';

  const sampleEnvelope = (): CachedIndexEnvelope =>
    buildEnvelope(
      meta,
      new Map([
        ['apple', {word: 'apple', offset: 0, length: 7}],
        ['banana', {word: 'banana', offset: 7, length: 13}],
      ]),
      idxFp,
      synFp,
    );

  test('encode → decode preserves the envelope when fingerprints match', () => {
    const envelope = sampleEnvelope();
    const raw = encodeIndexCache(envelope);
    const decoded = decodeIndexCache(raw, idxFp, synFp);
    expect(decoded).not.toBeNull();
    expect(decoded?.entries.length).toBe(2);
    expect(decoded?.idxFingerprint).toBe(idxFp);
    expect(decoded?.synFingerprint).toBe(synFp);
    expect(decoded?.meta.bookname).toBe('Test');
  });

  test('hydrateIndex rebuilds the original Map<key, IdxEntry>', () => {
    const envelope = sampleEnvelope();
    const index = hydrateIndex(envelope);
    expect(index.size).toBe(2);
    expect(index.get('apple')).toEqual({word: 'apple', offset: 0, length: 7});
    expect(index.get('banana')).toEqual({
      word: 'banana',
      offset: 7,
      length: 13,
    });
  });

  test('hydrateIndex preserves "first occurrence wins" — duplicates after the first are skipped', () => {
    const envelope: CachedIndexEnvelope = {
      version: 1,
      idxFingerprint: idxFp,
      synFingerprint: null,
      meta,
      entries: [
        ['apple', 'Apple', 0, 5],
        ['apple', 'apple', 5, 5],
      ],
    };
    const index = hydrateIndex(envelope);
    expect(index.get('apple')?.word).toBe('Apple');
  });
});

describe('decodeIndexCache validation paths', () => {
  const meta = fakeMeta();
  const validRaw = (): string =>
    encodeIndexCache(
      buildEnvelope(meta, new Map(), 'idx-fp', 'syn-fp'),
    );

  test('null input returns null', () => {
    expect(decodeIndexCache(null, 'idx-fp', null)).toBeNull();
  });

  test('non-JSON input returns null', () => {
    expect(decodeIndexCache('not json', 'idx-fp', null)).toBeNull();
  });

  test('non-object root returns null', () => {
    expect(decodeIndexCache('"a string"', 'idx-fp', null)).toBeNull();
  });

  test('wrong schema version returns null', () => {
    const tampered = JSON.stringify({
      ...JSON.parse(validRaw()),
      version: 999,
    });
    expect(decodeIndexCache(tampered, 'idx-fp', 'syn-fp')).toBeNull();
  });

  test('idx fingerprint mismatch returns null (replaced .idx file)', () => {
    expect(
      decodeIndexCache(validRaw(), 'different-idx-fp', 'syn-fp'),
    ).toBeNull();
  });

  test('syn fingerprint mismatch returns null (added/removed .syn file)', () => {
    expect(decodeIndexCache(validRaw(), 'idx-fp', null)).toBeNull();
  });

  test('treats missing synFingerprint field as null (back-compat)', () => {
    const noSynField = JSON.stringify({
      version: 1,
      idxFingerprint: 'idx-fp',
      // synFingerprint omitted entirely
      meta,
      entries: [],
    });
    expect(decodeIndexCache(noSynField, 'idx-fp', null)).not.toBeNull();
  });

  test('missing meta returns null', () => {
    const tampered = JSON.stringify({
      version: 1,
      idxFingerprint: 'idx-fp',
      synFingerprint: null,
      entries: [],
    });
    expect(decodeIndexCache(tampered, 'idx-fp', null)).toBeNull();
  });

  test('non-array entries returns null', () => {
    const tampered = JSON.stringify({
      version: 1,
      idxFingerprint: 'idx-fp',
      synFingerprint: null,
      meta,
      entries: 'not an array',
    });
    expect(decodeIndexCache(tampered, 'idx-fp', null)).toBeNull();
  });
});

describe('cacheKeyForSource', () => {
  test('produces a namespaced, source-name-bearing key', () => {
    expect(cacheKeyForSource('WordNet')).toBe('@sndict_index:WordNet');
    expect(cacheKeyForSource('fr-en-strdict')).toBe(
      '@sndict_index:fr-en-strdict',
    );
  });
});
