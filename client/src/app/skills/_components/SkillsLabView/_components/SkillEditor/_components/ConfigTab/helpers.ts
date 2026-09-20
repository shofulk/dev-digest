import type { Skill, SkillType } from "@devdigest/shared";
import type { UpdateSkillInput } from "@/lib/hooks/skills";

/** The editable fields of the Config form. */
export interface SkillForm {
  name: string;
  description: string;
  type: SkillType;
  body: string;
}

export function formFromSkill(skill: Skill, body: string = skill.body): SkillForm {
  return { name: skill.name, description: skill.description, type: skill.type, body };
}

/** The body is compared verbatim: whitespace in a rubric is content. */
export function isBodyDirty(form: SkillForm, skill: Skill): boolean {
  return form.body !== skill.body;
}

/** Name and description are trimmed on save, so trailing whitespace alone is not a change. */
export function isDirty(form: SkillForm, skill: Skill): boolean {
  return (
    isBodyDirty(form, skill) ||
    form.name.trim() !== skill.name ||
    form.description.trim() !== skill.description ||
    form.type !== skill.type
  );
}

/** A skill needs a name and a body to be saved. */
export function isValid(form: SkillForm): boolean {
  return form.name.trim().length > 0 && form.body.trim().length > 0;
}

/** Only the fields that changed — a metadata-only save must not carry `body`, or it would version. */
export function buildPatch(form: SkillForm, skill: Skill): UpdateSkillInput["patch"] {
  const patch: UpdateSkillInput["patch"] = {};
  if (form.name.trim() !== skill.name) patch.name = form.name.trim();
  if (form.description.trim() !== skill.description) patch.description = form.description.trim();
  if (form.type !== skill.type) patch.type = form.type;
  if (isBodyDirty(form, skill)) patch.body = form.body;
  return patch;
}
