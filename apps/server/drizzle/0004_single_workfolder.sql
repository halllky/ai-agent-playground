-- ワークフォルダの中のフォルダごとだった files ノードを、グラフに1つの workfolder ノードにまとめる。
-- workfolder ノードの id と位置は、先頭の files ノードのものを使う。files ノードが無ければ、ほかのノードの下に新しく置く。
-- パスが空でない files ノードはそのパスを名前にしたフォルダのエントリにし、初期ファイルはそのフォルダ（パスが空なら直下）のファイルのエントリにする。
-- files ノードへのツールエッジは、そのフォルダ（パスが空なら全体）への権限を与えるアクセスエッジにし、ほかのツールエッジからは権限を外す。
-- 初期ファイルは会話の先頭で写すようになったので、写し終えた files ノードを覚えていた seededFolders は消す
UPDATE `graphs` SET `definition` = json_set(`definition`, '$.edges', (
  SELECT json_group_array(json(CASE
    WHEN json_extract(e.value, '$.kind') = 'tool' AND f.value IS NOT NULL THEN json_object(
      'id', json_extract(e.value, '$.id'),
      'kind', 'access',
      'source', json_extract(e.value, '$.source'),
      'target', (SELECT json_extract(n.value, '$.id') FROM json_each(`definition`, '$.nodes') n WHERE json_extract(n.value, '$.kind') = 'files' ORDER BY n.key LIMIT 1),
      'entryId', CASE WHEN json_extract(f.value, '$.config.path') = '' THEN NULL ELSE json_extract(f.value, '$.id') END,
      'permission', json_extract(e.value, '$.permission'))
    WHEN json_extract(e.value, '$.kind') = 'tool' THEN json_remove(e.value, '$.permission')
    ELSE e.value
  END))
  FROM json_each(`definition`, '$.edges') e
  LEFT JOIN json_each(`definition`, '$.nodes') f
    ON json_extract(f.value, '$.kind') = 'files' AND json_extract(f.value, '$.id') = json_extract(e.value, '$.target')
));
--> statement-breakpoint
UPDATE `graphs` SET `definition` = json_set(`definition`, '$.nodes', json_insert(
  (SELECT json_group_array(json(n.value)) FROM json_each(`definition`, '$.nodes') n WHERE json_extract(n.value, '$.kind') <> 'files'),
  '$[#]', json_object(
    'id', coalesce(
      (SELECT json_extract(n.value, '$.id') FROM json_each(`definition`, '$.nodes') n WHERE json_extract(n.value, '$.kind') = 'files' ORDER BY n.key LIMIT 1),
      'workfolder'),
    'kind', 'workfolder',
    'position', json(coalesce(
      (SELECT json_extract(n.value, '$.position') FROM json_each(`definition`, '$.nodes') n WHERE json_extract(n.value, '$.kind') = 'files' ORDER BY n.key LIMIT 1),
      (SELECT json_object('x', min(json_extract(n.value, '$.position.x')), 'y', max(json_extract(n.value, '$.position.y')) + 200) FROM json_each(`definition`, '$.nodes') n))),
    'config', json_object(
      'description', coalesce(
        (SELECT json_extract(n.value, '$.config.description') FROM json_each(`definition`, '$.nodes') n
          WHERE json_extract(n.value, '$.kind') = 'files' AND json_extract(n.value, '$.config.path') = '' ORDER BY n.key LIMIT 1),
        ''),
      'entries', json((SELECT json_group_array(json(entry)) FROM (
        SELECT f.key AS node_order, -1 AS file_order, json_object(
          'id', json_extract(f.value, '$.id'),
          'parentId', NULL,
          'name', json_extract(f.value, '$.config.path'),
          'description', json_extract(f.value, '$.config.description'),
          'type', 'folder') AS entry
        FROM json_each(`definition`, '$.nodes') f
        WHERE json_extract(f.value, '$.kind') = 'files' AND json_extract(f.value, '$.config.path') <> ''
        UNION ALL
        SELECT f.key, x.key, json_object(
          'id', json_extract(f.value, '$.id') || '-' || x.key,
          'parentId', CASE WHEN json_extract(f.value, '$.config.path') = '' THEN NULL ELSE json_extract(f.value, '$.id') END,
          'name', json_extract(x.value, '$.path'),
          'description', '',
          'type', 'file',
          'content', json_extract(x.value, '$.content'))
        FROM json_each(`definition`, '$.nodes') f, json_each(f.value, '$.config.files') x
        WHERE json_extract(f.value, '$.kind') = 'files'
        ORDER BY 1, 2
      )))))
));
--> statement-breakpoint
UPDATE `turns` SET `graph` = json_set(`graph`, '$.edges', (
  SELECT json_group_array(json(CASE
    WHEN json_extract(e.value, '$.kind') = 'tool' AND f.value IS NOT NULL THEN json_object(
      'id', json_extract(e.value, '$.id'),
      'kind', 'access',
      'source', json_extract(e.value, '$.source'),
      'target', (SELECT json_extract(n.value, '$.id') FROM json_each(`graph`, '$.nodes') n WHERE json_extract(n.value, '$.kind') = 'files' ORDER BY n.key LIMIT 1),
      'entryId', CASE WHEN json_extract(f.value, '$.config.path') = '' THEN NULL ELSE json_extract(f.value, '$.id') END,
      'permission', json_extract(e.value, '$.permission'))
    WHEN json_extract(e.value, '$.kind') = 'tool' THEN json_remove(e.value, '$.permission')
    ELSE e.value
  END))
  FROM json_each(`graph`, '$.edges') e
  LEFT JOIN json_each(`graph`, '$.nodes') f
    ON json_extract(f.value, '$.kind') = 'files' AND json_extract(f.value, '$.id') = json_extract(e.value, '$.target')
));
--> statement-breakpoint
UPDATE `turns` SET `graph` = json_set(`graph`, '$.nodes', json_insert(
  (SELECT json_group_array(json(n.value)) FROM json_each(`graph`, '$.nodes') n WHERE json_extract(n.value, '$.kind') <> 'files'),
  '$[#]', json_object(
    'id', coalesce(
      (SELECT json_extract(n.value, '$.id') FROM json_each(`graph`, '$.nodes') n WHERE json_extract(n.value, '$.kind') = 'files' ORDER BY n.key LIMIT 1),
      'workfolder'),
    'kind', 'workfolder',
    'position', json(coalesce(
      (SELECT json_extract(n.value, '$.position') FROM json_each(`graph`, '$.nodes') n WHERE json_extract(n.value, '$.kind') = 'files' ORDER BY n.key LIMIT 1),
      (SELECT json_object('x', min(json_extract(n.value, '$.position.x')), 'y', max(json_extract(n.value, '$.position.y')) + 200) FROM json_each(`graph`, '$.nodes') n))),
    'config', json_object(
      'description', coalesce(
        (SELECT json_extract(n.value, '$.config.description') FROM json_each(`graph`, '$.nodes') n
          WHERE json_extract(n.value, '$.kind') = 'files' AND json_extract(n.value, '$.config.path') = '' ORDER BY n.key LIMIT 1),
        ''),
      'entries', json((SELECT json_group_array(json(entry)) FROM (
        SELECT f.key AS node_order, -1 AS file_order, json_object(
          'id', json_extract(f.value, '$.id'),
          'parentId', NULL,
          'name', json_extract(f.value, '$.config.path'),
          'description', json_extract(f.value, '$.config.description'),
          'type', 'folder') AS entry
        FROM json_each(`graph`, '$.nodes') f
        WHERE json_extract(f.value, '$.kind') = 'files' AND json_extract(f.value, '$.config.path') <> ''
        UNION ALL
        SELECT f.key, x.key, json_object(
          'id', json_extract(f.value, '$.id') || '-' || x.key,
          'parentId', CASE WHEN json_extract(f.value, '$.config.path') = '' THEN NULL ELSE json_extract(f.value, '$.id') END,
          'name', json_extract(x.value, '$.path'),
          'description', '',
          'type', 'file',
          'content', json_extract(x.value, '$.content'))
        FROM json_each(`graph`, '$.nodes') f, json_each(f.value, '$.config.files') x
        WHERE json_extract(f.value, '$.kind') = 'files'
        ORDER BY 1, 2
      )))))
));
--> statement-breakpoint
UPDATE `turns` SET `state` = json_remove(`state`, '$.seededFolders');
