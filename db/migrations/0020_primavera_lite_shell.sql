CREATE TABLE "gantt_activities" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"wbs_node_id" integer NOT NULL,
	"frontend_activity_uid" varchar(64),
	"activity_id" varchar(100),
	"activity_name" varchar(500) NOT NULL,
	"activity_type" varchar(20) DEFAULT 'task' NOT NULL,
	"calendar_id" integer,
	"original_duration_days" integer DEFAULT 0 NOT NULL,
	"remaining_duration_days" integer DEFAULT 0 NOT NULL,
	"planned_start" date,
	"planned_finish" date,
	"early_start" date,
	"early_finish" date,
	"late_start" date,
	"late_finish" date,
	"total_float_days" integer DEFAULT 0 NOT NULL,
	"free_float_days" integer DEFAULT 0 NOT NULL,
	"actual_start" date,
	"actual_finish" date,
	"percent_complete" integer DEFAULT 0 NOT NULL,
	"status" varchar(50),
	"constraint_type" varchar(20),
	"constraint_date" date,
	"notes" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_by_name" varchar(255),
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "gantt_activities_frontend_activity_uid_unique" UNIQUE("frontend_activity_uid")
);
--> statement-breakpoint
CREATE TABLE "gantt_wbs_nodes" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"parent_node_id" integer,
	"code" varchar(100) NOT NULL,
	"name" varchar(500) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_leaf" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "gantt_projects" ADD COLUMN "admin_token_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "gantt_projects" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gantt_activities" ADD CONSTRAINT "gantt_activities_project_id_gantt_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."gantt_projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gantt_activities" ADD CONSTRAINT "gantt_activities_wbs_node_id_gantt_wbs_nodes_id_fk" FOREIGN KEY ("wbs_node_id") REFERENCES "public"."gantt_wbs_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gantt_activities" ADD CONSTRAINT "gantt_activities_calendar_id_gantt_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."gantt_calendars"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gantt_wbs_nodes" ADD CONSTRAINT "gantt_wbs_nodes_project_id_gantt_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."gantt_projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gantt_wbs_nodes" ADD CONSTRAINT "gantt_wbs_nodes_parent_node_id_gantt_wbs_nodes_id_fk" FOREIGN KEY ("parent_node_id") REFERENCES "public"."gantt_wbs_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gantt_activities_project_idx" ON "gantt_activities" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "gantt_activities_wbs_idx" ON "gantt_activities" USING btree ("project_id","wbs_node_id");--> statement-breakpoint
CREATE INDEX "gantt_activities_uid_idx" ON "gantt_activities" USING btree ("frontend_activity_uid");--> statement-breakpoint
CREATE INDEX "gantt_wbs_nodes_project_idx" ON "gantt_wbs_nodes" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "gantt_wbs_nodes_parent_idx" ON "gantt_wbs_nodes" USING btree ("project_id","parent_node_id");--> statement-breakpoint
CREATE INDEX "gantt_wbs_nodes_sort_idx" ON "gantt_wbs_nodes" USING btree ("project_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "gantt_wbs_nodes_project_code_unique" ON "gantt_wbs_nodes" USING btree ("project_id","code") WHERE "gantt_wbs_nodes"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "gantt_projects_admin_token_idx" ON "gantt_projects" USING btree ("admin_token_hash");