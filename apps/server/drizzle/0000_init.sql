CREATE TABLE `agent_memories` (
	`turn_id` text NOT NULL,
	`memory_key` text NOT NULL,
	`messages` text NOT NULL,
	PRIMARY KEY(`turn_id`, `memory_key`),
	FOREIGN KEY (`turn_id`) REFERENCES `turns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `graphs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`definition` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `run_events` (
	`turn_id` text NOT NULL,
	`seq` integer NOT NULL,
	`event` text NOT NULL,
	PRIMARY KEY(`turn_id`, `seq`),
	FOREIGN KEY (`turn_id`) REFERENCES `turns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`graph_id` text NOT NULL,
	`active_turn_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`graph_id`) REFERENCES `graphs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `turns` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`parent_turn_id` text,
	`user_text` text NOT NULL,
	`graph` text NOT NULL,
	`status` text NOT NULL,
	`main_messages` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `turns_session_idx` ON `turns` (`session_id`);