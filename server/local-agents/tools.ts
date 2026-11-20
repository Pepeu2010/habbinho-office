// Ferramentas dos agentes locais: SÓ LEITURA e presas à pasta do projeto. Nenhuma executa comando, escreve arquivo
// ou acessa a rede. Caminhos são resolvidos com realpath (um link simbólico não escapa da pasta) e conferidos contra a
// raiz; arquivos grandes, binários e pastas de dependências ficam de fora.
import { promises as fs } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

/** Modelos locais têm contexto curto: um arquivo maior que isto chega cortado (use search para achar o resto). */
export const READ_MAX = 12 * 1024;
export const LIST_MAX = 300;
export const SEARCH_MAX = 60;
const SEARCH_FILE_MAX = 512 * 1024;
const SEARCH_FILES = 2_000;
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.venv', 'venv', '__pycache__', 'target', '.cache']);

export interface ToolSpec {
  name: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, { type: string; description: string }>; required: string[] };
}

/** Ferramentas oferecidas ao modelo (formato de function calling do Ollama/OpenAI). */
export const TOOL_SPECS: readonly ToolSpec[] = [
  {
    name: 'list_dir',
    description: 'Lista arquivos e pastas de um diretório do projeto (caminho relativo à raiz do projeto; "." é a raiz).',
    parameters: { type: 'object', properties: { path: { type: 'string', description: 'Caminho relativo à raiz do projeto.' } }, required: ['path'] },
  },
  {
    name: 'read_file',
    description: 'Lê um arquivo de texto do projeto (até 12 KB; arquivos maiores chegam cortados).',
    parameters: { type: 'object', properties: { path: { type: 'string', description: 'Caminho relativo à raiz do projeto.' } }, required: ['path'] },
  },
  {
    name: 'search',
    description: 'Procura um texto (sem regex, sem diferenciar maiúsculas) nos arquivos do projeto e devolve arquivo:linha: trecho.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Texto a procurar.' } }, required: ['query'] },
  },
];

export class ToolError extends Error {}

/** Resolve um caminho pedido pelo modelo dentro da raiz; fora dela (ou por link) é erro. */
export async function resolveInside(root: string, requested: string): Promise<string> {
  if (typeof requested !== 'string' || requested.length > 1_000 || requested.includes('\0')) throw new ToolError('caminho inválido');
  if (isAbsolute(requested)) throw new ToolError('use um caminho relativo à raiz do projeto');
  const realRoot = await fs.realpath(root);
  const target = resolve(realRoot, requested);
  let real: string;
  try {
    real = await fs.realpath(target);
  } catch {
    throw new ToolError(`não existe: ${requested}`);
  }
  const rel = relative(realRoot, real);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new ToolError('fora da pasta do projeto');
  return real;
}

function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 4096);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

export async function listDir(root: string, path: string): Promise<string> {
  const dir = await resolveInside(root, path || '.');
  const st = await fs.stat(dir);
  if (!st.isDirectory()) throw new ToolError('não é uma pasta');
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const lines = entries
    .filter((e) => !e.name.startsWith('.') || e.name === '.github')
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    .slice(0, LIST_MAX)
    .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
  return lines.length ? lines.join('\n') : '(pasta vazia)';
}

export async function readFile(root: string, path: string): Promise<string> {
  const file = await resolveInside(root, path);
  const st = await fs.stat(file);
  if (!st.isFile()) throw new ToolError('não é um arquivo');
  const fh = await fs.open(file, 'r');
  try {
    const buf = Buffer.alloc(Math.min(st.size, READ_MAX));
    await fh.read(buf, 0, buf.length, 0);
    if (looksBinary(buf)) throw new ToolError('arquivo binário');
    const text = buf.toString('utf8');
    return st.size > READ_MAX ? `${text}\n[... cortado: o arquivo tem ${st.size} bytes; use search para achar outras partes]` : text;
  } finally {
    await fh.close();
  }
}

export async function search(root: string, query: string): Promise<string> {
  if (typeof query !== 'string' || !query.trim() || query.length > 200) throw new ToolError('texto de busca inválido');
  const realRoot = await fs.realpath(root);
  const needle = query.toLowerCase();
  const out: string[] = [];
  let files = 0;
  const walk = async (dir: string): Promise<void> => {
    if (out.length >= SEARCH_MAX || files >= SEARCH_FILES) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= SEARCH_MAX || files >= SEARCH_FILES) return;
      // links simbólicos não são seguidos (poderiam sair da pasta)
      if (e.isSymbolicLink()) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) await walk(p);
        continue;
      }
      if (!e.isFile()) continue;
      files++;
      try {
        const st = await fs.stat(p);
        if (st.size > SEARCH_FILE_MAX) continue;
        const buf = await fs.readFile(p);
        if (looksBinary(buf)) continue;
        const lines = buf.toString('utf8').split(/\r?\n/);
        for (let i = 0; i < lines.length && out.length < SEARCH_MAX; i++) {
          if (lines[i]!.toLowerCase().includes(needle)) out.push(`${relative(realRoot, p).split(sep).join('/')}:${i + 1}: ${lines[i]!.trim().slice(0, 200)}`);
        }
      } catch {
        // arquivo sumiu ou sem permissão: segue
      }
    }
  };
  await walk(realRoot);
  return out.length ? out.join('\n') : 'nada encontrado';
}

/** Executa uma ferramenta pedida pelo modelo. Erros viram texto para o modelo (não derrubam a sessão). */
export async function runTool(root: string, name: string, args: Record<string, unknown>): Promise<{ ok: boolean; output: string }> {
  try {
    switch (name) {
      case 'list_dir':
        return { ok: true, output: await listDir(root, String(args.path ?? '.')) };
      case 'read_file':
        return { ok: true, output: await readFile(root, String(args.path ?? '')) };
      case 'search':
        return { ok: true, output: await search(root, String(args.query ?? '')) };
      default:
        return { ok: false, output: `ferramenta desconhecida: ${name}` };
    }
  } catch (err) {
    return { ok: false, output: err instanceof ToolError ? err.message : `erro: ${(err as Error).message}` };
  }
}
