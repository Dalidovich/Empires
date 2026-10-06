import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

const KEY_CODES = new Set(['Escape', 'Delete', 'Enter', 'Period', 'Pause', 'Equal', 'Minus']);

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      if (name !== '__tests__') {
        files.push(...sourceFiles(path));
      }
    } else if (name.endsWith('.ts')) {
      files.push(path);
    }
  }
  return files;
}

function isDeveloperMessage(node: ts.Node): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isNewExpression(current) && current.expression.getText() === 'Error') {
      return true;
    }
    if (ts.isCallExpression(current) && current.expression.getText().startsWith('console.')) {
      return true;
    }
  }
  return false;
}

function isModuleSpecifier(node: ts.Node): boolean {
  const parent = node.parent;
  return ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent);
}

export function looksLikeUserText(text: string): boolean {
  if (/[Ѐ-ӿ]/.test(text)) {
    return true;
  }
  if (/[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(text)) {
    return true;
  }
  return /^[A-Z][a-z]+$/.test(text) && !KEY_CODES.has(text);
}

function findings(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    const literal =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node);
    if (literal && !isModuleSpecifier(node) && !isDeveloperMessage(node) && looksLikeUserText(node.text)) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart());
      found.push(`${relative(ROOT, file)}:${line + 1}: ${node.text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('user-facing text', () => {
  it('detects text-like literals', () => {
    expect(looksLikeUserText('New game')).toBe(true);
    expect(looksLikeUserText('Save')).toBe(true);
    expect(looksLikeUserText('Привет')).toBe(true);
    expect(looksLikeUserText('ui.menu.new_game')).toBe(false);
    expect(looksLikeUserText('Escape')).toBe(false);
    expect(looksLikeUserText('input, button')).toBe(false);
  });

  it('does not appear in interface code outside the locale files', () => {
    const files = [...sourceFiles(join(ROOT, 'src', 'ui')), join(ROOT, 'src', 'main.ts')];
    expect(files.flatMap(findings)).toEqual([]);
  });

  it('does not appear in index.html', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    const text = html
      .replace(/<!doctype[^>]*>/i, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, '');
    expect(text.trim()).toBe('');
  });

  it('keeps Russian text inside ru.json only', () => {
    const files = [
      ...sourceFiles(join(ROOT, 'src')),
      join(ROOT, 'src', 'locales', 'en.json'),
      join(ROOT, 'index.html'),
    ];
    const offenders = files.filter((file) => /[Ѐ-ӿ]/.test(readFileSync(file, 'utf8')));
    expect(offenders.map((file) => relative(ROOT, file))).toEqual([]);
  });
});
