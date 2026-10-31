#!/usr/bin/env python3
"""Retain native plans through checked directories and acknowledged generations."""
import hashlib
import json
from pathlib import Path
import sys

here = Path(__file__).resolve().parent
package = Path(sys.argv[1]).resolve(strict=True)
assert json.loads((package / 'package.json').read_text())['version'] == '0.65.0'
bundle = package / 'bundle'
pins = {'chunk-DKZARV6U.js': '91ce4040ae4296cfa2b82238f2b9a2291bbbf86086a85c1c9b341d08272eae28',
        'hive-gemini-history.mjs': '4072ef64f7258b229a63a64fb3834c28c4f54477482eaeca44cbbb409a5e1cbd',
        'hive-gemini-publication.mjs': '2e55f93d5075a6c9cc9d5b3c7e71f243accc8f72e955e038d0341cb8fed0bc00'}
for name, expected in pins.items():
    if hashlib.sha256((bundle / name).read_bytes()).hexdigest() != expected:
        raise SystemExit('Refusing changed native plan-history prerequisites.')
manager = 'chunk-DKZARV6U.js'
helper = 'hive-gemini-history.mjs'
sources = {name: (bundle / name).read_text() for name in pins}


def replace(before, after):
    if sources[manager].count(before) != 1:
        raise SystemExit('Ambiguous native plan-history context; no files changed.')
    sources[manager] = sources[manager].replace(before, after)


replace('''  getProjectTempPlansDir() {
    if (this.sessionId) {''', '''  getProjectTempPlansDir() {
    const canonical = nativeGeminiPlansDirectory(this.getProjectTempDir(), this.sessionId);
    if (canonical !== undefined) return canonical;
    if (this.sessionId) {''')
replace('''  getPlansDir() {
    if (this.customPlansDir) {''', '''  getPlansDir() {
    if (nativeGeminiHistorySelected()) return this.getProjectTempPlansDir();
    if (this.customPlansDir) {''')
replace('''    await this.storage.initialize();
    if (nativeGeminiHistorySelected() && this.isTrackerEnabled()) {''', '''    await this.storage.initialize();
    this.refreshNativePlanPolicy();
    if (nativeGeminiHistorySelected() && this.isTrackerEnabled()) {''')
replace('''  refreshSessionScopedPlansDirectory(previousPlansDir) {
    const nextPlansDir = this.storage.getPlansDir();''', '''  refreshNativePlanPolicy() {
    if (!nativeGeminiHistorySelected()) return;
    const pattern = nativeGeminiPlanPolicyPattern(this.storage.getPlansDir());
    this.policyEngine.removeRulesBySource("hive-native-canonical-plans");
    for (const toolName of ["write_file", "replace"]) {
      this.policyEngine.addRule({ toolName, decision: PolicyDecision.ALLOW,
        priority: 1.07, modes: [ApprovalMode.PLAN], argsPattern: pattern,
        source: "hive-native-canonical-plans" });
    }
  }
  refreshSessionScopedPlansDirectory(previousPlansDir) {
    const nextPlansDir = this.storage.getPlansDir();
    this.refreshNativePlanPolicy();''')
replace('''  async readTextFile(filePath) {
    return fs66.readFile(filePath, "utf-8");''', '''  async readTextFile(filePath) {
    const canonical = readNativeGeminiPlan(filePath);
    if (canonical !== undefined) return canonical;
    return fs66.readFile(filePath, "utf-8");''')
replace('''  async writeTextFile(filePath, content) {
    let realPath = filePath;''', '''  async writeTextFile(filePath, content) {
    if (writeNativeGeminiPlan(filePath, content)) return;
    let realPath = filePath;''')
replace('''  const canonical = readNativeGeminiToolOutput(filePath);''', '''  const canonical = readNativeGeminiToolOutput(filePath) ?? readNativeGeminiPlan(filePath);''')
before = '    readNativeGeminiToolOutput(path52.resolve(this.config.getTargetDir(), sanitizedPath));'
if sources[manager].count(before) != 2:
    raise SystemExit('Ambiguous native read-file plan admission; no files changed.')
sources[manager] = sources[manager].replace(before, before + '\n    readNativeGeminiPlan(path52.resolve(this.config.getTargetDir(), sanitizedPath));')
sources[manager] = 'import { nativeGeminiPlansDirectory, nativeGeminiPlanPolicyPattern, readNativeGeminiPlan, writeNativeGeminiPlan } from "./hive-gemini-history.mjs";\n' + sources[manager]
sources[helper] += '\n\n' + (here / 'plans_history.mjs').read_text()
publication = 'hive-gemini-publication.mjs'
before = "  if (parts.length !== 4 || !/^session-[a-f0-9]{64}$/u.test(parts[3])) return false;"
assert sources[publication].count(before) == 1
sources[publication] = sources[publication].replace(before, '''  if (parts[2] === 'plans' && parts.length >= 4 && parts.length <= 11 && /^session-[a-f0-9]{64}$/u.test(parts[3]) && parts.slice(4).every(part => /^[A-Za-z0-9_.-]{1,200}$/u.test(part) && !['.', '..'].includes(part) && !part.startsWith('.publish-') && !part.startsWith('.history-'))) return name.endsWith('.md') && !name.startsWith('.publish-') && !name.startsWith('.history-') && !/[\\\\/\\0\\r\\n]/u.test(name);
''' + before)
if '--check' in sys.argv[2:]:
    print('Pinned native Gemini plan-history stage applies; no files changed.')
else:
    for name, source in sources.items():
        target = bundle / name
        if target.is_symlink():
            target.unlink()
        target.write_text(source)
    print('Applied disposable native Gemini plan history; production is unchanged.')
for name, source in sources.items():
    print(hashlib.sha256(source.encode()).hexdigest(), name)
