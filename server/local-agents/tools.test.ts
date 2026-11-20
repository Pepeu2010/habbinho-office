import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { READ_MAX, runTool } from './tools';

const base = mkdtempSync(join(tmpdir(), 'hb-local-tools-'));
const root = join(base, 'proj');
const outside = join(base, 'segredo');
mkdirSync(join(root, 'src'), { recursive: true });
mkdirSync(join(root, 'node_modules', 'x'), { recursive: true });
mkdirSync(outside);
writeFileSync(join(root, 'README.md'), '# Projeto\nUse o comando habblaud.\n');
writeFileSync(join(root, 'src', 'app.ts'), 'export const Habblaud = 1;\n');
writeFileSync(join(root, 'node_modules', 'x', 'index.js'), 'habblaud dentro de dependência\n');
writeFileSync(join(root, 'big.txt'), 'a'.repeat(READ_MAX + 10));
writeFileSync(join(root, 'bin.dat'), Buffer.from([1, 0, 2, 3]));
writeFileSync(join(outside, 'senha.txt'), 'hunter2');
let linked = false;
try {
  symlinkSync(outside, join(root, 'atalho'), 'junction');
  linked = true;
} catch {
  // sem permissão para criar links neste sistema: o teste do link é pulado
}
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe('ferramentas dos agentes locais', () => {
  it('lista e lê dentro do projeto', async () => {
    expect((await runTool(root, 'list_dir', { path: '.' })).output).toContain('src/');
    expect((await runTool(root, 'read_file', { path: 'README.md' })).output).toContain('# Projeto');
  });

  it('não sai da pasta: .., caminho absoluto e link simbólico', async () => {
    expect(await runTool(root, 'read_file', { path: '../segredo/senha.txt' })).toEqual({ ok: false, output: 'fora da pasta do projeto' });
    expect((await runTool(root, 'read_file', { path: join(outside, 'senha.txt') })).ok).toBe(false);
    if (linked) expect(await runTool(root, 'read_file', { path: 'atalho/senha.txt' })).toEqual({ ok: false, output: 'fora da pasta do projeto' });
  });

  it('corta arquivo grande e recusa binário', async () => {
    const big = await runTool(root, 'read_file', { path: 'big.txt' });
    expect(big.ok).toBe(true);
    expect(big.output).toContain('cortado');
    expect((await runTool(root, 'read_file', { path: 'bin.dat' })).output).toBe('arquivo binário');
  });

  it('busca sem entrar em node_modules nem seguir links', async () => {
    const r = await runTool(root, 'search', { query: 'HABBLAUD' });
    expect(r.output).toContain('README.md:2:');
    expect(r.output).toContain('src/app.ts:1:');
    expect(r.output).not.toContain('node_modules');
    expect(r.output).not.toContain('hunter2');
  });

  it('ferramenta desconhecida não executa nada', async () => {
    expect(await runTool(root, 'run_shell', { command: 'rm -rf /' })).toEqual({ ok: false, output: 'ferramenta desconhecida: run_shell' });
  });
});
