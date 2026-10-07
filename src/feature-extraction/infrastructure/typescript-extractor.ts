import ts from "typescript";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  ExtractionRefusal,
  type ArchitecturalAssumption,
  type DependencyEdge,
  type ExtractedSymbol,
  type ExtractFeatureOptions,
  type Manifest,
} from "../domain/entities/index.js";

type Unit = ts.FunctionDeclaration | ts.InterfaceDeclaration | ts.TypeAliasDeclaration | ts.VariableDeclaration;
const compilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  skipLibCheck: true,
  noEmit: true,
  types: [],
  lib: ["lib.es2022.d.ts"],
};
const standardGlobals = new Set([
  "Date", "RegExp", "Math", "Number", "String", "Boolean", "BigInt", "Symbol",
  "Object", "Array", "Error", "TypeError", "RangeError", "SyntaxError", "JSON",
  "parseInt", "parseFloat", "isNaN", "isFinite", "NaN", "Infinity", "undefined",
  "Map", "Set", "ReadonlyMap", "ReadonlySet", "ReadonlyArray", "Partial", "Required",
  "Pick", "Omit", "Record", "Exclude", "Extract", "NonNullable", "Parameters",
  "ConstructorParameters", "ReturnType", "InstanceType", "Awaited", "Promise",
  "PropertyKey", "ThisType", "Uppercase", "Lowercase", "Capitalize", "Uncapitalize",
]);
const readonlyMethods = new Set([
  "test", "exec", "includes", "indexOf", "lastIndexOf", "slice", "join", "concat",
  "at", "every", "some", "find", "findIndex", "filter", "map", "reduce", "reduceRight",
  "toString", "valueOf", "has", "get", "entries", "keys", "values", "split", "match",
  "matchAll", "search", "replace", "replaceAll", "startsWith", "endsWith", "substring", "substr",
]);
const pureMathMethods = new Set([
  "abs", "acos", "acosh", "asin", "asinh", "atan", "atanh", "atan2", "cbrt", "ceil",
  "clz32", "cos", "cosh", "exp", "expm1", "floor", "fround", "hypot", "imul", "log",
  "log1p", "log2", "log10", "max", "min", "pow", "round", "sign", "sin", "sinh",
  "sqrt", "tan", "tanh", "trunc",
]);

function refusal(code: string, detail: string): never {
  throw new ExtractionRefusal(code, detail);
}
function hash(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}
function portable(file: string): string { return file.split(path.sep).join("/"); }
function contained(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
function pathPresent(file: string): boolean {
  try { fs.lstatSync(file); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
function futureRealPath(file: string): string {
  let parent = path.resolve(file);
  const suffix: string[] = [];
  while (!fs.existsSync(parent)) {
    suffix.unshift(path.basename(parent));
    const next = path.dirname(parent);
    if (next === parent) refusal("OUTPUT_PATH", "Cannot resolve output parent");
    parent = next;
  }
  return path.join(fs.realpathSync(parent), ...suffix);
}
function lines(text: string): number { return text.split(/\r?\n/).length; }
function isUnit(node: ts.Node): node is Unit {
  return ts.isFunctionDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) ||
    (ts.isVariableDeclaration(node) && ts.isVariableDeclarationList(node.parent) && ts.isVariableStatement(node.parent.parent));
}
function unitForDeclaration(declaration: ts.Declaration): Unit | undefined {
  if (isUnit(declaration) && (ts.isVariableDeclaration(declaration)
    ? ts.isSourceFile(declaration.parent.parent.parent)
    : ts.isSourceFile(declaration.parent))) return declaration;
  return undefined;
}
function importOf(node: ts.Node): ts.ImportDeclaration | undefined {
  let current: ts.Node | undefined = node;
  while (current && !ts.isSourceFile(current)) {
    if (ts.isImportDeclaration(current)) return current;
    current = current.parent;
  }
  return undefined;
}
function inType(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current && !isUnit(current) && !ts.isStatement(current)) {
    if (ts.isTypeNode(current)) return true;
    current = current.parent;
  }
  return false;
}
function rootIdentifier(node: ts.Expression): ts.Identifier | undefined {
  if (ts.isIdentifier(node)) return node;
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) return rootIdentifier(node.expression);
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) return rootIdentifier(node.expression);
  return undefined;
}

/** Extract a statically closed named feature without loading or executing donor code. */
export function extractFeature(options: ExtractFeatureOptions): Manifest {
  if (!options.exportName || options.exportName === "default") refusal("ENTRY_EXPORT", "Select an explicit named export");
  const sourceRoot = fs.realpathSync(path.resolve(options.sourceRoot));
  const entryCandidate = path.resolve(sourceRoot, options.entryFile);
  if (!contained(sourceRoot, entryCandidate)) refusal("PATH_ESCAPE", "Entry file escapes sourceRoot");
  const entryFile = fs.realpathSync(entryCandidate);
  if (!contained(sourceRoot, entryFile)) refusal("PATH_ESCAPE", "Entry symlink escapes sourceRoot");
  if (!entryFile.endsWith(".ts") || entryFile.endsWith(".d.ts")) refusal("SOURCE_LANGUAGE", "The first proof accepts TypeScript source modules");
  const outDir = futureRealPath(options.outDir);
  if (contained(sourceRoot, outDir) || contained(outDir, sourceRoot)) refusal("OUTPUT_OVERLAP", "Output and sourceRoot must not overlap");
  if (pathPresent(outDir)) refusal("OUTPUT_EXISTS", "Output path already exists; select a fresh directory");

  const program = ts.createProgram([entryFile], compilerOptions);
  const checker = program.getTypeChecker();
  const selected = new Set<Unit>();
  const reached = new Set<ts.SourceFile>();
  const validated = new Set<ts.SourceFile>();
  const imports = new Set<ts.ImportSpecifier>();
  const exports = new Set<ts.ExportSpecifier>();
  const edges = new Map<string, DependencyEdge>();
  const assumptions = new Map<string, ArchitecturalAssumption>();
  const queue: Unit[] = [];

  const relative = (file: ts.SourceFile) => portable(path.relative(sourceRoot, fs.realpathSync(file.fileName)));
  const location = (node: ts.Node) => ({ file: relative(node.getSourceFile()), line: node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1 });
  const failAt = (code: string, message: string, node: ts.Node): never => {
    const where = location(node);
    return refusal(code, `${where.file}:${where.line}: ${message}`);
  };
  const assume = (kind: string, detail: string, node?: ts.Node) => {
    const value = { kind, detail, ...(node ? location(node) : {}) };
    const key = `${kind}:${value.file ?? ""}:${detail}`;
    if (!assumptions.has(key)) assumptions.set(key, value);
  };
  const info = (unit: Unit): ExtractedSymbol => {
    const file = unit.getSourceFile();
    const name = unit.name?.getText(file) ?? "<anonymous>";
    const startLine = file.getLineAndCharacterOfPosition(unit.getStart(file)).line + 1;
    const endLine = file.getLineAndCharacterOfPosition(unit.getEnd()).line + 1;
    return { id: `${relative(file)}#${name}@${startLine}`, file: relative(file), name, startLine, endLine, kind: ts.SyntaxKind[unit.kind] };
  };
  const originalSymbol = (identifier: ts.Identifier): ts.Symbol | undefined => {
    const symbol = checker.getSymbolAtLocation(identifier);
    return symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  };
  const librarySymbol = (node: ts.Node): boolean => {
    const declarations = checker.getSymbolAtLocation(node)?.declarations ?? [];
    return declarations.length > 0 && declarations.every(d => program.isSourceFileDefaultLibrary(d.getSourceFile()));
  };
  const moduleGlobal = (identifier: ts.Identifier, seen = new Set<ts.Symbol>()): boolean => {
    const symbol = originalSymbol(identifier);
    if (!symbol || seen.has(symbol)) return false;
    seen.add(symbol);
    return symbol.declarations?.some(declaration => {
      if (program.isSourceFileDefaultLibrary(declaration.getSourceFile())) return false;
      if (unitForDeclaration(declaration)) return true;
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        const alias = rootIdentifier(declaration.initializer);
        return !!alias && moduleGlobal(alias, seen);
      }
      return false;
    }) ?? false;
  };

  const moduleFor = (declaration: ts.ImportDeclaration | ts.ExportDeclaration): ts.SourceFile => {
    if (!declaration.moduleSpecifier || !ts.isStringLiteral(declaration.moduleSpecifier)) failAt("MODULE_SPECIFIER", "Only static module strings are supported", declaration);
    const specifier = (declaration.moduleSpecifier as ts.StringLiteral).text;
    if (!specifier.startsWith(".")) failAt("EXTERNAL_DEPENDENCY", `Package or absolute dependency ${specifier} needs an explicit interface`, declaration);
    const resolved = ts.resolveModuleName(specifier, declaration.getSourceFile().fileName, compilerOptions, ts.sys).resolvedModule;
    if (!resolved) failAt("UNRESOLVED_IMPORT", `Cannot resolve ${specifier}`, declaration);
    const filename = fs.realpathSync(resolved!.resolvedFileName);
    if (!contained(sourceRoot, filename)) failAt("PATH_ESCAPE", `Dependency ${specifier} escapes sourceRoot, including symlinks`, declaration);
    if (filename.endsWith(".d.ts") || !filename.endsWith(".ts")) failAt("SOURCE_LANGUAGE", `Dependency ${specifier} is not a TypeScript source module`, declaration);
    const file = program.getSourceFile(resolved!.resolvedFileName) ?? program.getSourceFile(filename);
    if (!file) failAt("UNRESOLVED_IMPORT", `Compiler did not load ${specifier}`, declaration);
    return file!;
  };

  // Only expressions with known effect-free initialization are admitted at module scope.
  const primitiveExpression = (node: ts.Expression): boolean => {
    const primitive = ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike |
      ts.TypeFlags.BigIntLike | ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.ESSymbolLike;
    const type = checker.getTypeAtLocation(node);
    return type.isUnion() ? type.types.every(member => !!(member.flags & primitive)) : !!(type.flags & primitive);
  };
  const safeInitializer = (node: ts.Expression): boolean => {
    if (ts.isLiteralExpression(node) || node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword || node.kind === ts.SyntaxKind.NullKeyword) return true;
    if (ts.isIdentifier(node)) {
      const symbol = originalSymbol(node);
      if (!symbol) return false;
      if (librarySymbol(node)) return standardGlobals.has(node.text);
      return symbol.declarations?.some(declaration => {
        const unit = unitForDeclaration(declaration);
        if (unit && ts.isFunctionDeclaration(unit)) return true;
        // Reject unresolved reads, temporal-dead-zone reads and imported lexical initializers.
        return !!unit && ts.isVariableDeclaration(unit) && unit.getSourceFile() === node.getSourceFile() && unit.end < node.getStart();
      }) ?? false;
    }
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node)) return safeInitializer(node.expression);
    if (ts.isPrefixUnaryExpression(node)) return [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.ExclamationToken, ts.SyntaxKind.TildeToken].includes(node.operator) && (node.operator === ts.SyntaxKind.ExclamationToken || primitiveExpression(node.operand)) && safeInitializer(node.operand);
    if (ts.isBinaryExpression(node)) return node.operatorToken.kind < ts.SyntaxKind.FirstAssignment && primitiveExpression(node.left) && primitiveExpression(node.right) && safeInitializer(node.left) && safeInitializer(node.right);
    if (ts.isConditionalExpression(node)) return safeInitializer(node.condition) && safeInitializer(node.whenTrue) && safeInitializer(node.whenFalse);
    if (ts.isArrayLiteralExpression(node)) return node.elements.every(e => !ts.isSpreadElement(e) && ts.isExpression(e) && safeInitializer(e));
    if (ts.isObjectLiteralExpression(node)) return node.properties.every(p => ts.isPropertyAssignment(p) && !ts.isComputedPropertyName(p.name) && safeInitializer(p.initializer));
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return true;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)) {
      const owner = node.expression.expression.text;
      const method = node.expression.name.text;
      if (owner === "Math" && librarySymbol(node.expression.expression) && pureMathMethods.has(method)) return node.arguments.every(argument => primitiveExpression(argument) && safeInitializer(argument));
      if (owner === "Symbol" && librarySymbol(node.expression.expression) && method === "for" && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
        assume("symbol-registry", `Shared JavaScript Symbol.for registry key: ${node.arguments[0].text}`, node);
        return true;
      }
    }
    return false;
  };

  const validateModule = (file: ts.SourceFile) => {
    if (validated.has(file)) return;
    if (!contained(sourceRoot, fs.realpathSync(file.fileName))) refusal("PATH_ESCAPE", "Reached source file escapes sourceRoot");
    validated.add(file);
    if ((file as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics?.length) failAt("INVALID_SOURCE", "Donor source has syntax errors", file);
    for (const statement of file.statements) {
      if (ts.isImportDeclaration(statement)) {
        const target = moduleFor(statement);
        if (!statement.importClause) failAt("TOP_LEVEL_EFFECT", "Side effect imports cannot be transplanted", statement);
        const bindings = statement.importClause!.namedBindings;
        const hasValue = !statement.importClause!.isTypeOnly && (statement.importClause!.name || !bindings || !ts.isNamedImports(bindings) || bindings.elements.some(e => !e.isTypeOnly));
        if (hasValue) validateModule(target);
      } else if (ts.isVariableStatement(statement)) {
        if (!(statement.declarationList.flags & ts.NodeFlags.Const)) failAt("MUTABLE_MODULE_GLOBAL", "Module-level let/var requires an explicit state interface", statement);
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name)) failAt("UNSUPPORTED_DECLARATION", "Module-level destructuring is outside this proof", declaration);
          if (!declaration.initializer || !safeInitializer(declaration.initializer)) failAt("TOP_LEVEL_EFFECT", "Module initialization has an unknown effect", declaration);
        }
      } else if (ts.isFunctionDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEmptyStatement(statement)) {
        // Definitions do not execute at module initialization.
      } else if (ts.isExportDeclaration(statement)) {
        if (statement.moduleSpecifier) moduleFor(statement);
        if (!statement.isTypeOnly && statement.moduleSpecifier) validateModule(moduleFor(statement));
      } else if (ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression)) {
        // Preserve directive prologues.
      } else {
        failAt("TOP_LEVEL_EFFECT", "Unsupported executable statement at module scope", statement);
      }
    }
  };

  const addUnit = (unit: Unit, from?: Unit, kind: "value" | "type" = "value") => {
    validateModule(unit.getSourceFile());
    reached.add(unit.getSourceFile());
    if (from && from !== unit) {
      const edge = { from: info(from).id, to: info(unit).id, kind };
      edges.set(JSON.stringify(edge), edge);
    }
    if (!selected.has(unit)) { selected.add(unit); queue.push(unit); }
  };
  const exported = (file: ts.SourceFile, name: string, node: ts.Node): ts.Symbol => {
    const moduleSymbol = checker.getSymbolAtLocation(file);
    const symbol = moduleSymbol && checker.getExportsOfModule(moduleSymbol).find(s => s.name === name);
    if (!symbol) failAt("ENTRY_EXPORT", `Named export ${name} was not found`, node);
    return symbol!;
  };
  const selectingAliases = new Set<ts.Symbol>();
  const selectSymbol = (symbol: ts.Symbol, from?: Unit, kind: "value" | "type" = "value") => {
    if (selectingAliases.has(symbol)) return;
    selectingAliases.add(symbol);
    try {
      for (const declaration of symbol.declarations ?? []) {
        const unit = unitForDeclaration(declaration);
        if (unit) { addUnit(unit, from, kind); continue; }
        if (ts.isImportSpecifier(declaration)) {
          imports.add(declaration);
          const importDeclaration = importOf(declaration)!;
          const target = moduleFor(importDeclaration);
          selectSymbol(exported(target, (declaration.propertyName ?? declaration.name).text, declaration), from, kind);
          reached.add(declaration.getSourceFile());
          validateModule(declaration.getSourceFile());
        } else if (ts.isExportSpecifier(declaration)) {
          exports.add(declaration);
          const exportDeclaration = declaration.parent.parent;
          reached.add(declaration.getSourceFile());
          validateModule(declaration.getSourceFile());
          if (exportDeclaration.moduleSpecifier) {
            selectSymbol(exported(moduleFor(exportDeclaration), (declaration.propertyName ?? declaration.name).text, declaration), from, kind);
          } else {
            const local = checker.getExportSpecifierLocalTargetSymbol(declaration);
            if (!local) failAt("UNRESOLVED_EXPORT", "Cannot resolve local named export", declaration);
            selectSymbol(local!, from, kind);
          }
        } else if (ts.isImportClause(declaration) || ts.isNamespaceImport(declaration)) {
          failAt("UNSUPPORTED_IMPORT", "Use explicit named imports for the first proof", declaration);
        }
      }
      if (symbol.flags & ts.SymbolFlags.Alias && !(symbol.declarations ?? []).some(d => ts.isImportSpecifier(d) || ts.isExportSpecifier(d))) {
        selectSymbol(checker.getAliasedSymbol(symbol), from, kind);
      }
    } finally { selectingAliases.delete(symbol); }
  };

  const source = program.getSourceFile(entryFile);
  if (!source) refusal("ENTRY_FILE", "Compiler could not load entry file");
  validateModule(source!);
  reached.add(source!);
  selectSymbol(exported(source!, options.exportName, source!));
  if (!selected.size) refusal("ENTRY_EXPORT", "Selected export has no supported declaration");
  for (let index = 0; index < queue.length; index++) {
    const unit = queue[index];
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && ["eval", "require"].includes(node.expression.text)))) failAt("DYNAMIC_CODE", "Dynamic loading or eval requires an explicit interface", node);
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Function") failAt("DYNAMIC_CODE", "Dynamic Function construction is unsupported", node);
      if (ts.isNewExpression(node) && !ts.isIdentifier(node.expression)) assume("caller-constructor", "A constructor supplied through the caller's object is invoked; verification covers only constructors in the declared contract", node);
      if (ts.isImportTypeNode(node)) failAt("UNSUPPORTED_IMPORT", "Inline import types require explicit named imports", node);
      if (ts.isVariableDeclaration(node) && !unitForDeclaration(node) && node.initializer) {
        const root = rootIdentifier(node.initializer);
        const type = checker.getTypeAtLocation(node.initializer);
        if (root && moduleGlobal(root) && (type.flags & (ts.TypeFlags.Object | ts.TypeFlags.NonPrimitive | ts.TypeFlags.Any | ts.TypeFlags.Unknown))) failAt("MODULE_STATE_ESCAPE", "A local alias captures module-level object state", node);
      }
      if (ts.isReturnStatement(node) && node.expression) {
        const root = rootIdentifier(node.expression);
        const type = checker.getTypeAtLocation(node.expression);
        if (root && moduleGlobal(root) && (type.flags & (ts.TypeFlags.Object | ts.TypeFlags.NonPrimitive | ts.TypeFlags.Any | ts.TypeFlags.Unknown))) failAt("MODULE_STATE_ESCAPE", "Returning module-level object state needs an explicit state interface", node);
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
        const root = rootIdentifier(node.left);
        if (root && moduleGlobal(root)) failAt("MUTABLE_MODULE_GLOBAL", "Selected feature writes module-level state", node);
      }
      if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)) {
        const root = rootIdentifier(node.operand);
        if (root && moduleGlobal(root)) failAt("MUTABLE_MODULE_GLOBAL", "Selected feature increments module-level state", node);
      }
      if (ts.isDeleteExpression(node)) {
        const root = rootIdentifier(node.expression);
        if (root && moduleGlobal(root)) failAt("MUTABLE_MODULE_GLOBAL", "Selected feature deletes module-level state", node);
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const root = rootIdentifier(node.expression.expression);
        if (root && moduleGlobal(root) && !(readonlyMethods.has(node.expression.name.text) && librarySymbol(node.expression.name))) failAt("MUTABLE_MODULE_GLOBAL", "Unknown operation on module-level state", node);
      }
      if (ts.isCallExpression(node)) {
        if (ts.isIdentifier(node.expression) && checker.getSymbolAtLocation(node.expression)?.declarations?.some(ts.isParameter)) assume("caller-callback", "A caller-provided function is invoked; its effects and return type belong to the target's explicit interface", node);
        if (ts.isElementAccessExpression(node.expression)) assume("caller-protocol", "An object method selected through a computed key is invoked; callers must retain that protocol", node);
        const knownRead = ts.isPropertyAccessExpression(node.expression) && readonlyMethods.has(node.expression.name.text) && librarySymbol(node.expression.name);
        for (const argument of node.arguments) {
          const root = rootIdentifier(argument);
          const type = checker.getTypeAtLocation(argument);
          if (root && moduleGlobal(root) && (type.flags & (ts.TypeFlags.Object | ts.TypeFlags.NonPrimitive | ts.TypeFlags.Any | ts.TypeFlags.Unknown)) && !knownRead) {
            failAt("MODULE_STATE_ESCAPE", "Module-level object state escapes into a call; supply an explicit state interface", argument);
          }
        }
      }
      if (ts.isRegularExpressionLiteral(node) && /[gy][a-z]*$/i.test(node.text.slice(node.text.lastIndexOf("/") + 1))) failAt("MUTABLE_MODULE_GLOBAL", "Stateful regular expressions need an explicit state interface", node);
      if (ts.isIdentifier(node)) {
        const symbol = checker.getSymbolAtLocation(node);
        const declarations = symbol?.declarations ?? [];
        const libGlobal = declarations.length > 0 && declarations.every(d => program.isSourceFileDefaultLibrary(d.getSourceFile()));
        const syntacticName = (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) ||
          ((ts.isPropertyAssignment(node.parent) || ts.isMethodSignature(node.parent) || ts.isPropertySignature(node.parent)) && node.parent.name === node && !ts.isShorthandPropertyAssignment(node.parent));
        if (libGlobal && !syntacticName) {
          if (!standardGlobals.has(node.text)) failAt("AMBIENT_DEPENDENCY", `Ambient global ${node.text} is outside the supported interface`, node);
          if (node.text === "Date") assume("date-runtime", "JavaScript Date semantics and the process time zone are inherited; local dates require verification in each supported TZ", node);
          if (node.text === "Symbol") assume("symbol-runtime", "The target must preserve JavaScript symbol identity and any caller-provided extension protocol", node);
        }
        if (symbol && !libGlobal) selectSymbol(symbol, unit, inType(node) ? "type" : "value");
        else if (!syntacticName && ["process", "globalThis", "window", "document", "console", "fetch", "eval", "require"].includes(node.text)) failAt("AMBIENT_DEPENDENCY", `Ambient global ${node.text} requires an explicit interface`, node);
      }
      ts.forEachChild(node, visit);
    };
    visit(unit);
  }

  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const outputs = new Map<string, string>();
  for (const file of [...reached].sort((a, b) => relative(a).localeCompare(relative(b)))) {
    const statements: ts.Statement[] = [];
    for (const statement of file.statements) {
      if (ts.isImportDeclaration(statement)) {
        const clause = statement.importClause;
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          const kept = clause.namedBindings.elements.filter(e => imports.has(e));
          if (kept.length) statements.push(ts.factory.updateImportDeclaration(statement, statement.modifiers, ts.factory.updateImportClause(clause, clause.isTypeOnly, undefined, ts.factory.updateNamedImports(clause.namedBindings, kept)), statement.moduleSpecifier, statement.attributes));
        }
      } else if (ts.isVariableStatement(statement)) {
        const kept = statement.declarationList.declarations.filter(d => selected.has(d));
        if (kept.length) statements.push(ts.factory.updateVariableStatement(statement, statement.modifiers, ts.factory.updateVariableDeclarationList(statement.declarationList, kept)));
      } else if (ts.isExportDeclaration(statement)) {
        if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
          const kept = statement.exportClause.elements.filter(e => exports.has(e));
          if (kept.length) statements.push(ts.factory.updateExportDeclaration(statement, statement.modifiers, statement.isTypeOnly, ts.factory.updateNamedExports(statement.exportClause, kept), statement.moduleSpecifier, statement.attributes));
        }
      } else if ((isUnit(statement) && selected.has(statement)) || (ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression))) statements.push(statement);
    }
    let printed = printer.printFile(ts.factory.updateSourceFile(file, statements));
    const notices = (ts.getLeadingCommentRanges(file.text, 0) ?? [])
      .map(range => file.text.slice(range.pos, range.end))
      .filter(comment => /copyright|licen[sc]e|spdx|@preserve|^\/\*!/i.test(comment));
    for (const notice of notices.reverse()) if (!printed.includes(notice)) printed = `${notice}\n${printed}`;
    outputs.set(relative(file), printed);
  }
  // Compile a virtual capsule before creating files: pruning must keep the public types valid.
  const virtualRoot = path.join(outDir, "src");
  const virtualFiles = new Map([...outputs].map(([file, text]) => [path.join(virtualRoot, file), text]));
  const host = ts.createCompilerHost(compilerOptions);
  const originalRead = host.readFile.bind(host), originalExists = host.fileExists.bind(host), originalSource = host.getSourceFile.bind(host);
  host.readFile = file => virtualFiles.get(path.resolve(file)) ?? originalRead(file);
  host.fileExists = file => virtualFiles.has(path.resolve(file)) || originalExists(file);
  const originalDirectoryExists = host.directoryExists?.bind(host);
  host.directoryExists = dir => [...virtualFiles.keys()].some(file => contained(path.resolve(dir), file)) || !!originalDirectoryExists?.(dir);
  host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) => {
    const text = virtualFiles.get(path.resolve(file));
    return text === undefined ? originalSource(file, languageVersion, onError, shouldCreateNewSourceFile) : ts.createSourceFile(file, text, languageVersion, true);
  };
  const capsuleProgram = ts.createProgram([...virtualFiles.keys()], compilerOptions, host);
  const diagnostics = ts.getPreEmitDiagnostics(capsuleProgram);
  if (diagnostics.length) refusal("CAPSULE_TYPECHECK", ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: f => f, getCurrentDirectory: () => virtualRoot, getNewLine: () => "\n" }).replaceAll(outDir, "<capsule>"));

  assume("verification-boundary", "Extraction proves a statically closed, type-checked slice; behavioral preservation still requires an explicit contract and differential evidence");
  let license: Buffer | undefined;
  if (options.provenance) {
    license = fs.readFileSync(path.resolve(options.provenance.licenseFile));
    if (!license.length) refusal("DONOR_LICENSE", "Donor license must not be empty");
  }
  const symbols = [...selected].map(info).sort((a, b) => a.id.localeCompare(b.id));
  const fileByRelative = new Map([...reached].map(file => [relative(file), file]));
  const base: Omit<Manifest, "digest"> = {
    schema: "code-transplant.capsule.v1",
    entry: { file: relative(source!), exportName: options.exportName },
    files: [...outputs].map(([file, text]) => ({ path: file, sourceSha256: hash(fileByRelative.get(file)!.text), outputSha256: hash(text), selectedSymbols: symbols.filter(s => s.file === file).map(s => s.name).sort(), sourceLines: lines(fileByRelative.get(file)!.text), outputLines: lines(text) })),
    symbols,
    edges: [...edges.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    assumptions: [...assumptions.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    ...(options.provenance ? { provenance: { repository: options.provenance.repository, revision: options.provenance.revision, licenseFile: "LICENSE", licenseSha256: hash(license!) } } : {}),
  };
  const manifest: Manifest = { ...base, digest: hash(JSON.stringify(base)) };
  fs.mkdirSync(path.dirname(outDir), { recursive: true });
  const staging = fs.mkdtempSync(path.join(path.dirname(outDir), ".transplant-staging-"));
  try {
    for (const [file, text] of outputs) {
      const destination = path.join(staging, "src", file);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, text, { flag: "wx" });
    }
    fs.writeFileSync(path.join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
    if (license) fs.writeFileSync(path.join(staging, "LICENSE"), license, { flag: "wx" });
    if (pathPresent(outDir)) refusal("OUTPUT_EXISTS", "Output path appeared during extraction");
    fs.renameSync(staging, outDir);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  return manifest;
}
