-- エージェントの pass と memory を、1つだけを選ぶ経緯の history（と historyLength・attachments）に置き換える。
-- 両方を使っていたエージェントは、ツールコールまで含む memory のほうを残す。
-- files ノードは name からワークフォルダの中のフォルダの path にする。
-- 以前の files ノードはそれぞれ別のファイル群だったので、すべてワークフォルダ全体のフォルダとして扱う
UPDATE `sessions` SET `graph` = json_set(`graph`, '$.nodes', (
  SELECT json_group_array(json(CASE json_extract(n.value, '$.kind')
    WHEN 'agent' THEN json_remove(json_set(n.value,
      '$.config.history', CASE
        WHEN json_extract(n.value, '$.config.memory') = 'session' THEN 'sessionCalls'
        WHEN json_extract(n.value, '$.config.memory') = 'turn' THEN 'turnCalls'
        WHEN json_extract(n.value, '$.config.pass') = 'task' THEN 'none'
        ELSE 'conversation'
      END,
      '$.config.historyLength', 2,
      '$.config.attachments', json_array()), '$.config.pass', '$.config.memory')
    WHEN 'files' THEN json_remove(json_set(n.value, '$.config.path', ''), '$.config.name')
    ELSE n.value
  END)) FROM json_each(`graph`, '$.nodes') n
));
--> statement-breakpoint
UPDATE `turns` SET `graph` = json_set(`graph`, '$.nodes', (
  SELECT json_group_array(json(CASE json_extract(n.value, '$.kind')
    WHEN 'agent' THEN json_remove(json_set(n.value,
      '$.config.history', CASE
        WHEN json_extract(n.value, '$.config.memory') = 'session' THEN 'sessionCalls'
        WHEN json_extract(n.value, '$.config.memory') = 'turn' THEN 'turnCalls'
        WHEN json_extract(n.value, '$.config.pass') = 'task' THEN 'none'
        ELSE 'conversation'
      END,
      '$.config.historyLength', 2,
      '$.config.attachments', json_array()), '$.config.pass', '$.config.memory')
    WHEN 'files' THEN json_remove(json_set(n.value, '$.config.path', ''), '$.config.name')
    ELSE n.value
  END)) FROM json_each(`graph`, '$.nodes') n
));
--> statement-breakpoint
-- files ノードの id ごとだったファイルを1つのワークフォルダにまとめ、写し終えた files ノードの id を seededFolders に残す
UPDATE `turns` SET `state` = json_set(`state`,
  '$.files', json((SELECT json_group_object(f.key, f.value) FROM json_each(`state`, '$.files') g, json_each(g.value) f)),
  '$.seededFolders', json((SELECT json_group_array(g.key) FROM json_each(`state`, '$.files') g))
) WHERE json_extract(`state`, '$.seededFolders') IS NULL;
