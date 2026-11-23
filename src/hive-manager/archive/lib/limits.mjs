export const MiB = 1024 * 1024;
export const transcriptPartBytes = 40 * MiB;
export const archiveArtifactBytes = 64 * MiB;
export const archiveBatchBytes = 256 * MiB;
export const archiveManifestBytes = MiB;
export const archiveMaxArtifacts = 300;

export class ArchiveLimitError extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

export function numberedPart(stem, number, extension) {
  return `${stem}.part-${String(number).padStart(3, '0')}.${extension}`;
}
