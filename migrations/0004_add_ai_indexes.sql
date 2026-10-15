-- 0004: indexes for the access paths the AI tools use.
--
-- Additive and idempotent: every statement is `IF NOT EXISTS`, no table is
-- created or altered and no row is touched, so this is safe to apply to a
-- database that already holds data (including one where 0002/0003 were applied
-- by hand and are therefore absent from `d1_migrations`).
--
-- 0001 indexed `scheduled_date`, `completed` and `priority` separately. The
-- queries the agent actually runs filter on two columns at once
-- (`scheduled_date = ? AND completed = 0` for today/next-task reads, and
-- `project_id = ?` plus a date range for project task lists), which a
-- single-column index cannot serve as well.

CREATE INDEX IF NOT EXISTS idx_tasks_date_completed ON tasks(scheduled_date, completed);
CREATE INDEX IF NOT EXISTS idx_tasks_project_date ON tasks(project_id, scheduled_date);

-- Project and goal names are resolved case-insensitively by the AI tools, and a
-- name lookup must not depend on a table scan.
CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name COLLATE NOCASE);

-- Active-goal planning reads filter on status and order by target date.
CREATE INDEX IF NOT EXISTS idx_goals_status_target ON goals(status, target_date);
