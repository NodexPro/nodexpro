import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import crypto from 'node:crypto';
import config from '../architecture-enforcer.config.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

async function loadParser() {
  const parserPath = path.join(repoRoot, 'apps/web/node_modules/@babel/parser/lib/index.js');
  if (!fs.existsSync(parserPath)) {
    throw new Error('Missing @babel/parser. Run npm install in apps/web first.');
  }
  return import(url.pathToFileURL(parserPath).href);
}

function readFileSafe(absPath) {
  try {
    return fs.readFileSync(absPath, 'utf8');
  } catch {
    return '';
  }
}

function listFilesRecursive(absDir) {
  const out = [];
  if (!fs.existsSync(absDir)) return out;
  const stack = [absDir];
  while (stack.length) {
    const cur = stack.pop();
    for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules' || ent.name === 'dist' || ent.name === '.git') continue;
        stack.push(full);
      } else {
        out.push(full);
      }
    }
  }
  return out;
}

function toRel(absPath) {
  return path.relative(repoRoot, absPath).replace(/\\/g, '/');
}

function parseAst(parser, code, file) {
  try {
    return parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
      sourceFilename: file,
      errorRecovery: true,
    });
  } catch {
    return null;
  }
}

function walk(node, fn, parent = null) {
  if (!node || typeof node !== 'object') return;
  fn(node, parent);
  for (const key of Object.keys(node)) {
    const val = node[key];
    if (Array.isArray(val)) {
      for (const ch of val) walk(ch, fn, node);
    } else if (val && typeof val.type === 'string') {
      walk(val, fn, node);
    }
  }
}

function getNodeText(code, node) {
  if (!node || node.start == null || node.end == null) return '';
  return code.slice(node.start, node.end);
}

function methodFromObjectExpression(node) {
  if (!node || node.type !== 'ObjectExpression') return null;
  for (const p of node.properties || []) {
    if (p.type !== 'ObjectProperty') continue;
    const keyName = p.key.type === 'Identifier' ? p.key.name : p.key.type === 'StringLiteral' ? p.key.value : null;
    if (keyName !== 'method') continue;
    if (p.value.type === 'StringLiteral') return String(p.value.value).toUpperCase();
    if (p.value.type === 'Identifier') return String(p.value.name).toUpperCase();
  }
  return null;
}

function regexAnyMatch(text, patterns) {
  return patterns.some((r) => r.test(text));
}

function addViolation(arr, payload) {
  const normalized = `${payload.ruleId}|${payload.file}|${String(payload.summary).toLowerCase().replace(/\s+/g, ' ').trim()}`;
  const signature = crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 16);
  arr.push({ ...payload, signature });
}

function reasonAndFix(ruleId, context) {
  const m = {
    RULE_A_NO_PATCH_PUT: {
      reason: 'Generic PATCH/PUT allows bypass of command model.',
      fix: 'Replace workspace write path with explicit command endpoint and mark legacy route deprecated/blocked.',
    },
    RULE_B_AGGREGATE_ONLY_READ: {
      reason: 'Extra GETs create hidden truth sources and stitched reads.',
      fix: 'Move required display truth into full aggregate/case and stop side GETs for workspace truth.',
    },
    RULE_C_COMMAND_ONLY_WRITE: {
      reason: 'Non-command writes split domain truth and allow inconsistent flows.',
      fix: 'Route mutation via command endpoints only; keep operational endpoints non-truth and non-workspace.',
    },
    RULE_D_FULL_REFRESH_AFTER_COMMAND: {
      reason: 'Local merge after command breaks server-truth flow.',
      fix: 'After command success, replace full workspace case (`setLocalWorkspace(next)`) only.',
    },
    RULE_E_NO_FRONTEND_BUSINESS_LOGIC: {
      reason: 'Frontend semantic derivation violates dumb-UI contract.',
      fix: 'Move status/action/priority/date/group semantics to aggregate fields and render directly.',
    },
    RULE_F_BACKEND_TABLE_OWNERSHIP: {
      reason: 'Frontend-owned table semantics break aggregate ownership.',
      fix: 'Backend must provide ready table model (columns/rows/cell semantics/actions).',
    },
    RULE_G_STATE_ACTION_EVENT: {
      reason: 'Mixing state/action/event weakens domain model boundaries.',
      fix: 'Separate state model from action contracts and event/history facts.',
    },
    RULE_H_LEGACY_ENDPOINT: {
      reason: 'Legacy endpoints keep bypass paths active.',
      fix: 'Migrate calls to commands/aggregate flow and remove legacy usage.',
    },
    RULE_I_FINANCIAL_TRUTH_ACCOUNTING_BASE: {
      reason: 'New financial truth logic outside Accounting Base violates financial source-of-truth rule.',
      fix: 'Use Accounting Base as source of truth or mark as TEMPORARY_ACCOUNTING_BASE_PENDING with minimal migration-friendly scope.',
    },
    RULE_J_COUNTRY_SPECIFIC_LOGIC_COUNTRY_PACK: {
      reason: 'Country-specific legal logic outside Country Pack framework violates ownership boundary.',
      fix: 'Move country-specific logic to Country Pack/ruleset or mark TEMPORARY_COUNTRY_PACK_PENDING during transition.',
    },
  };
  return m[ruleId] ?? { reason: context ?? 'Architecture violation.', fix: 'Align to Core → Commands → Aggregate → UI.' };
}

function isWorkspaceFile(relPath) {
  return config.frontendWorkspaceFiles.includes(relPath);
}

function hasAccountingBaseReference(text) {
  return config.accountingBaseReferencePatterns.some((r) => r.test(text));
}

function hasFinancialTruthKeyword(text) {
  const t = String(text || '').toLowerCase();
  return config.financialTruthKeywords.some((k) => t.includes(String(k).toLowerCase()));
}

function hasCountryPackReference(text) {
  return config.countryPackReferencePatterns.some((r) => r.test(text));
}

function hasCountrySpecificKeyword(text) {
  const t = String(text || '').toLowerCase();
  return config.countrySpecificKeywords.some((k) => t.includes(String(k).toLowerCase()));
}

async function run() {
  const mode = process.argv[2] || 'check';
  const parserMod = await loadParser();
  const parser = parserMod.default ?? parserMod;
  const violations = [];
  const workspaceReport = [];

  const endpointFileAbs = path.join(repoRoot, config.endpointRegistryFile);
  const endpointCode = readFileSafe(endpointFileAbs);
  const endpointMap = new Map();
  if (endpointCode) {
    const endpointAst = parseAst(parser, endpointCode, config.endpointRegistryFile);
    if (endpointAst) {
      walk(endpointAst, (n) => {
        if (n.type !== 'VariableDeclarator' || n.id?.type !== 'Identifier') return;
        const name = n.id.name;
        if (!/^moduleClientOperations/.test(name)) return;
        endpointMap.set(name, getNodeText(endpointCode, n.init));
      });
    }
  }

  // RULE A backend patch/put routes
  const routeFiles = [];
  for (const root of config.backendRouteRoots) {
    const absRoot = path.join(repoRoot, root);
    for (const f of listFilesRecursive(absRoot)) {
      if (config.backendRouteFilePattern.test(f.replace(/\\/g, '/'))) routeFiles.push(f);
    }
  }
  for (const abs of routeFiles) {
    const rel = toRel(abs);
    const code = readFileSafe(abs);
    const ast = parseAst(parser, code, rel);
    if (!ast) continue;
    walk(ast, (n) => {
      if (n.type !== 'CallExpression') return;
      const c = n.callee;
      if (!c || c.type !== 'MemberExpression') return;
      const prop = c.property?.type === 'Identifier' ? c.property.name : c.property?.type === 'StringLiteral' ? c.property.value : '';
      if (!['patch', 'put'].includes(String(prop))) return;
      const routeArg = n.arguments?.[0];
      const routeText = routeArg?.type === 'StringLiteral' ? routeArg.value : getNodeText(code, routeArg);
      const allow = config.backendPatchPutAllowlist.some((a) => rel.includes(a));
      if (!allow) {
        const info = reasonAndFix('RULE_A_NO_PATCH_PUT');
        addViolation(violations, {
          ruleId: 'RULE_A_NO_PATCH_PUT',
          severity: 'error',
          file: rel,
          line: n.loc?.start?.line ?? 1,
          summary: `router.${prop}(${routeText})`,
          reason: info.reason,
          fix: info.fix,
        });
      }
    });
  }

  // Frontend workspace checks
  for (const rel of config.frontendWorkspaceFiles) {
    const abs = path.join(repoRoot, rel);
    const code = readFileSafe(abs);
    if (!code) continue;
    const ast = parseAst(parser, code, rel);
    if (!ast) continue;

    let hasCommandWrite = false;
    const hasFullReplaceToken = config.fullReplaceEvidencePatterns.some((r) => r.test(code));
    const readSources = [];
    const writeSources = [];
    const partialSignals = [];
    const unresolvedCalls = [];
    const importedMap = new Map();

    // collect imports for light wrapper tracing
    walk(ast, (n) => {
      if (n.type !== 'ImportDeclaration') return;
      const src = n.source?.value ? String(n.source.value) : '';
      for (const s of n.specifiers || []) {
        if (s.type === 'ImportSpecifier' || s.type === 'ImportDefaultSpecifier') {
          importedMap.set(s.local.name, src);
        }
      }
    });

    walk(ast, (n, parent) => {
      // API/fetch calls
      if (n.type === 'CallExpression') {
        const calleeText = getNodeText(code, n.callee);
        const isApi = /apiJson|fetch/.test(calleeText);
        const calleeName = n.callee?.type === 'Identifier' ? n.callee.name : null;
        if (!isApi && calleeName && importedMap.has(calleeName)) {
          const src = importedMap.get(calleeName);
          if (/api|service|client|endpoints/i.test(src || '')) {
            unresolvedCalls.push(`${calleeName} from ${src}`);
            addViolation(violations, {
              ruleId: 'RULE_WRAPPER_UNRESOLVED',
              severity: 'warn',
              file: rel,
              line: n.loc?.start?.line ?? 1,
              summary: `Unresolved indirect call: ${calleeName}()`,
              reason: 'Indirect wrapper call could hide method/path semantics.',
              fix: 'Expose endpoint/method explicitly or extend enforcer tracing allowlist.',
            });
          }
        }
        if (isApi) {
          const endpointExpr = n.arguments?.[0];
          const endpointText = getNodeText(code, endpointExpr);
          const opts = n.arguments?.[1];
          const method = methodFromObjectExpression(opts) || (calleeText.includes('fetch') ? 'GET' : 'GET');
          const endpointKey = endpointExpr?.type === 'Identifier' ? endpointExpr.name : null;
          const endpointResolved = endpointKey && endpointMap.has(endpointKey) ? `${endpointKey} => ${endpointMap.get(endpointKey)}` : endpointText;

          const operationalRead = regexAnyMatch(endpointResolved, config.allowedOperationalReadEndpoints);
          const operationalWrite = regexAnyMatch(endpointResolved, config.allowedOperationalWriteEndpoints);
          const forbiddenTruth = regexAnyMatch(endpointResolved, config.forbiddenWorkspaceTruthEndpoints);
          const deprecatedLegacy = regexAnyMatch(endpointResolved, config.deprecatedLegacyEndpoints);

          // Rule A frontend PATCH/PUT usage
          if (['PATCH', 'PUT'].includes(method)) {
            const allow = config.frontendPatchPutAllowlist.some((a) => rel.includes(a));
            if (!allow) {
              const info = reasonAndFix('RULE_A_NO_PATCH_PUT');
              addViolation(violations, {
                ruleId: 'RULE_A_NO_PATCH_PUT',
                severity: 'error',
                file: rel,
                line: n.loc?.start?.line ?? 1,
                summary: `${method} ${endpointResolved || calleeText}`,
                reason: info.reason,
                fix: info.fix,
              });
            }
          }

          // Rule B hidden GET/stitch
          if (method === 'GET') {
            readSources.push({ method, endpoint: endpointResolved, operational: operationalRead });
            if ((forbiddenTruth || !operationalRead) && isWorkspaceFile(rel)) {
              const info = reasonAndFix('RULE_B_AGGREGATE_ONLY_READ');
              addViolation(violations, {
                ruleId: 'RULE_B_AGGREGATE_ONLY_READ',
                severity: 'error',
                file: rel,
                line: n.loc?.start?.line ?? 1,
                summary: `GET ${endpointResolved || calleeText}`,
                reason: info.reason,
                fix: info.fix,
              });
            }
          }

          // Rule C write only via commands
          if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
            const isCommand = regexAnyMatch(endpointResolved, config.allowedCommandEndpointPatterns);
            const isOperational = operationalWrite;
            writeSources.push({ method, endpoint: endpointResolved, isCommand, isOperational });
            if (isCommand) {
              hasCommandWrite = true;
            } else if (!isOperational) {
              const info = reasonAndFix('RULE_C_COMMAND_ONLY_WRITE');
              addViolation(violations, {
                ruleId: 'RULE_C_COMMAND_ONLY_WRITE',
                severity: 'error',
                file: rel,
                line: n.loc?.start?.line ?? 1,
                summary: `${method} ${endpointResolved || calleeText}`,
                reason: info.reason,
                fix: info.fix,
              });
            }
            if (deprecatedLegacy) {
              const info = reasonAndFix('RULE_H_LEGACY_ENDPOINT');
              addViolation(violations, {
                ruleId: 'RULE_H_LEGACY_ENDPOINT',
                severity: 'warn',
                file: rel,
                line: n.loc?.start?.line ?? 1,
                summary: `Deprecated endpoint used: ${endpointResolved}`,
                reason: info.reason,
                fix: info.fix,
              });
            }
          }
        }
      }

      // Rule E semantic business logic heuristics
      if (n.type === 'IfStatement' || n.type === 'ConditionalExpression' || n.type === 'SwitchStatement') {
        const testNode = n.type === 'SwitchStatement' ? n.discriminant : n.test;
        const testText = getNodeText(code, testNode);
        const hasSemanticField = config.semanticFields.some((k) => new RegExp(`\\b${k}\\b`, 'i').test(testText));
        const presentational = config.presentationalConditionAllowPatterns.some((r) => r.test(testText));
        const confidence = hasSemanticField && !presentational ? 'high' : hasSemanticField ? 'low' : 'none';
        if (confidence === 'high' || confidence === 'low') {
          const info = reasonAndFix('RULE_E_NO_FRONTEND_BUSINESS_LOGIC');
          addViolation(violations, {
            ruleId: 'RULE_E_NO_FRONTEND_BUSINESS_LOGIC',
            severity: confidence === 'high' ? 'error' : 'warn',
            file: rel,
            line: n.loc?.start?.line ?? 1,
            summary: `[confidence:${confidence}] ${testText.slice(0, 140)}`,
            reason: info.reason + (confidence === 'low' ? ' (uncertain heuristic match)' : ''),
            fix: info.fix,
          });
        }
      }

      // Rule F table ownership heuristic: hardcoded semantic columns/groups arrays
      if (n.type === 'VariableDeclarator' && n.id?.type === 'Identifier' && n.init?.type === 'ArrayExpression') {
        const name = n.id.name;
        if (/(columns|groups|sections|headers|rowsConfig)/i.test(name)) {
          const allowedByName = config.tableOwnershipAllowVarPatterns.some((r) => r.test(name));
          const hasSemanticObjects = (n.init.elements || []).some((el) => el?.type === 'ObjectExpression');
          if (hasSemanticObjects && !allowedByName) {
            const info = reasonAndFix('RULE_F_BACKEND_TABLE_OWNERSHIP');
            addViolation(violations, {
              ruleId: 'RULE_F_BACKEND_TABLE_OWNERSHIP',
              severity: 'error',
              file: rel,
              line: n.loc?.start?.line ?? 1,
              summary: `const ${name} = [...]`,
              reason: info.reason,
              fix: info.fix,
            });
          }
        }
      }

      // Rule D local truth patch heuristic
      if (n.type === 'CallExpression' && n.callee?.type === 'Identifier' && /^set[A-Z_]/.test(n.callee.name)) {
        const setter = n.callee.name;
        const firstArg = n.arguments?.[0];
        if (firstArg?.type === 'ArrowFunctionExpression' && firstArg.params?.length > 0) {
          const allowed = config.allowLocalStateSetters.includes(setter);
          if (!allowed && hasCommandWrite) {
            const info = reasonAndFix('RULE_D_FULL_REFRESH_AFTER_COMMAND');
            partialSignals.push(`${setter}(prev => ...)`);
            addViolation(violations, {
              ruleId: 'RULE_D_FULL_REFRESH_AFTER_COMMAND',
              severity: 'error',
              file: rel,
              line: n.loc?.start?.line ?? 1,
              summary: `${setter}(prev => ...)`,
              reason: info.reason,
              fix: info.fix,
            });
          }
        }
      }
    });

    for (const p of config.partialUpdateSuspiciousPatterns) {
      if (p.test(code) && hasCommandWrite) partialSignals.push(p.toString());
    }

    // Rule D: command call without evident full replace callback
    if (hasCommandWrite && !hasFullReplaceToken) {
      const info = reasonAndFix('RULE_D_FULL_REFRESH_AFTER_COMMAND');
      addViolation(violations, {
        ruleId: 'RULE_D_FULL_REFRESH_AFTER_COMMAND',
        severity: 'error',
        file: rel,
        line: 1,
        summary: 'Command write detected without full-case replace token.',
        reason: info.reason,
        fix: info.fix,
      });
    }

    // Rule H warnings for legacy endpoint usage
    for (const sym of config.legacyEndpointSymbols) {
      if (code.includes(sym)) {
        const info = reasonAndFix('RULE_H_LEGACY_ENDPOINT');
        addViolation(violations, {
          ruleId: 'RULE_H_LEGACY_ENDPOINT',
          severity: 'warn',
          file: rel,
          line: 1,
          summary: `Legacy endpoint symbol used: ${sym}`,
          reason: info.reason,
          fix: info.fix,
        });
      }
    }

    // Rule I warnings: financial truth outside Accounting Base (frontend/workspace heuristics)
    const hasFinancialKeywordInFile = hasFinancialTruthKeyword(code);
    const hasABRef = hasAccountingBaseReference(code);
    const hasTempMarker = code.includes(config.temporaryAccountingPendingMarker);
    if (hasFinancialKeywordInFile && !hasABRef && !hasTempMarker) {
      const info = reasonAndFix('RULE_I_FINANCIAL_TRUTH_ACCOUNTING_BASE');
      addViolation(violations, {
        ruleId: 'RULE_I_FINANCIAL_TRUTH_ACCOUNTING_BASE',
        severity: 'warn',
        file: rel,
        line: 1,
        summary: 'Financial truth keywords found without Accounting Base reference/marker.',
        reason: info.reason,
        fix: info.fix,
      });
    }

    // Rule I: frontend-calculated financial totals (warn)
    const financialCalcPattern = /(reduce\(|sum|total|balance|amount).*(\+|-|\*|\/)|(\+|-|\*|\/).*(total|balance|amount)/i;
    if (financialCalcPattern.test(code) && hasFinancialKeywordInFile) {
      const info = reasonAndFix('RULE_I_FINANCIAL_TRUTH_ACCOUNTING_BASE');
      addViolation(violations, {
        ruleId: 'RULE_I_FINANCIAL_TRUTH_ACCOUNTING_BASE',
        severity: 'warn',
        file: rel,
        line: 1,
        summary: 'Possible frontend financial total/amount calculation detected.',
        reason: info.reason,
        fix: info.fix,
      });
    }

    // Rule I: documents treated as accounting entries (warn)
    if (/document.*accounting[_ -]?ent|accounting[_ -]?ent.*document/i.test(code)) {
      const info = reasonAndFix('RULE_I_FINANCIAL_TRUTH_ACCOUNTING_BASE');
      addViolation(violations, {
        ruleId: 'RULE_I_FINANCIAL_TRUTH_ACCOUNTING_BASE',
        severity: 'warn',
        file: rel,
        line: 1,
        summary: 'Document appears to be treated as accounting entry.',
        reason: info.reason,
        fix: info.fix,
      });
    }

    // Rule J: country-specific logic should be Country Pack-owned (warn-only transition)
    const hasCountryKeyword = hasCountrySpecificKeyword(code);
    const hasCountryPackRef = hasCountryPackReference(code);
    const hasCountryPendingMarker = code.includes(config.temporaryCountryPackPendingMarker);
    if (hasCountryKeyword && !hasCountryPackRef && !hasCountryPendingMarker) {
      const info = reasonAndFix('RULE_J_COUNTRY_SPECIFIC_LOGIC_COUNTRY_PACK');
      addViolation(violations, {
        ruleId: 'RULE_J_COUNTRY_SPECIFIC_LOGIC_COUNTRY_PACK',
        severity: 'warn',
        file: rel,
        line: 1,
        summary: 'Country-specific legal keyword detected without Country Pack reference/marker.',
        reason: info.reason,
        fix: info.fix,
      });
    }

    workspaceReport.push({
      workspace_file: rel,
      aggregate_sources: ['prop:workspace/localWorkspace'],
      read_sources: readSources,
      write_sources: writeSources,
      full_replace_evidence: hasFullReplaceToken ? 'FOUND' : 'MISSING',
      suspicious_partial_update_evidence: [...new Set(partialSignals)],
      unresolved_indirect_calls: [...new Set(unresolvedCalls)],
    });
  }

  // Rule G warnings: state/action/event mixed signals in backend commands
  for (const root of config.backendRouteRoots) {
    for (const abs of listFilesRecursive(path.join(repoRoot, root))) {
      if (!abs.endsWith('.ts')) continue;
      const rel = toRel(abs);
      const code = readFileSafe(abs);
      if (!code) continue;
      const commandUiState = /open_[a-z_]+|close_[a-z_]+|modal_visibility|open_history_section|close_history_section/.test(code);
      if (commandUiState) {
        const info = reasonAndFix('RULE_G_STATE_ACTION_EVENT');
        addViolation(violations, {
          ruleId: 'RULE_G_STATE_ACTION_EVENT',
          severity: 'warn',
          file: rel,
          line: 1,
          summary: 'Potential UI-state commands detected.',
          reason: info.reason,
          fix: info.fix,
        });
      }
    }
  }

  // Rule J warnings in backend module files (transition-safe; warn only)
  for (const root of config.backendRouteRoots) {
    for (const abs of listFilesRecursive(path.join(repoRoot, root))) {
      if (!abs.endsWith('.ts')) continue;
      const rel = toRel(abs);
      const code = readFileSafe(abs);
      if (!code) continue;
      if (hasCountrySpecificKeyword(code) && !hasCountryPackReference(code) && !code.includes(config.temporaryCountryPackPendingMarker)) {
        const info = reasonAndFix('RULE_J_COUNTRY_SPECIFIC_LOGIC_COUNTRY_PACK');
        addViolation(violations, {
          ruleId: 'RULE_J_COUNTRY_SPECIFIC_LOGIC_COUNTRY_PACK',
          severity: 'warn',
          file: rel,
          line: 1,
          summary: 'Country-specific legal logic found without Country Pack reference/marker.',
          reason: info.reason,
          fix: info.fix,
        });
      }
    }
  }

  // Rule I warnings in backend module files (transition-safe; warn only)
  for (const root of config.backendRouteRoots) {
    for (const abs of listFilesRecursive(path.join(repoRoot, root))) {
      if (!abs.endsWith('.ts')) continue;
      const rel = toRel(abs);
      const code = readFileSafe(abs);
      if (!code) continue;
      if (hasFinancialTruthKeyword(code) && !hasAccountingBaseReference(code) && !code.includes(config.temporaryAccountingPendingMarker)) {
        const info = reasonAndFix('RULE_I_FINANCIAL_TRUTH_ACCOUNTING_BASE');
        addViolation(violations, {
          ruleId: 'RULE_I_FINANCIAL_TRUTH_ACCOUNTING_BASE',
          severity: 'warn',
          file: rel,
          line: 1,
          summary: 'Financial truth keywords in module logic without Accounting Base reference/marker.',
          reason: info.reason,
          fix: info.fix,
        });
      }
    }
  }

  const baselinePath = path.join(repoRoot, config.baselineFile);
  const baseline = fs.existsSync(baselinePath)
    ? JSON.parse(readFileSafe(baselinePath) || '{"items":[]}')
    : { generated_at: null, items: [] };
  const baselineSet = new Set((baseline.items || []).map((i) => i.signature));
  const currentSet = new Set(violations.map((v) => v.signature));
  const baselineViolations = violations.filter((v) => baselineSet.has(v.signature));
  const newViolations = violations.filter((v) => !baselineSet.has(v.signature));
  const resolvedViolations = (baseline.items || []).filter((i) => !currentSet.has(i.signature));

  if (mode === 'baseline') {
    const payload = {
      generated_at: new Date().toISOString(),
      items: violations.map((v) => ({
        signature: v.signature,
        ruleId: v.ruleId,
        severity: v.severity,
        file: v.file,
        summary: v.summary,
      })),
    };
    fs.writeFileSync(baselinePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    console.log(`Baseline written: ${config.baselineFile} (${payload.items.length} items)`);
    process.exit(0);
  }

  if (mode === 'report') {
    const report = {
      generated_at: new Date().toISOString(),
      totals: {
        current: violations.length,
        baseline: baselineViolations.length,
        new: newViolations.length,
        resolved: resolvedViolations.length,
      },
      workspaces: workspaceReport,
      unresolved_indirect_call_warnings: violations.filter((v) => v.ruleId === 'RULE_WRAPPER_UNRESOLVED'),
    };
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }

  // check mode output
  for (const v of violations) {
    const sev = v.severity.toUpperCase();
    console.log(`[${v.ruleId}] ${sev}`);
    console.log(`  file: ${v.file}:${v.line}`);
    console.log(`  signature: ${v.signature}`);
    console.log(`  match: ${v.summary}`);
    console.log(`  reason: ${v.reason}`);
    console.log(`  fix: ${v.fix}`);
    console.log(`  baseline_status: ${baselineSet.has(v.signature) ? 'BASELINE' : 'NEW'}`);
    console.log('');
  }
  if (resolvedViolations.length) {
    console.log('RESOLVED baseline entries (no longer present):');
    for (const r of resolvedViolations) {
      console.log(`  - ${r.signature} [${r.ruleId}] ${r.file} :: ${r.summary}`);
    }
    console.log('');
  }
  const newErrors = newViolations.filter((v) => v.severity === 'error');
  const newWarns = newViolations.filter((v) => v.severity === 'warn');
  console.log(`Architecture Enforcer summary: total=${violations.length}, baseline=${baselineViolations.length}, new=${newViolations.length}, resolved=${resolvedViolations.length}`);
  console.log(`New violations: ${newErrors.length} error(s), ${newWarns.length} warning(s).`);
  if (newErrors.length > 0) process.exit(1);
}

run().catch((e) => {
  console.error(`architecture:check failed: ${e.message}`);
  process.exit(2);
});

