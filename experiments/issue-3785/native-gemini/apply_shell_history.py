#!/usr/bin/env python3
"""Coordinate the pinned native interactive shell-history hook without sharing code."""
import hashlib
import json
from pathlib import Path
import sys

here = Path(__file__).resolve().parent
package = Path(sys.argv[1]).resolve(strict=True)
if json.loads((package / 'package.json').read_text())['version'] != '0.65.0':
    raise SystemExit('Refusing an unpinned native Gemini package.')
bundle = package / 'bundle'
target = bundle / 'interactiveCli-AVD3AKNJ.js'
original = target.read_bytes()
if hashlib.sha256(original).hexdigest() != '286a6aa958fe8a99dcb87a3ffe094c8ef889449fb298fc18f54065c7cab3a749':
    raise SystemExit('Refusing changed native Gemini shell-history input.')
for local, installed in (('history.mjs', 'hive-gemini-history.mjs'), ('publication.mjs', 'hive-gemini-publication.mjs')):
    if (bundle / installed).read_bytes() != (here / local).read_bytes():
        raise SystemExit('Refusing a different native Gemini history helper.')
helper = bundle / 'hive-gemini-shell-history.mjs'
if helper.exists() or helper.is_symlink():
    raise SystemExit('Refusing an existing native Gemini shell-history helper.')
source = original.decode()


def replace(before, after):
    global source
    if source.count(before) != 1:
        raise SystemExit('Ambiguous native shell-history context; no files changed.')
    source = source.replace(before, after)


replace('''  await storage.initialize();
  return storage.getHistoryFilePath();''', '''  await storage.initialize();
  return registerNativeGeminiShellHistory(storage.getProjectTempDir(), storage.getHistoryFilePath());''')
replace('''async function readHistoryFile(filePath) {
  try {''', '''async function readHistoryFile(filePath) {
  const canonical = readNativeGeminiShellHistory(filePath);
  if (canonical !== undefined) return canonical;
  try {''')
replace('''async function writeHistoryFile(filePath, history) {
  try {''', '''async function writeHistoryFile(filePath, history) {
  if (nativeGeminiHistorySelected()) refuseNativeGeminiShellRewrite();
  try {''')
replace('''  const [historyFilePath, setHistoryFilePath] = (0, import_react61.useState)(null);
  (0, import_react61.useEffect)''', '''  const [historyFilePath, setHistoryFilePath] = (0, import_react61.useState)(null);
  const [historyFailure, setHistoryFailure] = (0, import_react61.useState)(null);
  if (historyFailure && nativeGeminiHistorySelected()) throw historyFailure;
  (0, import_react61.useEffect)''')
replace('''    loadHistory();
  }, [projectRoot, storage]);''', '''    loadHistory().catch((error) => {
      if (nativeGeminiHistorySelected()) setHistoryFailure(new Error("Gemini canonical conversation history is unavailable or unsafe."));
      else debugLogger.error("Error loading shell history:", error);
    });
  }, [projectRoot, storage]);''')
replace('''    (command) => {
      if (!command.trim() || !historyFilePath) {''', '''    (command) => {
      if (nativeGeminiHistorySelected()) {
        const canonical = appendNativeGeminiShellHistory(historyFilePath, command);
        setHistory(canonical.reverse());
        setHistoryIndex(-1);
        return;
      }
      if (!command.trim() || !historyFilePath) {''')
replace('''  const getPreviousCommand = (0, import_react61.useCallback)(() => {
    if (history.length === 0) {''', '''  const getPreviousCommand = (0, import_react61.useCallback)(() => {
    const selected = readNativeGeminiShellHistory(historyFilePath);
    const current = selected === undefined ? history : selected.reverse();
    if (selected !== undefined) setHistory(current);
    if (current.length === 0) {''')
replace('''    const newIndex = Math.min(historyIndex + 1, history.length - 1);
    setHistoryIndex(newIndex);
    return history[newIndex] ?? null;
  }, [history, historyIndex]);''', '''    const newIndex = Math.min(historyIndex + 1, current.length - 1);
    setHistoryIndex(newIndex);
    return current[newIndex] ?? null;
  }, [history, historyIndex, historyFilePath]);''')
replace('''  const getNextCommand = (0, import_react61.useCallback)(() => {
    if (historyIndex < 0) {''', '''  const getNextCommand = (0, import_react61.useCallback)(() => {
    const selected = readNativeGeminiShellHistory(historyFilePath);
    const current = selected === undefined ? history : selected.reverse();
    if (selected !== undefined) setHistory(current);
    if (historyIndex < 0) {''')
replace('''    return history[newIndex] ?? null;
  }, [history, historyIndex]);''', '''    return current[newIndex] ?? null;
  }, [history, historyIndex, historyFilePath]);''')
replace('''async function startInteractiveUI(config, settings, startupWarnings, workspaceRoot = process.cwd(), resumedSessionData, initializationResult) {
  initializeConsoleStore();''', '''async function startInteractiveUI(config, settings, startupWarnings, workspaceRoot = process.cwd(), resumedSessionData, initializationResult) {
  if (nativeGeminiHistorySelected()) {
    readNativeGeminiShellHistory(await getHistoryFilePath(config.getProjectRoot(), config.storage));
  }
  initializeConsoleStore();''')
source = 'import { nativeGeminiHistorySelected } from "./hive-gemini-history.mjs";\nimport { registerNativeGeminiShellHistory, readNativeGeminiShellHistory, appendNativeGeminiShellHistory, refuseNativeGeminiShellRewrite } from "./hive-gemini-shell-history.mjs";\n' + source
if '--check' in sys.argv[2:]:
    print('Pinned native Gemini shell-history selector applies; no files changed.')
else:
    if target.is_symlink():
        target.unlink()
    target.write_text(source)
    helper.write_text((here / 'shell_history.mjs').read_text())
    print('Applied disposable native Gemini shell history; production is unchanged.')
print('Native shell-history UI SHA-256:', hashlib.sha256(source.encode()).hexdigest())
print('Native shell-history helper SHA-256:', hashlib.sha256((here / 'shell_history.mjs').read_bytes()).hexdigest())
