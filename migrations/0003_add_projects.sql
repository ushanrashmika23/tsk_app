CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    color TEXT,
    status TEXT DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

ALTER TABLE tasks ADD COLUMN project_id TEXT REFERENCES projects(id);
CREATE INDEX idx_tasks_project_id ON tasks(project_id);
