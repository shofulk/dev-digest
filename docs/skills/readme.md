# Demo skill archives

`flaky-test-patterns.zip` is a skill archive for the live import demo in the Skills Lab
(Add Skill, Import from file). It is deliberately **not** seeded: it is imported through the
UI so the import preview has something to show.

What the preview does with each entry:

| Entry | Role |
|-------|------|
| `SKILL.md` | The core. Its front matter gives the skill's `name` and `description`; the body becomes the skill body. |
| `install.sh` | Ignored (`executable`). Listed in the preview, never read and never run. |
| `assets/logo.png` | Ignored (binary). Listed in the preview, never read. |

The skill is imported with `source: imported_file` and **disabled**; enable it after reading
the previewed body, then link it to Test Quality Reviewer.
