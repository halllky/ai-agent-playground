import { describe, expect, it } from 'vitest';
import { FileError, FileGroup } from './files.ts';

describe('ファイル操作', () => {
  it('書き込み・削除のたびに変更を知らせる', () => {
    const files: Record<string, string> = {};
    let changes = 0;
    const group = new FileGroup(files, () => changes++);
    group.write('a.md', 'x');
    group.delete('a.md');

    expect(files).toEqual({});
    expect(changes).toBe(2);
  });

  it('Markdown の部分編集は、置き換える文字列がちょうど1回現れるときだけ行う', () => {
    const group = groupOf();
    group.write('a.md', '# 見出し\nりんご みかん りんご');

    expect(() => group.editMarkdown('a.md', 'ぶどう', 'x')).toThrow('見つかりません');
    expect(() => group.editMarkdown('a.md', 'りんご', 'x')).toThrow('2 箇所');
    group.editMarkdown('a.md', 'みかん', '$&レモン');
    expect(group.read('a.md')).toBe('# 見出し\nりんご $&レモン りんご');
  });

  it('JSON は JSON Patch で部分編集でき、不正なパッチや JSON は書き込まない', () => {
    const group = groupOf();
    group.write('data.json', '{"items":[{"name":"a"}]}');

    group.patchJson('data.json', [
      { op: 'replace', path: '/items/0/name', value: 'b' },
      { op: 'add', path: '/items/-', value: { name: 'c' } },
    ]);
    expect(JSON.parse(group.read('data.json'))).toEqual({ items: [{ name: 'b' }, { name: 'c' }] });
    expect(() => group.patchJson('data.json', [{ op: 'remove', path: '/missing' }])).toThrow(FileError);
    expect(() => group.write('data.json', '{broken')).toThrow('JSON として読めません');
    expect(JSON.parse(group.read('data.json'))).toEqual({ items: [{ name: 'b' }, { name: 'c' }] });
  });

  it('相対パスと置ける拡張子以外は受け付けない', () => {
    const group = groupOf();
    for (const path of ['../a.md', '/a.md', 'a//b.md', './a.md', 'a\\b.md', 'a.txt']) {
      expect(() => group.write(path, 'x'), path).toThrow(FileError);
    }
    group.write('notes/plan.md', 'ok');
    expect(group.list()).toEqual(['notes/plan.md']);
  });

  it('存在しないファイルの読み取り・削除は失敗する', () => {
    const group = groupOf();
    expect(() => group.read('a.md')).toThrow('ありません');
    expect(() => group.delete('a.md')).toThrow('ありません');
  });
});

function groupOf(): FileGroup {
  return new FileGroup({}, () => {});
}
