import {parseIfo} from '../src/core/dict/stardict/parseIfo';

const ifoOf = (text: string) => new TextEncoder().encode(text);

describe('parseIfo', () => {
  test('parses a typical WordNet-style .ifo (32-bit offsets, sametypesequence=m)', () => {
    const meta = parseIfo(
      ifoOf(
        "StarDict's dict ifo file\n" +
          'version=2.4.2\n' +
          'bookname=My Dictionary\n' +
          'wordcount=12345\n' +
          'synwordcount=1000\n' +
          'idxfilesize=234567\n' +
          'idxoffsetbits=32\n' +
          'sametypesequence=m\n',
      ),
    );
    expect(meta.bookname).toBe('My Dictionary');
    expect(meta.wordcount).toBe(12345);
    expect(meta.synwordcount).toBe(1000);
    expect(meta.idxfilesize).toBe(234567);
    expect(meta.idxoffsetbits).toBe(32);
    expect(meta.sametypesequence).toBe('m');
  });

  test('defaults idxoffsetbits to 32 when absent', () => {
    const meta = parseIfo(ifoOf('wordcount=10\n'));
    expect(meta.idxoffsetbits).toBe(32);
  });

  test('accepts idxoffsetbits=64', () => {
    const meta = parseIfo(ifoOf('wordcount=10\nidxoffsetbits=64\n'));
    expect(meta.idxoffsetbits).toBe(64);
  });

  test('accepts an explicit idxoffsetbits=32', () => {
    const meta = parseIfo(ifoOf('wordcount=10\nidxoffsetbits=32\n'));
    expect(meta.idxoffsetbits).toBe(32);
  });

  test('treats an empty idxoffsetbits value as absent (defaults to 32)', () => {
    const meta = parseIfo(ifoOf('wordcount=10\nidxoffsetbits=\n'));
    expect(meta.idxoffsetbits).toBe(32);
  });

  test('rejects an invalid idxoffsetbits value', () => {
    expect(() =>
      parseIfo(ifoOf('wordcount=10\nidxoffsetbits=24\n')),
    ).toThrow(/idxoffsetbits must be 32 or 64/);
  });

  test('throws when wordcount is missing', () => {
    expect(() => parseIfo(ifoOf('bookname=No Words\n'))).toThrow(
      /missing or invalid wordcount/,
    );
  });

  test('throws when wordcount is non-numeric', () => {
    expect(() => parseIfo(ifoOf('wordcount=many\n'))).toThrow(
      /missing or invalid wordcount/,
    );
  });

  test('rejects a wordcount that starts numeric but contains trailing garbage', () => {
    // Regression: parseInt('12abc', 10) === 12 silently — strict
    // \d+ check rejects so we don't accept malformed metadata.
    expect(() => parseIfo(ifoOf('wordcount=12abc\n'))).toThrow(
      /missing or invalid wordcount/,
    );
    expect(() => parseIfo(ifoOf('wordcount=  42\n'))).toThrow(
      /missing or invalid wordcount/,
    );
    expect(() => parseIfo(ifoOf('wordcount=42 \n'))).toThrow(
      /missing or invalid wordcount/,
    );
    expect(() => parseIfo(ifoOf('wordcount=4.5\n'))).toThrow(
      /missing or invalid wordcount/,
    );
  });

  test('treats malformed synwordcount / idxfilesize as undefined (diagnostic-only fields)', () => {
    const meta = parseIfo(
      ifoOf('wordcount=10\nsynwordcount=12abc\nidxfilesize=garbage\n'),
    );
    expect(meta.wordcount).toBe(10);
    expect(meta.synwordcount).toBeUndefined();
    expect(meta.idxfilesize).toBeUndefined();
    // The raw values are still preserved in rawFields for diagnostics.
    expect(meta.rawFields.synwordcount).toBe('12abc');
    expect(meta.rawFields.idxfilesize).toBe('garbage');
  });

  test('throws when wordcount is zero or negative', () => {
    expect(() => parseIfo(ifoOf('wordcount=0\n'))).toThrow();
    expect(() => parseIfo(ifoOf('wordcount=-5\n'))).toThrow();
  });

  test('preserves unknown fields in rawFields', () => {
    const meta = parseIfo(
      ifoOf('wordcount=10\nauthor=Someone\ndescription=foo bar\n'),
    );
    expect(meta.rawFields.author).toBe('Someone');
    expect(meta.rawFields.description).toBe('foo bar');
  });

  test('skips blank lines, the magic header, and lines without an =', () => {
    const meta = parseIfo(
      ifoOf(
        "StarDict's dict ifo file\n" +
          '\n' +
          'wordcount=42\n' +
          'invalid line without equals\n' +
          '=novalue\n',
      ),
    );
    expect(meta.wordcount).toBe(42);
  });

  test('skips lines with whitespace-only keys', () => {
    // "   =something" has eq > 0 but key trims to empty — the parser
    // must drop it rather than store an empty key.
    const meta = parseIfo(
      ifoOf('wordcount=42\n   =something\n'),
    );
    expect(meta.wordcount).toBe(42);
    expect(meta.rawFields['']).toBeUndefined();
  });

  test('handles CRLF line endings', () => {
    const meta = parseIfo(ifoOf('wordcount=7\r\nbookname=CRLF\r\n'));
    expect(meta.wordcount).toBe(7);
    expect(meta.bookname).toBe('CRLF');
  });
});
