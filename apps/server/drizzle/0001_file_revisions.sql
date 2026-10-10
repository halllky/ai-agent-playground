CREATE TABLE `file_revisions` (
	`turn_id` text NOT NULL,
	`volume` text NOT NULL,
	`path` text NOT NULL,
	`content` text,
	`at` integer NOT NULL,
	PRIMARY KEY(`turn_id`, `volume`, `path`),
	FOREIGN KEY (`turn_id`) REFERENCES `turns`(`id`) ON UPDATE no action ON DELETE cascade
);
