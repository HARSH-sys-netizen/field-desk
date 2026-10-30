CREATE TABLE `payment_transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`from_receipt_id` text NOT NULL,
	`to_receipt_id` text NOT NULL,
	`from_customer_id` text NOT NULL,
	`to_customer_id` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`reason` text NOT NULL,
	`action_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`from_receipt_id`) REFERENCES `payment_receipts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_receipt_id`) REFERENCES `payment_receipts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "payment_transfers_amount_paise_check" CHECK(typeof("payment_transfers"."amount_paise") = 'integer' and "payment_transfers"."amount_paise" > 0),
	CONSTRAINT "payment_transfers_distinct_customers_check" CHECK("payment_transfers"."from_customer_id" <> "payment_transfers"."to_customer_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_transfers_from_receipt_idx` ON `payment_transfers` (`from_receipt_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_transfers_to_receipt_idx` ON `payment_transfers` (`to_receipt_id`);--> statement-breakpoint
CREATE INDEX `payment_transfers_from_customer_idx` ON `payment_transfers` (`from_customer_id`);--> statement-breakpoint
CREATE INDEX `payment_transfers_to_customer_idx` ON `payment_transfers` (`to_customer_id`);