import { createHash } from 'node:crypto';
import { ATTRIBUTION_CLIENTS, buildEvidenceDirectory, buildSessionEvidence, describeAttributionClient } from '../src/formal-ai-attribution.lib.mjs';

const admitted = new WeakMap();
export const generatedEvidencePaths = (witness, files) => {
  const record = admitted.get(witness);
  const paths = Array.isArray(files) ? files : [];
  return record && paths.length === record.inputPaths.length && new Set(paths).size === paths.length && paths.every(path => record.inputPaths.includes(path)) ? record.files : [];
};

// These four data artifacts are produced by the existing session/attribution owners.
// This binds a diff exemption, not provider authenticity or source safety.
export async function collectGeneratedEvidence({ changes, issueNumber, pullRequest, tool, model, version, readBlob, readTree }) {
  if (model !== 'formal-ai' || !['agent', 'claude', 'codex'].includes(tool) || !Number.isSafeInteger(issueNumber) || issueNumber < 1 || !Number.isSafeInteger(pullRequest?.number) || pullRequest.number < 1 || typeof pullRequest.headRefName !== 'string' || !/^[a-f0-9]{40}$/.test(pullRequest.headRefOid || '') || !/^\d+\.\d+\.\d+$/.test(version || '')) return null;
  const rows = Array.isArray(changes) ? changes : [];
  const prefix = 'dev/log/issues/' + issueNumber + '/pulls/' + pullRequest.number + '/sessions/';
  const metadataRows = rows.filter(row => row.filename?.startsWith(prefix) && /^[A-Za-z0-9._-]+\/metadata\.json$/.test(row.filename.slice(prefix.length)));
  if (metadataRows.length !== 1) return null;
  const metadataRow = metadataRows[0];
  const sessionId = metadataRow.filename.slice(prefix.length, -'/metadata.json'.length);
  const sessionRoot = prefix + sessionId;
  const evidenceRoot = buildEvidenceDirectory({ issueNumber });
  const files = [metadataRow.filename, sessionRoot + '/solve.log', evidenceRoot + '/' + describeAttributionClient(tool).streamFilename, evidenceRoot + '/session-id.txt'];
  if (new Set(rows.map(row => row.filename)).size !== rows.length || files.some(file => !rows.some(row => row.filename === file && /^[a-f0-9]{40}$/.test(row.sha || '') && ['added', 'modified'].includes(row.status)))) return null;
  const read = async filename => {
    const row = rows.find(entry => entry.filename === filename);
    const blob = await readBlob(row.sha);
    if (blob?.sha !== row.sha || blob.encoding !== 'base64' || !Number.isSafeInteger(blob.size) || blob.size < 1 || blob.size > 65536 || typeof blob.content !== 'string') throw new Error('Invalid generated evidence blob');
    const content = Buffer.from(blob.content.replace(/\n/g, ''), 'base64');
    if (
      content.length !== blob.size ||
      content.toString('base64') !== blob.content.replace(/\n/g, '') ||
      createHash('sha1')
        .update('blob ' + content.length + '\0')
        .update(content)
        .digest('hex') !== row.sha
    )
      throw new Error('Generated evidence blob identity mismatch');
    return new TextDecoder('utf-8', { fatal: true }).decode(content);
  };
  try {
    const tree = await readTree(pullRequest.headRefOid);
    if (
      tree?.truncated !== false ||
      !Array.isArray(tree.tree) ||
      files.some(file => {
        const entries = tree.tree.filter(entry => entry.path === file);
        return entries.length !== 1 || entries[0].type !== 'blob' || !['100644', '100755'].includes(entries[0].mode) || entries[0].sha !== rows.find(row => row.filename === file).sha;
      })
    )
      return null;
    const metadata = JSON.parse(await read(metadataRow.filename));
    if (metadata.tool === null && Object.values(ATTRIBUTION_CLIENTS).some(client => client.streamFilename !== describeAttributionClient(tool).streamFilename && rows.some(row => row.filename === evidenceRoot + '/' + client.streamFilename))) return null;
    if (metadata.schemaVersion !== 3 || (metadata.issueNumber !== issueNumber && metadata.issueNumber !== String(issueNumber)) || metadata.prNumber !== pullRequest.number || metadata.branchName !== pullRequest.headRefName || (metadata.tool !== tool && metadata.tool !== null) || metadata.sessionId !== sessionId || metadata.developmentLogDirectory !== './dev/log/issues/' + issueNumber + '/pulls/' + pullRequest.number || metadata.artifacts?.solveLog !== './' + sessionRoot + '/solve.log' || !Array.isArray(metadata.artifacts?.sessionFiles) || metadata.artifacts.sessionFiles.length !== 0) return null;
    if ((await read(evidenceRoot + '/session-id.txt')) !== buildSessionEvidence({ sessionId, version })) return null;
    const witness = Object.freeze({ issueNumber, pullRequestNumber: pullRequest.number, tool, sessionId });
    admitted.set(witness, Object.freeze({ files: Object.freeze(files), inputPaths: Object.freeze(rows.map(row => row.filename)) }));
    return witness;
  } catch {
    return null;
  }
}
