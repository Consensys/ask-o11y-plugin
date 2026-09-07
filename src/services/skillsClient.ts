import { pluginUrl } from '../utils/subpath';

/** Skill metadata as returned by GET /api/skills (bodies excluded). */
export interface SkillInfo {
  name: string;
  description: string;
  source: 'bundled' | 'custom';
  customized: boolean;
  enabled: boolean;
  hidden: boolean;
  model?: string;
  maxIterations?: number;
  triggers?: string;
  version?: string;
  hasUserPrompt: boolean;
  invalid?: boolean;
  invalidReason?: string;
  /** SKILL.md source; present only for Admin callers with ?include=content. */
  raw?: string;
}

/** A skill exposed as a `/name` slash command in the chat input. */
export interface SkillCommand {
  name: string;
  description: string;
}

const SKILLS_URL = pluginUrl('/api/skills');

export async function listSkills(): Promise<SkillInfo[]> {
  const resp = await fetch(SKILLS_URL);
  if (!resp.ok) {
    throw new Error(`Failed to list skills (${resp.status})`);
  }
  const data = (await resp.json()) as { skills?: SkillInfo[] };
  return data.skills ?? [];
}

/** Admin listing including each skill's SKILL.md source, for the AppConfig editor. */
export async function listSkillsWithContent(): Promise<SkillInfo[]> {
  const resp = await fetch(`${SKILLS_URL}?include=content`);
  if (!resp.ok) {
    throw new Error(`Failed to list skills (${resp.status})`);
  }
  const data = (await resp.json()) as { skills?: SkillInfo[] };
  return data.skills ?? [];
}

/** Pickable (enabled, public, valid) skills as slash commands. */
export function toSkillCommands(skills: SkillInfo[]): SkillCommand[] {
  return skills
    .filter((skill) => skill.enabled && !skill.hidden && !skill.invalid)
    .map((skill) => ({ name: skill.name, description: skill.description }));
}
