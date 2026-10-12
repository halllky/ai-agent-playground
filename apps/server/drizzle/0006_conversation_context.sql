-- ユーザーの発言はフローに流さず、エージェントと判定がノードの会話の設定（今回の発言を含む）で見るようにする。
-- フローの依頼と応答の記憶（flow エッジの memory）は無くし、ユーザー入力から記憶ありで受けていたエージェントは、会話をすべて見るようにする。
-- ユーザー入力から受けていて会話を含めていなかったノードは、今回の発言だけを見るようにする（これまで通り発言が届く）。
-- 直近の数は発言の数から往復の数に変わったので、切り上げて往復の数にする。
-- 判定はユーザー入力から受けていれば今回の発言だけ、そうでなければ会話を含めない。
-- ノードごとの input は、ユーザー入力からのフローが無ければ NULL、記憶なしだけなら 0、記憶ありがあれば 1
UPDATE `graphs` SET `definition` = json_set(`definition`, '$.nodes', (
  SELECT json_group_array(json(CASE json_extract(x.node, '$.kind')
    WHEN 'agent' THEN json_set(x.node,
      '$.config.conversation', CASE
        WHEN x.input = 1 THEN 'all'
        WHEN x.input = 0 AND json_extract(x.node, '$.config.conversation') = 'none' THEN 'recent'
        ELSE json_extract(x.node, '$.config.conversation') END,
      '$.config.conversationLength', CASE
        WHEN x.input = 0 AND json_extract(x.node, '$.config.conversation') = 'none' THEN 0
        ELSE (json_extract(x.node, '$.config.conversationLength') + 1) / 2 END)
    WHEN 'judge' THEN json_set(x.node,
      '$.config.conversation', CASE WHEN x.input IS NULL THEN 'none' ELSE 'recent' END,
      '$.config.conversationLength', CASE WHEN x.input IS NULL THEN 1 ELSE 0 END)
    ELSE x.node
  END))
  FROM (
    SELECT n.value AS node, (
      SELECT max(coalesce(json_extract(e.value, '$.memory'), 'none') = 'session')
      FROM json_each(`definition`, '$.edges') e
      JOIN json_each(`definition`, '$.nodes') s ON json_extract(s.value, '$.id') = json_extract(e.value, '$.source')
      WHERE json_extract(e.value, '$.kind') = 'flow' AND json_extract(s.value, '$.kind') = 'userInput'
        AND json_extract(e.value, '$.target') = json_extract(n.value, '$.id')
    ) AS input
    FROM json_each(`definition`, '$.nodes') n
  ) x
));
--> statement-breakpoint
UPDATE `graphs` SET `definition` = json_set(`definition`, '$.edges', (
  SELECT json_group_array(json(CASE json_extract(e.value, '$.kind') WHEN 'flow' THEN json_remove(e.value, '$.memory') ELSE e.value END))
  FROM json_each(`definition`, '$.edges') e
));
--> statement-breakpoint
UPDATE `turns` SET `graph` = json_set(`graph`, '$.nodes', (
  SELECT json_group_array(json(CASE json_extract(x.node, '$.kind')
    WHEN 'agent' THEN json_set(x.node,
      '$.config.conversation', CASE
        WHEN x.input = 1 THEN 'all'
        WHEN x.input = 0 AND json_extract(x.node, '$.config.conversation') = 'none' THEN 'recent'
        ELSE json_extract(x.node, '$.config.conversation') END,
      '$.config.conversationLength', CASE
        WHEN x.input = 0 AND json_extract(x.node, '$.config.conversation') = 'none' THEN 0
        ELSE (json_extract(x.node, '$.config.conversationLength') + 1) / 2 END)
    WHEN 'judge' THEN json_set(x.node,
      '$.config.conversation', CASE WHEN x.input IS NULL THEN 'none' ELSE 'recent' END,
      '$.config.conversationLength', CASE WHEN x.input IS NULL THEN 1 ELSE 0 END)
    ELSE x.node
  END))
  FROM (
    SELECT n.value AS node, (
      SELECT max(coalesce(json_extract(e.value, '$.memory'), 'none') = 'session')
      FROM json_each(`graph`, '$.edges') e
      JOIN json_each(`graph`, '$.nodes') s ON json_extract(s.value, '$.id') = json_extract(e.value, '$.source')
      WHERE json_extract(e.value, '$.kind') = 'flow' AND json_extract(s.value, '$.kind') = 'userInput'
        AND json_extract(e.value, '$.target') = json_extract(n.value, '$.id')
    ) AS input
    FROM json_each(`graph`, '$.nodes') n
  ) x
));
--> statement-breakpoint
UPDATE `turns` SET `graph` = json_set(`graph`, '$.edges', (
  SELECT json_group_array(json(CASE json_extract(e.value, '$.kind') WHEN 'flow' THEN json_remove(e.value, '$.memory') ELSE e.value END))
  FROM json_each(`graph`, '$.edges') e
));
--> statement-breakpoint
-- フローからの呼び出しの記憶（key が flow:<ノードの id>）は使わなくなったので捨てる
UPDATE `turns` SET `state` = json_set(`state`, '$.memories', (
  SELECT json_group_object(m.key, json(m.value)) FROM json_each(`state`, '$.memories') m WHERE m.key NOT LIKE 'flow:%'
));
