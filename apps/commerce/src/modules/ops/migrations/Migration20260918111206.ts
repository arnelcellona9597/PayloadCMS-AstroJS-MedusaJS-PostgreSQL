import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260918111206 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "uptime_check" ("id" text not null, "target" text not null, "url" text not null, "ok" boolean not null, "status_code" integer null, "latency_ms" integer not null, "error" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "uptime_check_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_uptime_check_deleted_at" ON "uptime_check" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_uptime_check_target_created_at" ON "uptime_check" ("target", "created_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "uptime_check" cascade;`);
  }

}
