-- 入出力の両方を担っていた user ノードを、userInput と userOutput の2ノードに分ける。
-- user ノードは id をそのまま userInput にし、そこへ流れ込んでいたエッジは新しく足す userOutput へ付け替える。
-- フローが左から右へ流れるよう、userInput はほかのノードより左に、userOutput はほかのノードより右に置く
UPDATE `sessions` SET `graph` = json_set(`graph`, '$.edges', (
  SELECT json_group_array(json(CASE
    WHEN json_extract(e.value, '$.target') IN (
      SELECT json_extract(n.value, '$.id') FROM json_each(`graph`, '$.nodes') n WHERE json_extract(n.value, '$.kind') = 'user'
    ) THEN json_set(e.value, '$.target', json_extract(e.value, '$.target') || '-output')
    ELSE e.value
  END)) FROM json_each(`graph`, '$.edges') e
));
--> statement-breakpoint
UPDATE `sessions` SET `graph` = json_insert(`graph`, '$.nodes[#]', json((
  SELECT json_object(
    'id', json_extract(u.value, '$.id') || '-output',
    'kind', 'userOutput',
    'position', json_object(
      'x', (SELECT max(json_extract(n.value, '$.position.x')) FROM json_each(`graph`, '$.nodes') n) + 300,
      'y', json_extract(u.value, '$.position.y')))
  FROM json_each(`graph`, '$.nodes') u WHERE json_extract(u.value, '$.kind') = 'user' LIMIT 1
)))
WHERE EXISTS (SELECT 1 FROM json_each(`graph`, '$.nodes') n WHERE json_extract(n.value, '$.kind') = 'user');
--> statement-breakpoint
UPDATE `sessions` SET `graph` = json_set(`graph`, '$.nodes', (
  SELECT json_group_array(json(CASE json_extract(n.value, '$.kind')
    WHEN 'user' THEN json_set(n.value,
      '$.kind', 'userInput',
      '$.position.x', min(json_extract(n.value, '$.position.x'), coalesce((
        SELECT min(json_extract(m.value, '$.position.x')) FROM json_each(`graph`, '$.nodes') m WHERE json_extract(m.value, '$.kind') <> 'user'
      ) - 300, json_extract(n.value, '$.position.x'))))
    ELSE n.value
  END)) FROM json_each(`graph`, '$.nodes') n
));
--> statement-breakpoint
UPDATE `turns` SET `graph` = json_set(`graph`, '$.edges', (
  SELECT json_group_array(json(CASE
    WHEN json_extract(e.value, '$.target') IN (
      SELECT json_extract(n.value, '$.id') FROM json_each(`graph`, '$.nodes') n WHERE json_extract(n.value, '$.kind') = 'user'
    ) THEN json_set(e.value, '$.target', json_extract(e.value, '$.target') || '-output')
    ELSE e.value
  END)) FROM json_each(`graph`, '$.edges') e
));
--> statement-breakpoint
UPDATE `turns` SET `graph` = json_insert(`graph`, '$.nodes[#]', json((
  SELECT json_object(
    'id', json_extract(u.value, '$.id') || '-output',
    'kind', 'userOutput',
    'position', json_object(
      'x', (SELECT max(json_extract(n.value, '$.position.x')) FROM json_each(`graph`, '$.nodes') n) + 300,
      'y', json_extract(u.value, '$.position.y')))
  FROM json_each(`graph`, '$.nodes') u WHERE json_extract(u.value, '$.kind') = 'user' LIMIT 1
)))
WHERE EXISTS (SELECT 1 FROM json_each(`graph`, '$.nodes') n WHERE json_extract(n.value, '$.kind') = 'user');
--> statement-breakpoint
UPDATE `turns` SET `graph` = json_set(`graph`, '$.nodes', (
  SELECT json_group_array(json(CASE json_extract(n.value, '$.kind')
    WHEN 'user' THEN json_set(n.value,
      '$.kind', 'userInput',
      '$.position.x', min(json_extract(n.value, '$.position.x'), coalesce((
        SELECT min(json_extract(m.value, '$.position.x')) FROM json_each(`graph`, '$.nodes') m WHERE json_extract(m.value, '$.kind') <> 'user'
      ) - 300, json_extract(n.value, '$.position.x'))))
    ELSE n.value
  END)) FROM json_each(`graph`, '$.nodes') n
));
