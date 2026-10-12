-- セッションごとに持っていたグラフを graphs テーブルに分け、セッションは graph_id でグラフに属するようにする。
-- 既存のセッションのグラフは、セッションと同じ id・セッションのタイトルを名前にしたグラフとして移す。
-- sessions を作り直す間に turns が cascade で消えないよう、foreign_keys を OFF にした接続で適用すること
CREATE TABLE `graphs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`definition` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `graphs` (`id`, `name`, `definition`, `created_at`) SELECT `id`, `title`, `graph`, `created_at` FROM `sessions`;
--> statement-breakpoint
CREATE TABLE `__new_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`graph_id` text NOT NULL,
	`title` text NOT NULL,
	`active_turn_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`graph_id`) REFERENCES `graphs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_sessions` (`id`, `graph_id`, `title`, `active_turn_id`, `created_at`) SELECT `id`, `id`, `title`, `active_turn_id`, `created_at` FROM `sessions`;
--> statement-breakpoint
DROP TABLE `sessions`;
--> statement-breakpoint
ALTER TABLE `__new_sessions` RENAME TO `sessions`;
--> statement-breakpoint
CREATE INDEX `sessions_graph_idx` ON `sessions` (`graph_id`);
