CREATE TABLE "gantt_activity_dependencies" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"predecessor_activity_id" integer NOT NULL,
	"successor_activity_id" integer NOT NULL,
	"dependency_type" varchar(10) DEFAULT 'FS' NOT NULL,
	"lag_days" integer DEFAULT 0 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_by_name" varchar(255),
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "gantt_activity_dependencies" ADD CONSTRAINT "gantt_activity_dependencies_project_id_gantt_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."gantt_projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gantt_activity_dependencies" ADD CONSTRAINT "gantt_activity_dependencies_predecessor_activity_id_gantt_activities_id_fk" FOREIGN KEY ("predecessor_activity_id") REFERENCES "public"."gantt_activities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gantt_activity_dependencies" ADD CONSTRAINT "gantt_activity_dependencies_successor_activity_id_gantt_activities_id_fk" FOREIGN KEY ("successor_activity_id") REFERENCES "public"."gantt_activities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gantt_activity_dependencies_project_idx" ON "gantt_activity_dependencies" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "gantt_activity_dependencies_pred_idx" ON "gantt_activity_dependencies" USING btree ("project_id","predecessor_activity_id");--> statement-breakpoint
CREATE INDEX "gantt_activity_dependencies_succ_idx" ON "gantt_activity_dependencies" USING btree ("project_id","successor_activity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gantt_activity_dependencies_active_unique" ON "gantt_activity_dependencies" USING btree ("project_id","predecessor_activity_id","successor_activity_id","dependency_type","lag_days") WHERE "gantt_activity_dependencies"."archived_at" IS NULL;