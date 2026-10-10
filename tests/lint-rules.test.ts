import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint();

async function restricted(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? [])
    .filter((m) => m.ruleId === 'no-restricted-properties' || m.ruleId === 'no-restricted-syntax')
    .map((m) => m.message);
}

describe('determinism lint rules', () => {
  it('bans Math.random outside rng.ts', async () => {
    expect(await restricted('export const x = Math.random();\n', 'src/app/x.ts')).toHaveLength(1);
    expect(await restricted('export const x = Math.random();\n', 'src/world/x.ts')).toHaveLength(1);
  });

  it('allows Math.random in rng.ts', async () => {
    expect(await restricted('export const x = Math.random();\n', 'src/core/rng.ts')).toEqual([]);
  });

  it('bans clock reads in world and styles', async () => {
    const code =
      'export const a = Date.now();\nexport const b = performance.now();\nexport const c = new Date();\n';
    expect(await restricted(code, 'src/world/x.ts')).toHaveLength(3);
    expect(await restricted(code, 'src/styles/ink/x.ts')).toHaveLength(3);
  });

  it('allows clock reads in the app and render layers', async () => {
    const code = 'export const a = Date.now();\nexport const b = performance.now();\n';
    expect(await restricted(code, 'src/app/x.ts')).toEqual([]);
    expect(await restricted(code, 'src/render/x.ts')).toEqual([]);
  });
});
