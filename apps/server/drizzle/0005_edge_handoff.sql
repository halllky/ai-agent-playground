-- エージェントノードが持っていた、前後のノードとの受け渡しの設定をエッジへ移す。
-- ツールの説明（agent / judge の description）は、そのノードへのツールエッジへ写す。
-- 返すもの（returns）は、allSteps ならそのエージェントから出るフローとそのエージェントへのツールエッジへ写し、none はノードの workOnly にする。
-- 前回までの経緯（history）のうち、ユーザーとの会話はノードの conversation にし、依頼と応答はそのエージェントへ入るエッジの memory にする
-- （フローではターンに1回しか呼ばれないので、turnCalls はフローでは記憶なしにする）。
-- 添付ファイル（attachments）はパスの指定ができなくなったので捨て、アクセスエッジはプロンプトに含めない（attach = false）ものにする。
-- 依頼と応答の記憶はノードごとからエッジごとに変わったので、残っている記憶は捨てる
UPDATE `graphs` SET `definition` = json_set(`definition`, '$.edges', (
  SELECT json_group_array(json(CASE json_extract(e.value, '$.kind')
    WHEN 'tool' THEN json_set(e.value,
      '$.description', coalesce(json_extract(t.value, '$.config.description'), ''),
      '$.returns', CASE WHEN json_extract(t.value, '$.kind') = 'agent' AND json_extract(t.value, '$.config.returns') = 'allSteps' THEN 'allSteps' ELSE 'finalText' END,
      '$.memory', CASE WHEN json_extract(t.value, '$.kind') <> 'agent' THEN 'none' WHEN json_extract(t.value, '$.config.history') = 'turnCalls' THEN 'turn'
        WHEN json_extract(t.value, '$.config.history') = 'sessionCalls' THEN 'session' ELSE 'none' END)
    WHEN 'flow' THEN json_set(e.value,
      '$.returns', CASE WHEN json_extract(s.value, '$.kind') = 'agent' AND json_extract(s.value, '$.config.returns') = 'allSteps' THEN 'allSteps' ELSE 'finalText' END,
      '$.memory', CASE WHEN json_extract(t.value, '$.kind') = 'agent' AND json_extract(t.value, '$.config.history') = 'sessionCalls' THEN 'session' ELSE 'none' END)
    WHEN 'access' THEN json_set(e.value, '$.attach', json('false'))
    ELSE e.value
  END))
  FROM json_each(`definition`, '$.edges') e
  LEFT JOIN json_each(`definition`, '$.nodes') s ON json_extract(s.value, '$.id') = json_extract(e.value, '$.source')
  LEFT JOIN json_each(`definition`, '$.nodes') t ON json_extract(t.value, '$.id') = json_extract(e.value, '$.target')
));
--> statement-breakpoint
UPDATE `graphs` SET `definition` = json_set(`definition`, '$.nodes', (
  SELECT json_group_array(json(CASE json_extract(n.value, '$.kind')
    WHEN 'agent' THEN json_remove(json_set(n.value,
        '$.config.conversation', CASE json_extract(n.value, '$.config.history') WHEN 'recentConversation' THEN 'recent' WHEN 'conversation' THEN 'all' ELSE 'none' END,
        '$.config.conversationLength', json_extract(n.value, '$.config.historyLength'),
        '$.config.workOnly', json(CASE WHEN json_extract(n.value, '$.config.returns') = 'none' THEN 'true' ELSE 'false' END)),
      '$.config.description', '$.config.attachments', '$.config.returns', '$.config.history', '$.config.historyLength')
    WHEN 'judge' THEN json_remove(n.value, '$.config.description')
    ELSE n.value
  END))
  FROM json_each(`definition`, '$.nodes') n
));
--> statement-breakpoint
UPDATE `turns` SET `graph` = json_set(`graph`, '$.edges', (
  SELECT json_group_array(json(CASE json_extract(e.value, '$.kind')
    WHEN 'tool' THEN json_set(e.value,
      '$.description', coalesce(json_extract(t.value, '$.config.description'), ''),
      '$.returns', CASE WHEN json_extract(t.value, '$.kind') = 'agent' AND json_extract(t.value, '$.config.returns') = 'allSteps' THEN 'allSteps' ELSE 'finalText' END,
      '$.memory', CASE WHEN json_extract(t.value, '$.kind') <> 'agent' THEN 'none' WHEN json_extract(t.value, '$.config.history') = 'turnCalls' THEN 'turn'
        WHEN json_extract(t.value, '$.config.history') = 'sessionCalls' THEN 'session' ELSE 'none' END)
    WHEN 'flow' THEN json_set(e.value,
      '$.returns', CASE WHEN json_extract(s.value, '$.kind') = 'agent' AND json_extract(s.value, '$.config.returns') = 'allSteps' THEN 'allSteps' ELSE 'finalText' END,
      '$.memory', CASE WHEN json_extract(t.value, '$.kind') = 'agent' AND json_extract(t.value, '$.config.history') = 'sessionCalls' THEN 'session' ELSE 'none' END)
    WHEN 'access' THEN json_set(e.value, '$.attach', json('false'))
    ELSE e.value
  END))
  FROM json_each(`graph`, '$.edges') e
  LEFT JOIN json_each(`graph`, '$.nodes') s ON json_extract(s.value, '$.id') = json_extract(e.value, '$.source')
  LEFT JOIN json_each(`graph`, '$.nodes') t ON json_extract(t.value, '$.id') = json_extract(e.value, '$.target')
));
--> statement-breakpoint
UPDATE `turns` SET `graph` = json_set(`graph`, '$.nodes', (
  SELECT json_group_array(json(CASE json_extract(n.value, '$.kind')
    WHEN 'agent' THEN json_remove(json_set(n.value,
        '$.config.conversation', CASE json_extract(n.value, '$.config.history') WHEN 'recentConversation' THEN 'recent' WHEN 'conversation' THEN 'all' ELSE 'none' END,
        '$.config.conversationLength', json_extract(n.value, '$.config.historyLength'),
        '$.config.workOnly', json(CASE WHEN json_extract(n.value, '$.config.returns') = 'none' THEN 'true' ELSE 'false' END)),
      '$.config.description', '$.config.attachments', '$.config.returns', '$.config.history', '$.config.historyLength')
    WHEN 'judge' THEN json_remove(n.value, '$.config.description')
    ELSE n.value
  END))
  FROM json_each(`graph`, '$.nodes') n
));
--> statement-breakpoint
UPDATE `turns` SET `state` = json_set(`state`, '$.memories', json('{}'));
