CREATE TABLE `expense_participants` (
	`expense_id` integer NOT NULL,
	`person_id` integer NOT NULL,
	`group_id` text NOT NULL,
	PRIMARY KEY(`expense_id`, `person_id`),
	FOREIGN KEY (`expense_id`) REFERENCES `expenses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_expense_participants_group` ON `expense_participants` (`group_id`,`expense_id`);--> statement-breakpoint
INSERT OR IGNORE INTO `expense_participants` (`expense_id`, `person_id`, `group_id`)
SELECT e.id, p.id, e.group_id FROM `expenses` e JOIN `people` p ON p.group_id = e.group_id;--> statement-breakpoint
PRAGMA optimize;
