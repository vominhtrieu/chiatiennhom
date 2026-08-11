CREATE INDEX `idx_expenses_group_person` ON `expenses` (`group_id`,`person_id`);--> statement-breakpoint
CREATE INDEX `idx_people_group_sort` ON `people` (`group_id`,`sort_order`);--> statement-breakpoint
PRAGMA optimize;
