import type { Container } from '../../platform/container.js';
import type { Tokenizer } from '../../adapters/tokenizer/index.js';
import type {
  Skill,
  SkillImportPreview,
  SkillListItem,
  SkillStats,
  SkillType,
  SkillVersionEntry,
} from '@devdigest/shared';
import { AppError } from '../../platform/errors.js';
import { RESTORE_NOTE_PREFIX } from './constants.js';
import { toSkillDto, toVersionEntries } from './helpers.js';
import { parseSkillImport } from './import.js';
import { SkillsRepository, type ListSkillsFilter, type SkillFields } from './repository.js';
import { SkillStatsRepository } from './repository/stats.repo.js';
import { toCardStats, toSkillStats, statsWindowStart, type CardStats } from './stats.js';

/**
 * Ring 1 — skills use cases: versioning on body change, restore-as-new-version, import,
 * exact token counts. Dependencies are resolved once, in the constructor.
 */

export interface CreateSkillInput {
  name: string;
  description: string;
  type: SkillType;
  body: string;
  enabled?: boolean;
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
  note?: string;
}

export interface ConfirmImportInput {
  name: string;
  description: string;
  type: SkillType;
  body: string;
}

export interface SkillVersionDetail extends SkillVersionEntry {
  body: string;
}

export class SkillsService {
  private repo: SkillsRepository;
  private statsRepo: SkillStatsRepository;
  private tokenizer: Tokenizer;

  constructor(container: Container) {
    this.repo = new SkillsRepository(container.db);
    this.statsRepo = new SkillStatsRepository(container.db);
    this.tokenizer = container.tokenizer;
  }

  async list(workspaceId: string, filter: ListSkillsFilter): Promise<SkillListItem[]> {
    const rows = await this.repo.list(workspaceId, filter);
    const stats = await this.cardStats(
      workspaceId,
      rows.map((r) => r.id),
    );
    return rows.map((row) => ({ ...toSkillDto(row), ...stats.get(row.id)! }));
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toSkillDto(row, this.countTokens(row.body)) : undefined;
  }

  async create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      type: input.type,
      source: 'manual',
      body: input.body,
      enabled: input.enabled ?? true,
    });
    return toSkillDto(row, this.countTokens(row.body));
  }

  /**
   * A body change snapshots the previous body at the previous version (with the note) and
   * bumps the version; a change to anything else never does.
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkillInput,
  ): Promise<Skill | undefined> {
    const { note, body, ...rest } = patch;
    const metadata: SkillFields = Object.fromEntries(
      Object.entries(rest).filter(([, v]) => v !== undefined),
    );
    const row = await this.repo.update(workspaceId, id, (current) =>
      body !== undefined && body !== current.body
        ? { fields: { ...metadata, body }, snapshot: { note: note?.trim() || null } }
        : { fields: metadata },
    );
    return row ? toSkillDto(row, this.countTokens(row.body)) : undefined;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  /** History newest first, current version included. Undefined when not in this workspace. */
  async listVersions(workspaceId: string, id: string): Promise<SkillVersionEntry[] | undefined> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    return toVersionEntries(skill, await this.repo.listSnapshots(id));
  }

  /** One version with its body. The current version is served from `skills` itself. */
  async getVersion(
    workspaceId: string,
    id: string,
    version: number,
  ): Promise<SkillVersionDetail | undefined> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    const snapshots = await this.repo.listSnapshots(id);
    const entry = toVersionEntries(skill, snapshots).find((e) => e.version === version);
    if (!entry) return undefined;
    const body = entry.is_current
      ? skill.body
      : snapshots.find((s) => s.version === version)!.body;
    return { ...entry, body };
  }

  /**
   * Make an old body current the way an edit does: the current body is snapshotted, the
   * version is bumped, history is never rewritten (v5 restored from v3 becomes v6).
   */
  async restore(workspaceId: string, id: string, version: number): Promise<Skill | undefined> {
    const target = await this.getVersion(workspaceId, id, version);
    if (!target) return undefined;
    if (target.is_current) {
      throw new AppError('conflict', `v${version} is already the current version.`, 409);
    }
    const row = await this.repo.update(workspaceId, id, () => ({
      fields: { body: target.body },
      snapshot: { note: `${RESTORE_NOTE_PREFIX}${version}` },
    }));
    return row ? toSkillDto(row, this.countTokens(row.body)) : undefined;
  }

  /** Exact token count of an unsaved body; `null` (never a throw) when the tokenizer fails. */
  tokens(body: string): number | null {
    return this.countTokens(body);
  }

  /** Decode and parse an upload into a preview. Writes nothing. */
  previewImport(filename: string, contentBase64: string): SkillImportPreview {
    const result = parseSkillImport(new Uint8Array(Buffer.from(contentBase64, 'base64')), filename);
    if (!result.ok) throw new AppError('import_rejected', result.error.message, 400);
    return result.preview;
  }

  /** Create from the confirmed (possibly edited) preview: inert until the user enables it. */
  async confirmImport(workspaceId: string, input: ConfirmImportInput): Promise<Skill> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      type: input.type,
      source: 'imported_file',
      body: input.body,
      enabled: false,
    });
    return toSkillDto(row, this.countTokens(row.body));
  }

  private countTokens(text: string): number | null {
    try {
      return this.tokenizer.count(text);
    } catch {
      return null;
    }
  }

  /** `GET /skills/:id/stats`; semantics in `stats.ts`. Undefined when not in this workspace. */
  async stats(workspaceId: string, id: string): Promise<SkillStats | undefined> {
    if (!(await this.repo.getById(workspaceId, id))) return undefined;
    const since = statsWindowStart();
    const [agents, aggregates, categories] = await Promise.all([
      this.statsRepo.linkedAgents(workspaceId, id),
      this.statsRepo.runAggregates(workspaceId, [id], since),
      this.statsRepo.categoryCounts(workspaceId, id, since),
    ]);
    return toSkillStats(agents, aggregates.get(id), categories);
  }

  /** The card footer of every listed skill: two grouped queries, never one per card. */
  private async cardStats(workspaceId: string, skillIds: string[]): Promise<Map<string, CardStats>> {
    const [agentCounts, aggregates] = await Promise.all([
      this.statsRepo.agentCounts(workspaceId, skillIds),
      this.statsRepo.runAggregates(workspaceId, skillIds, statsWindowStart()),
    ]);
    return new Map(
      skillIds.map((id) => [id, toCardStats(agentCounts.get(id) ?? 0, aggregates.get(id))]),
    );
  }
}
