import test from 'node:test';
import assert from 'node:assert/strict';

import { parseChanges, parseTree } from '../src/modules/repository/inventory.mjs';

test('tree 경로 안의 공백과 탭을 보존한다', () => {
  const rows = parseTree(Buffer.from('100644 blob abc123\t한 글\t파일.ts\0'));
  assert.deepEqual(rows, [{
    mode: '100644',
    objectType: 'blob',
    oid: 'abc123',
    path: '한 글\t파일.ts',
  }]);
});

test('rename은 이전 경로와 새 경로를 별도로 읽는다', () => {
  const raw = Buffer.from(':100644 100644 abc123 def456 R100\0old.ts\0new.ts\0');
  const [entry] = parseChanges(raw);
  assert.equal(entry.status, 'R100');
  assert.equal(entry.oldPath, 'old.ts');
  assert.equal(entry.newPath, 'new.ts');
});

test('추가 삭제 수정 타입 변경을 구분한다', () => {
  const raw = Buffer.from([
    ':000000 100644 000000 abc111 A\0add.ts\0',
    ':100644 000000 abc222 000000 D\0delete.ts\0',
    ':100644 100644 abc333 def333 M\0modify.ts\0',
    ':100644 100755 abc444 def444 T\0mode.ts\0',
  ].join(''));
  const rows = parseChanges(raw);

  assert.deepEqual(rows.map(({ status, oldPath, newPath }) => ({ status, oldPath, newPath })), [
    { status: 'A', oldPath: null, newPath: 'add.ts' },
    { status: 'D', oldPath: 'delete.ts', newPath: null },
    { status: 'M', oldPath: 'modify.ts', newPath: 'modify.ts' },
    { status: 'T', oldPath: 'mode.ts', newPath: 'mode.ts' },
  ]);
});

test('개행을 포함한 경로와 빈 출력을 처리한다', () => {
  const rows = parseChanges(Buffer.from(':100644 100644 abc123 def456 M\0line\nbreak.ts\0'));
  assert.equal(rows[0].newPath, 'line\nbreak.ts');
  assert.deepEqual(parseTree(Buffer.alloc(0)), []);
  assert.deepEqual(parseChanges(Buffer.alloc(0)), []);
});

test('잘린 rename과 잘못된 UTF-8을 거부한다', () => {
  assert.throws(
    () => parseChanges(Buffer.from(':100644 100644 abc123 def456 R100\0old.ts\0')),
    /INVALID_DIFF_RECORD/,
  );
  assert.throws(
    () => parseTree(Buffer.from([0xff, 0x00])),
    /PATH_ENCODING_UNSUPPORTED/,
  );
});
