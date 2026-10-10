import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createDefaultGraph, workfolderSpec } from 'protocol';
import { db, graphs, sessions, turns } from '../db/index.ts';
import { fileContentAt, filesAt, Volume, VolumeError } from './index.ts';

describe('ターン単位の版管理', () => {
  it('分岐ごとに、その分岐の祖先で最後に書かれた版が見える', () => {
    const session = new TurnTree();
    const root = session.turn(null);
    const child = session.turn(root);
    const sibling = session.turn(root);
    volumeOf(root).write('a.md', 'v1');
    volumeOf(child).write('a.md', 'v2');

    expect(contentOf(root, 'a.md')).toBe('v1');
    expect(contentOf(child, 'a.md')).toBe('v2');
    expect(contentOf(sibling, 'a.md')).toBe('v1');
  });

  it('同じターン内で何度書いても1つの版になる', () => {
    const turn = new TurnTree().turn(null);
    volumeOf(turn).write('a.md', 'first');
    volumeOf(turn).write('a.md', 'second');

    expect(filesAt(turn)).toHaveLength(1);
    expect(contentOf(turn, 'a.md')).toBe('second');
  });

  it('削除は子孫には伝わるが、祖先と兄弟には伝わらない', () => {
    const session = new TurnTree();
    const root = session.turn(null);
    const deleting = session.turn(root);
    const grandchild = session.turn(deleting);
    const sibling = session.turn(root);
    volumeOf(root).write('a.md', 'v1');
    volumeOf(deleting).delete('a.md');

    expect(filesAt(root).map((f) => f.path)).toEqual(['a.md']);
    expect(filesAt(deleting)).toEqual([]);
    expect(filesAt(grandchild)).toEqual([]);
    expect(filesAt(sibling).map((f) => f.path)).toEqual(['a.md']);
  });
});

describe('ファイル操作', () => {
  it('Markdown の部分編集は、置き換える文字列がちょうど1回現れるときだけ行う', () => {
    const volume = volumeOf(new TurnTree().turn(null));
    volume.write('a.md', '# 見出し\nりんご みかん りんご');

    expect(() => volume.editMarkdown('a.md', 'ぶどう', 'x')).toThrow('見つかりません');
    expect(() => volume.editMarkdown('a.md', 'りんご', 'x')).toThrow('2 箇所');
    volume.editMarkdown('a.md', 'みかん', '$&レモン');
    expect(volume.read('a.md')).toBe('# 見出し\nりんご $&レモン りんご');
  });

  it('JSON は JSON Patch で部分編集でき、不正なパッチや JSON は書き込まない', () => {
    const volume = volumeOf(new TurnTree().turn(null));
    volume.write('data.json', '{"items":[{"name":"a"}]}');

    volume.patchJson('data.json', [
      { op: 'replace', path: '/items/0/name', value: 'b' },
      { op: 'add', path: '/items/-', value: { name: 'c' } },
    ]);
    expect(JSON.parse(volume.read('data.json'))).toEqual({ items: [{ name: 'b' }, { name: 'c' }] });
    expect(() => volume.patchJson('data.json', [{ op: 'remove', path: '/missing' }])).toThrow(VolumeError);
    expect(() => volume.write('data.json', '{broken')).toThrow('JSON として読めません');
    expect(JSON.parse(volume.read('data.json'))).toEqual({ items: [{ name: 'b' }, { name: 'c' }] });
  });

  it('相対パスと置ける拡張子以外は受け付けない', () => {
    const volume = volumeOf(new TurnTree().turn(null));
    for (const path of ['../a.md', '/a.md', 'a//b.md', './a.md', 'a\\b.md', 'a.txt']) {
      expect(() => volume.write(path, 'x'), path).toThrow(VolumeError);
    }
    volume.write('notes/plan.md', 'ok');
    expect(volume.list()).toEqual(['notes/plan.md']);
  });

  it('存在しないファイルの読み取り・削除は失敗する', () => {
    const volume = volumeOf(new TurnTree().turn(null));
    expect(() => volume.read('a.md')).toThrow('ありません');
    expect(() => volume.delete('a.md')).toThrow('ありません');
  });
});

/** テスト用のセッション1つ分。ターンを好きな親の下に作れる */
class TurnTree {
  private readonly sessionId = randomUUID();

  constructor() {
    const graphId = randomUUID();
    db.insert(graphs).values({ id: graphId, name: 'test', definition: createDefaultGraph(), updatedAt: Date.now() }).run();
    db.insert(sessions).values({ id: this.sessionId, title: 'test', graphId, activeTurnId: null, createdAt: Date.now() }).run();
  }

  turn(parentTurnId: string | null): string {
    const id = randomUUID();
    db.insert(turns)
      .values({
        id,
        sessionId: this.sessionId,
        parentTurnId,
        userText: '',
        graph: createDefaultGraph(),
        status: 'done',
        mainMessages: [],
        createdAt: Date.now(),
      })
      .run();
    return id;
  }
}

function volumeOf(turnId: string): Volume {
  return new Volume(turnId, workfolderSpec);
}

function contentOf(turnId: string, path: string): string | undefined {
  return fileContentAt(turnId, workfolderSpec.volume, path);
}
