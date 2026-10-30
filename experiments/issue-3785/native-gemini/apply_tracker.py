#!/usr/bin/env python3
"""Preserve the pinned native task tracker through checked conversation data."""
import hashlib
import json
from pathlib import Path
import sys

here = Path(__file__).resolve().parent
package = Path(sys.argv[1]).resolve(strict=True)
if json.loads((package / 'package.json').read_text())['version'] != '0.65.0':
    raise SystemExit('Refusing an unpinned native Gemini package.')
bundle = package / 'bundle'
target = bundle / 'chunk-DKZARV6U.js'
original = target.read_bytes()
if hashlib.sha256(original).hexdigest() != '439a87bb21b7c5f172d959f99629d74637cf847a4ddb9a684dbffa280b7cc68b':
    raise SystemExit('Refusing changed native Gemini tracker input.')
if (bundle / 'hive-gemini-history.mjs').read_bytes() != (here / 'history.mjs').read_bytes():
    raise SystemExit('Refusing a different native Gemini history helper.')
helper = bundle / 'hive-gemini-tracker-history.mjs'
if helper.exists() or helper.is_symlink():
    raise SystemExit('Refusing an existing native Gemini tracker helper.')
source = original.decode()


def replace(before, after):
    global source
    if source.count(before) != 1:
        raise SystemExit('Ambiguous native tracker context; no files changed.')
    source = source.replace(before, after)


replace('''  getProjectTempTrackerDir() {
    if (this.sessionId) {
      return path4.join(this.getProjectTempDir(), this.sessionId, "tracker");
    }
    return path4.join(this.getProjectTempDir(), "tracker");
  }''', '''  getProjectTempTrackerDir() {
    const temporary = this.getProjectTempDir();
    const file = this.sessionId ? path4.join(temporary, this.sessionId, "tracker") : path4.join(temporary, "tracker");
    return registerNativeGeminiTracker(temporary, this.sessionId, file);
  }''')
replace('''  async ensureInitialized() {
    if (!this.initialized) {
      await fs70.mkdir(this.tasksDir, { recursive: true });''', '''  async ensureInitialized() {
    if (nativeGeminiHistorySelected()) {
      initializeNativeGeminiTracker(this, TrackerTaskSchema);
      this.initialized = true;
      return;
    }
    if (!this.initialized) {
      await fs70.mkdir(this.tasksDir, { recursive: true });''')
replace('''  async readJsonFile(filePath, schema2) {
    try {
      const content = await fs70.readFile''', '''  async readJsonFile(filePath, schema2) {
    if (nativeGeminiHistorySelected()) return readNativeGeminiTrackerFile(this, filePath, TrackerTaskSchema);
    try {
      const content = await fs70.readFile''')
replace('''  async getTask(id) {
    await this.ensureInitialized();
    const taskPath = path82.join''', '''  async getTask(id) {
    await this.ensureInitialized();
    if (nativeGeminiHistorySelected()) return readNativeGeminiTracker(this, id, TrackerTaskSchema);
    const taskPath = path82.join''')
replace('''  async listTasks() {
    await this.ensureInitialized();
    try {
      const files = await fs70.readdir''', '''  async listTasks() {
    await this.ensureInitialized();
    if (nativeGeminiHistorySelected()) return listNativeGeminiTracker(this, TrackerTaskSchema);
    try {
      const files = await fs70.readdir''')
replace('''    TrackerTaskSchema.parse(task);
    await this.saveTask(task);''', '''    TrackerTaskSchema.parse(task);
    await this.saveTask(task, void 0, true);''')
replace('''    TrackerTaskSchema.parse(updatedTask);
    await this.saveTask(updatedTask);''', '''    TrackerTaskSchema.parse(updatedTask);
    await this.saveTask(updatedTask, task);''')
replace('''  async saveTask(task) {
    const taskPath = path82.join''', '''  async saveTask(task, expectedTask, creating = false) {
    if (nativeGeminiHistorySelected()) return saveNativeGeminiTracker(this, task, TrackerTaskSchema, expectedTask, creating);
    const taskPath = path82.join''')
source = 'import { registerNativeGeminiTracker, initializeNativeGeminiTracker, readNativeGeminiTracker, listNativeGeminiTracker, readNativeGeminiTrackerFile, saveNativeGeminiTracker } from "./hive-gemini-tracker-history.mjs";\n' + source
if '--check' in sys.argv[2:]:
    print('Pinned native Gemini tracker selector applies; no files changed.')
else:
    if target.is_symlink():
        target.unlink()
    target.write_text(source)
    helper.write_text((here / 'tracker_history.mjs').read_text())
    print('Applied disposable native Gemini tracker history; production is unchanged.')
print('Native tracker manager SHA-256:', hashlib.sha256(source.encode()).hexdigest())
print('Native tracker helper SHA-256:', hashlib.sha256((here / 'tracker_history.mjs').read_bytes()).hexdigest())
