import { describe, expect, it } from 'vitest';
import { FileError, Workfolder } from './files.ts';

describe('ファイル操作', () => {
  it('書き込み・削除のたびに変更を知らせる', () => {
    const files: Record<string, string> = {};
    let changes = 0;
    const workfolder = new Workfolder(files, () => changes++);
    workfolder.write('a.md', 'x');
    workfolder.delete('a.md');

    expect(files).toEqual({});
    expect(changes).toBe(2);
  });

  it('Markdown の部分編集は、置き換える文字列がちょうど1回現れるときだけ行う', () => {
    const workfolder = workfolderOf();
    workfolder.write('a.md', '# 見出し\nりんご みかん りんご');

    expect(() => workfolder.editMarkdown('a.md', 'ぶどう', 'x')).toThrow('見つかりません');
    expect(() => workfolder.editMarkdown('a.md', 'りんご', 'x')).toThrow('2 箇所');
    workfolder.editMarkdown('a.md', 'みかん', '$&レモン');
    expect(workfolder.read('a.md')).toBe('# 見出し\nりんご $&レモン りんご');
  });

  it('JSON は JSON Patch で部分編集でき、不正なパッチや JSON は書き込まない', () => {
    const workfolder = workfolderOf();
    workfolder.write('data.json', '{"items":[{"name":"a"}]}');

    workfolder.patchJson('data.json', [
      { op: 'replace', path: '/items/0/name', value: 'b' },
      { op: 'add', path: '/items/-', value: { name: 'c' } },
    ]);
    expect(JSON.parse(workfolder.read('data.json'))).toEqual({ items: [{ name: 'b' }, { name: 'c' }] });
    expect(() => workfolder.patchJson('data.json', [{ op: 'remove', path: '/missing' }])).toThrow(FileError);
    expect(() => workfolder.write('data.json', '{broken')).toThrow('JSON として読めません');
    expect(JSON.parse(workfolder.read('data.json'))).toEqual({ items: [{ name: 'b' }, { name: 'c' }] });
  });

  it('相対パスと置ける拡張子以外は受け付けない', () => {
    const workfolder = workfolderOf();
    for (const path of ['../a.md', '/a.md', 'a//b.md', './a.md', 'a\\b.md', 'a.txt']) {
      expect(() => workfolder.write(path, 'x'), path).toThrow(FileError);
    }
    workfolder.write('notes/plan.md', 'ok');
    expect(workfolder.list()).toEqual(['notes/plan.md']);
  });

  it('存在しないファイルの読み取り・削除は失敗する', () => {
    const workfolder = workfolderOf();
    expect(() => workfolder.read('a.md')).toThrow('ありません');
    expect(() => workfolder.delete('a.md')).toThrow('ありません');
  });
});

function workfolderOf(): Workfolder {
  return new Workfolder({}, () => {});
}
