-- エージェントノードにプロバイダ欄を追加した。それ以前のグラフとターンの写しはすべて OpenRouter を使っていた
UPDATE `graphs` SET `definition` = (
	SELECT json_set(`graphs`.`definition`, '$.nodes', json_group_array(
		CASE WHEN json_extract(n.value, '$.kind') IN ('mainAgent', 'subAgent')
			THEN json_set(n.value, '$.config.provider', 'openrouter')
			ELSE json(n.value)
		END ORDER BY n.key))
	FROM json_each(`graphs`.`definition`, '$.nodes') AS n
);
--> statement-breakpoint
UPDATE `turns` SET `graph` = (
	SELECT json_set(`turns`.`graph`, '$.nodes', json_group_array(
		CASE WHEN json_extract(n.value, '$.kind') IN ('mainAgent', 'subAgent')
			THEN json_set(n.value, '$.config.provider', 'openrouter')
			ELSE json(n.value)
		END ORDER BY n.key))
	FROM json_each(`turns`.`graph`, '$.nodes') AS n
);
