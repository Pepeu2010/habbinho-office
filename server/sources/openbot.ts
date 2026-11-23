import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { parseCharacterName } from '../../shared/appearance';
import { tr } from '../../shared/i18n';
import type { AgentStatus, RoomInfo, SourceInfo } from '../../shared/types';
import type { AccountEntry, AccountsService } from '../accounts/service';
import type { Office } from '../model/office';
import { sqliteOpener, type OpenDb, type SqliteDb } from './opencode/source';
import type { AgentSource } from './source';

interface ProfileRow {
  id: string;
  name: string | null;
  cwd: string | null;
  model: string | null;
  updated: string;
  activeStatus: string | null;
  title: string | null;
  waiting: number;
}

const PROFILES = `
select a.agent_id as id,
       json_extract(a.agent_json, '$.name') as name,
       json_extract(a.agent_json, '$.workspacePath') as cwd,
       a.model, a.updated_at as updated,
       (select t.status from projection_threads h
          join projection_turns t on t.turn_id = h.active_turn_id
          where h.agent_id = a.agent_id and t.completed_at is null
          order by t.started_at desc limit 1) as activeStatus,
       (select substr(h.title, 1, 160) from projection_threads h
          where h.agent_id = a.agent_id
          order by (h.active_turn_id is not null) desc, h.updated_at desc limit 1) as title,
       exists(select 1 from agent_waits w where w.agent_id = a.agent_id and w.woken_at is null) as waiting
  from projection_agents a
 order by a.sort_order, a.agent_id
 limit 200`;

interface OpenBotOptions {
  dbPath: string;
  cliPath?: string;
  open: OpenDb;
}

const DEPARTMENTS = new Map<string, string>([
  ['escritorconteudo', tr('Redação')],
  ['devhelper', tr('Desenvolvimento')],
  ['analistadados', tr('Análise de dados')],
  ['editorimagens', tr('Edição de imagens')],
  ['pesquisador', tr('Pesquisa')],
  ['socialbot', tr('Redes sociais')],
]);

export function openBotWorkspace(path: string, profile: string | undefined): RoomInfo['workspace'] {
  if (!/(?:^|[\\/])OpenBot[\\/]Agents[\\/]agent-[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}[\\/]*$/i.test(path)) return;
  const name = profile?.replace(/([\p{Ll}\d])([\p{Lu}])/gu, '$1 $2');
  const key = name?.normalize('NFD').replace(/[^a-z\d]/gi, '').toLowerCase();
  return { name: (key && DEPARTMENTS.get(key)) || name || tr('Sala do OpenBot'), label: 'OpenBot' };
}

/** A versão desktop 0.75 usa projeções SQLite. O envio passa pela CLI oficial, com opt-in por agente. */
export function discoverOpenBot(env: NodeJS.ProcessEnv): OpenBotOptions | undefined {
  if (env.HABBLAUD_OPENBOT === '0') return;
  const dbPath = env.HABBLAUD_OPENBOT_DB || (env.APPDATA && join(env.APPDATA, 'OpenBot', 'openbot.db'));
  if (!dbPath || !isAbsolute(dbPath) || !existsSync(dbPath)) return;
  const open = sqliteOpener();
  if (!open) return;
  const cli = env.HABBLAUD_OPENBOT_CLI || (env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs', 'OpenBot', 'resources', 'cli', 'openbot-cli.mjs'));
  return { dbPath, open, cliPath: cli && isAbsolute(cli) && existsSync(cli) ? cli : undefined };
}

interface CliResult {
  ok?: boolean;
  agents?: Array<{ id?: unknown }>;
  deliveryId?: unknown;
}

export class OpenBotSource implements AgentSource {
  readonly provider = 'openbot' as const;
  private readonly account: AccountEntry | undefined;
  private readonly profiles = new Map<string, string>();
  private reachable = new Set<string>();
  private timer?: ReturnType<typeof setInterval>;
  private db?: SqliteDb;
  private error?: string;
  private lastCli = 0;
  private generation = 0;

  constructor(private readonly opts: OpenBotOptions, accounts: AccountsService, private readonly office: Office) {
    this.account = accounts.setProviderAccounts('openbot', [{
      dir: opts.dbPath,
      detected: { id: 'openbot', provider: 'openbot', configDir: opts.dbPath, short: 'B', name: 'OpenBot', color: '#509e8e' },
    }])[0];
  }

  start(): void {
    this.office.beginBoot();
    try {
      this.poll();
    } finally {
      this.office.endBoot();
    }
    this.timer = setInterval(() => this.poll(), 2_000);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.generation++;
    this.reachable.clear();
    this.db?.close();
    this.db = undefined;
  }

  private poll(): void {
    if (!this.account) return;
    const now = Date.now();
    try {
      this.db ??= this.opts.open(this.opts.dbPath);
      const rows = this.db.prepare(PROFILES).all() as ProfileRow[];
      const seen = new Set<string>();
      for (const row of rows) {
        if (!row.id || !row.cwd || !isAbsolute(row.cwd)) continue;
        const id = `openbot:${row.id}`;
        seen.add(id);
        const status: AgentStatus = row.waiting ? 'waiting'
          : row.activeStatus && ['running', 'in_progress', 'streaming'].includes(row.activeStatus) ? 'working' : 'idle';
        const sourceName = parseCharacterName(row.name) ?? undefined;
        this.office.addMain({
          id, provider: 'openbot', account: this.account.id, cwd: row.cwd, sessionId: row.id,
          role: row.model || 'OpenBot', startedAt: Date.parse(row.updated) || now, status,
          sourceName,
          workspace: openBotWorkspace(row.cwd, sourceName),
          waitingFor: status === 'waiting' ? tr('responder no OpenBot') : undefined,
        });
        const info = this.office.get(id);
        if (info) this.office.applyTranscript(id, {
          title: row.title?.trim() || undefined,
          model: row.model || undefined,
          stats: info.stats,
          tasks: info.tasks,
          lastAt: Date.parse(row.updated) || undefined,
        });
        if (status === 'working') this.office.fillWorkingActivity(id);
        this.profiles.set(id, row.id);
      }
      for (const id of this.profiles.keys()) {
        if (seen.has(id)) continue;
        this.office.closeMain(id);
        this.profiles.delete(id);
      }
      this.error = undefined;
    } catch {
      this.error = tr('Não foi possível ler os perfis do OpenBot.');
      this.db?.close();
      this.db = undefined;
    }
    if (this.opts.cliPath && now - this.lastCli >= 12_000) {
      this.lastCli = now;
      const generation = this.generation;
      void this.cli(['list', '--json']).then((r) => {
        if (generation !== this.generation) return;
        const next = new Set((r.ok && Array.isArray(r.agents) ? r.agents : []).flatMap((agent) => typeof agent.id === 'string' ? [agent.id] : []));
        const changed = next.size !== this.reachable.size || [...next].some((id) => !this.reachable.has(id));
        this.reachable = next;
        if (changed) this.office.markDirty();
      });
    }
  }

  sources(): SourceInfo[] {
    if (!this.account) return [];
    return [{ label: this.account.id, provider: 'openbot', path: this.opts.dbPath, sessions: this.profiles.size, ok: !this.error, error: this.error }];
  }

  transcriptPathOf(): undefined {
    return undefined;
  }

  canSend(id: string): boolean {
    const profile = this.profiles.get(id);
    return !this.error && !!profile && this.reachable.has(profile);
  }

  async send(id: string, text: string, deliveryId: string): Promise<boolean> {
    const profile = this.profiles.get(id);
    if (!profile || !this.canSend(id)) return false;
    const result = await this.cli(['run', profile, '-', '--id', deliveryId, '--json'], text, 25_000);
    return result.ok === true && typeof result.deliveryId === 'string';
  }

  private cli(args: string[], input = '', timeout = 8_000): Promise<CliResult> {
    return new Promise((resolve) => {
      if (!this.opts.cliPath) return resolve({});
      const child = execFile(process.execPath, [this.opts.cliPath, ...args], {
        timeout, windowsHide: true, maxBuffer: 256 * 1024,
      }, (error, stdout) => {
        if (error) return resolve({});
        try {
          resolve(JSON.parse(stdout) as CliResult);
        } catch {
          resolve({});
        }
      });
      child.stdin?.on('error', () => {});
      child.stdin?.end(input);
    });
  }
}
