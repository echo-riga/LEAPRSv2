import type { AttachmentJobInput, UploadTarget } from './background-attachments';

export type UploadJob = AttachmentJobInput & { target: UploadTarget; label: string; status: 'pending' | 'uploading' | 'failed' | 'completed' | 'cancelled'; progress: number; attempts: number; error?: string; sessionUrl?: string; fileId?: string };
export type UploadTransport = (job: UploadJob, progress: (value: number) => void, signal: AbortSignal, checkpoint: () => Promise<void>) => Promise<void>;
export type UploadPersistence = { load(): Promise<UploadJob[]>; save(job: UploadJob, onlyIfMissing?: boolean): Promise<void>; exclusive(run: () => Promise<void>): Promise<void> };

// One upload at a time. Retry the same job, never its record-creation action.
export class BackgroundUploadQueue {
  jobs: UploadJob[] = [];
  private running = false;
  private controller = new AbortController();
  private pendingWrites: Promise<void> = Promise.resolve();
  storageError?: string;
  constructor(private transport: UploadTransport, private changed: () => void, private pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)), private persistence?: UploadPersistence) {}
  start() { void this.run(); }
  enqueue(target: UploadTarget, label: string, inputs: AttachmentJobInput[]) {
    for (const input of inputs) {
      const existing = this.jobs.find(job => job.uploadId === input.uploadId);
      if (!existing) this.jobs.push({ ...input, target, label, status: 'pending', progress: 0, attempts: 0 });
      else if (existing.status === 'failed') { existing.file = input.file; existing.status = 'pending'; existing.attempts = 0; existing.error = undefined; }
    }
    if (this.persistence) {
      const pending = this.jobs.filter(job => !['completed', 'cancelled'].includes(job.status));
      this.pendingWrites = this.pendingWrites.then(async () => {
        for (const job of pending) await this.persistence!.save(job, true);
      });
      void this.pendingWrites.catch(error => {
        this.storageError = error instanceof Error ? error.message : 'Unable to save uploads.';
        for (const job of pending) { job.status = 'failed'; job.error = this.storageError; }
        this.changed();
      });
    }
    this.changed();
    void this.run();
  }
  retry(id: string) {
    const job = this.jobs.find(item => item.uploadId === id && item.status === 'failed');
    if (job) { job.status = 'pending'; job.attempts = 0; job.error = undefined; this.changed(); void this.run(); }
  }
  dismissCompleted() { this.jobs = this.jobs.filter(job => job.status !== 'completed'); this.changed(); }
  stop() { this.controller.abort(); }
  get unfinished() { return this.jobs.some(job => !['completed', 'cancelled'].includes(job.status)); }
  private async run() {
    if (this.running || this.controller.signal.aborted) return;
    this.running = true;
    try {
      if (this.persistence) {
        await this.pendingWrites;
        this.pendingWrites = Promise.resolve();
        await this.persistence.exclusive(async () => {
          if (this.controller.signal.aborted) return;
          const saved = await this.persistence!.load();
          for (const prior of saved) {
            const existing = this.jobs.find(job => job.uploadId === prior.uploadId);
            if (['completed', 'cancelled'].includes(prior.status)) {
              if (existing) Object.assign(existing, prior);
              continue;
            }
            if (!existing) this.jobs.push({ ...prior, status: prior.status === 'uploading' ? 'pending' : prior.status });
            // A different tab may have checkpointed the same job more recently.
            else if (prior.sessionUrl || prior.fileId) Object.assign(existing, { sessionUrl: prior.sessionUrl, fileId: prior.fileId });
          }
          this.storageError = undefined;
          this.changed();
          await this.process();
        });
      } else await this.process();
    } catch (error) {
      this.storageError = error instanceof Error ? error.message : 'Unable to restore uploads.';
      this.pendingWrites = Promise.resolve();
      for (const job of this.jobs) if (job.status === 'pending') { job.status = 'failed'; job.error = this.storageError; }
      this.changed();
    } finally { this.running = false; }
  }
  private async process() {
      // Persist queued files before starting any remote transfer.
      for (const job of this.jobs) if (!['completed', 'cancelled'].includes(job.status)) await this.persistence?.save(job);
      let job: UploadJob | undefined;
      while (!this.controller.signal.aborted && (job = this.jobs.find(item => item.status === 'pending'))) {
        job.status = 'uploading';
        while (!this.controller.signal.aborted) {
          job.attempts++;
          this.changed();
          try {
            const current = job;
            await this.persistence?.save(current);
            await this.transport(current, progress => { current.progress = progress; this.changed(); }, this.controller.signal, async () => { await this.persistence?.save(current); });
            if ((job as UploadJob).status !== 'cancelled') job.status = 'completed';
            job.progress = 100; job.error = undefined;
            // Release potentially large File bytes after successful persistence.
            job.file = new File([], job.file.name, { type: job.file.type });
            await this.persistence?.save(job);
            break;
          } catch (error) {
            if (this.controller.signal.aborted) return;
            job.error = error instanceof Error ? error.message : 'Upload failed.';
            await this.persistence?.save(job);
            if (job.attempts >= 3) { job.status = 'failed'; break; }
            await this.pause(1000 * 2 ** (job.attempts - 1));
          }
        }
        await this.persistence?.save(job);
        this.changed();
      }
  }
}
