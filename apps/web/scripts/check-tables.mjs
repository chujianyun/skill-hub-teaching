import ts from 'typescript';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Discover Ant Design Table imports in every source file. Unresolvable columns fail closed.
function inspect(source, file = 'fixture.tsx') {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const aliases = new Set(); const errors = [];
  for (const n of ast.statements) if (ts.isImportDeclaration(n) && n.moduleSpecifier.text === 'antd') {
    const bindings = n.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) for (const e of bindings.elements) if ((e.propertyName ?? e.name).text === 'Table') aliases.add(e.name.text);
  }
  function property(node, key) {
    return node.properties?.find((p) => ts.isPropertyAssignment(p) && p.name.getText(ast).replace(/['"]/g, '') === key)?.initializer;
  }
  function flatten(n) {
    if (ts.isParenthesizedExpression(n) || ts.isSpreadElement(n)) return flatten(n.expression);
    if (ts.isConditionalExpression(n)) return [...flatten(n.whenTrue), ...flatten(n.whenFalse)];
    if (ts.isArrayLiteralExpression(n)) return n.elements.flatMap(flatten);
    return [n];
  }
  function visit(n) {
    if ((ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && aliases.has(n.tagName.getText(ast))) {
      const attributes = n.attributes.properties;
      const attr = (name) => attributes.find((a) => ts.isJsxAttribute(a) && a.name.text === name)?.initializer?.expression;
      const scroll = attr('scroll');
      if (scroll && (!ts.isObjectLiteralExpression(scroll) || property(scroll, 'x'))) {
        const columns = attr('columns');
        if (!columns || !ts.isArrayLiteralExpression(columns)) errors.push(`${file}: columns must be statically inspectable for horizontal tables`);
        else for (const col of flatten(columns)) {
          if (!ts.isObjectLiteralExpression(col)) { errors.push(`${file}: cannot inspect a dynamic column`); continue; }
          if (['action', 'actions', 'operation', 'operations', 'option', 'options'].includes(property(col, 'key')?.text) || property(col, 'title')?.text === '操作') {
            if (property(col, 'fixed')?.text !== 'right') errors.push(`${file}:${ast.getLineAndCharacterOfPosition(col.pos).line + 1}: 操作列必须 fixed: 'right'`);
          }
        }
      }
    }
    ts.forEachChild(n, visit);
  }
  visit(ast); return errors;
}
const good = `import {Table} from 'antd'; const x = <Table scroll={{x:900}} columns={[{title:'操作',key:'actions',fixed:'right'}]}/>;`;
if (process.argv.includes('--negative-fixture')) {
  const errors = inspect(good.replace(",fixed:'right'", ''));
  console.error(errors.join('\n')); process.exit(errors.length ? 1 : 0);
}
if (process.argv.includes('--self-test')) {
  if (inspect(good).length) process.exit(1);
  const result = spawnSync(process.execPath, [import.meta.filename, '--negative-fixture'], { encoding: 'utf8' });
  if (result.status !== 1 || !result.stderr.includes('操作列必须')) process.exit(1);
  console.log('Guard self-test: valid configuration passed; missing fixed column rejected (exit 1).');
}
function files(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? files(join(dir, e.name)) : /\.[jt]sx?$/.test(e.name) ? [join(dir, e.name)] : []); }
const errors = files('src').flatMap((p) => inspect(readFileSync(p, 'utf8'), p));
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('Table column gate passed for all source files.');
