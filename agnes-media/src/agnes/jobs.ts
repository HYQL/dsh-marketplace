/**
 * Durable job store.
 *
 * The panel can be closed, the page reloaded, or the Host restarted while a
 * video renders. Everything the panel shows therefore lives here, in one JSON
 * file under the store directory, written atomically (tmp + rename).
 *
 * On boot, jobs that were `queued`/`running` are marked `interrupted` but keep
 * their `videoId`: the panel offers "resume", and resuming continues polling the
 * task that is still running server-side instead of creating (and paying for)
 * a second one.
 *
 * @module agnes-media/agnes/jobs
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Job, JobKind, JobSource, JobStatus } from '../types.ts'

interface StoreFile {
  version: 1
  jobs: Job[]
}

const RUNNING: ReadonlySet<JobStatus> = new Set<JobStatus>(['queued', 'running'])

export class JobStore {
  readonly #path: string
  readonly #max: number
  #jobs: Job[] = []
  #loaded = false
  #writeChain: Promise<void> = Promise.resolve()

  constructor(dir: string, max: number) {
    this.#path = join(dir, 'jobs.json')
    this.#max = Math.max(0, max)
  }

  get file(): string { return this.#path }

  async load(): Promise<void> {
    if (this.#loaded) return
    this.#loaded = true
    try {
      const text = await readFile(this.#path, 'utf8')
      const parsed = JSON.parse(text) as StoreFile
      if (Array.isArray(parsed?.jobs)) {
        this.#jobs = parsed.jobs.filter(isJob)
        // A job that was in flight when the process stopped is no longer being
        // worked on; keep it (and its videoId) so it can be resumed.
        for (const job of this.#jobs) {
          if (RUNNING.has(job.status)) {
            job.status = 'interrupted'
            job.phase = 'error'
            job.updatedAt = Date.now()
          }
        }
      }
    } catch {
      this.#jobs = []
    }
    this.#trim()
  }

  list(): Job[] {
    return [...this.#jobs].sort((a, b) => b.createdAt - a.createdAt)
  }

  get(id: string): Job | undefined {
    return this.#jobs.find((j) => j.id === id)
  }

  add(kind: JobKind, prompt: string, model: string, params: Record<string, unknown>, source: JobSource = 'panel'): Job {
    const now = Date.now()
    const job: Job = {
      id: `job_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      kind,
      source,
      prompt,
      model,
      params,
      status: 'queued',
      progress: 0,
      phase: 'queued',
      videoId: null,
      urls: [],
      downloads: [],
      error: null,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
      resumed: false,
      attempts: 0,
      retryAt: null,
      rateLimited: false,
    }
    this.#jobs.unshift(job)
    this.#trim()
    this.#persist()
    return job
  }

  update(id: string, patch: Partial<Job>): Job | undefined {
    const job = this.get(id)
    if (job === undefined) return undefined
    Object.assign(job, patch, { updatedAt: Date.now() })
    if (job.status === 'completed' || job.status === 'failed'
      || job.status === 'cancelled' || job.status === 'interrupted') {
      job.finishedAt = job.finishedAt ?? Date.now()
    }
    this.#persist()
    return job
  }
  remove(id: string): boolean {
    const before = this.#jobs.length
    this.#jobs = this.#jobs.filter((j) => j.id !== id)
    if (this.#jobs.length !== before) this.#persist()
    return this.#jobs.length !== before
  }

  clear(): void {
    this.#jobs = []
    this.#persist()
  }

  #trim(): void {
    if (this.#max > 0 && this.#jobs.length > this.#max) this.#jobs.length = this.#max
  }

  /** Serialized atomic write; never throws into the caller. */
  #persist(): void {
    const body: StoreFile = { version: 1, jobs: this.#jobs }
    const text = JSON.stringify(body)
    this.#writeChain = this.#writeChain.then(async () => {
      try {
        await mkdir(dirname(this.#path), { recursive: true })
        const tmp = `${this.#path}.${process.pid}.tmp`
        await writeFile(tmp, text, 'utf8')
        await rename(tmp, this.#path)
      } catch {
        // The store is a cache of UI state; losing a write must not fail a job.
      }
    })
  }

  async flush(): Promise<void> {
    await this.#writeChain
  }
}

function isJob(v: unknown): v is Job {
  if (typeof v !== 'object' || v === null) return false
  const j = v as Partial<Job>
  if (typeof j.id !== 'string' || typeof j.createdAt !== 'number') return false
  if (j.kind !== 'image' && j.kind !== 'video') return false
  // Older store files predate the retry bookkeeping; fill it in on load.
  if (typeof j.attempts !== 'number') (j as Job).attempts = 0
  if (j.retryAt === undefined) (j as Job).retryAt = null
  if (typeof j.rateLimited !== 'boolean') (j as Job).rateLimited = false
  if (j.source !== 'agent') (j as { source: JobSource }).source = 'panel'
  return true
}
