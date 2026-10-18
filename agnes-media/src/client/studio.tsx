/**
 * Agnes Media Studio — the studio view.
 *
 * One component tree for both seats (the drawer and the sidebar panel), so the
 * two entries can never drift apart. Everything is driven by Host state: the
 * component posts a job and renders the Host's job list, so closing the drawer
 * or reloading the page loses nothing.
 *
 * @module agnes-media/client/studio
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JobView, ProbeInfo } from '../types.ts'
import { api, type CreateVideoInput } from './api.ts'
import type { LocaleKey } from './locales.ts'
import { formatBytes, MAX_REFERENCES, toReferenceImages, type ReferenceImage } from './upload.ts'

export type Translate = (key: LocaleKey) => string

export type MediaMode = 'image' | 'video'
export type ViewTab = 'image' | 'video' | 'history'

export interface StudioProps {
  t: Translate
  /** `drawer` shows its own close button and fills the sliding panel. */
  variant?: 'page' | 'drawer'
  /** Drawer chrome (header close button) is shown only in the drawer seat. */
  onClose?: (() => void) | undefined
  /** Optional sink for "send to chat"; absent when no session is bound. */
  sendToChat?: ((text: string) => void) | undefined
}

const IMAGE_SIZES = ['1K', '2K', '3K', '4K'] as const
const IMAGE_RATIOS = ['1:1', '3:4', '4:3', '16:9', '9:16', '2:3', '3:2', '21:9'] as const
const VIDEO_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] as const
const VIDEO_SECONDS = ['4', '5', '6', '8', '10', '12'] as const
const VIDEO_MODES = ['text', 'keyframe', 'reference', 'fromImage'] as const

/** size × ratio → pixels, mirroring the published table. */
const PIXELS: Record<string, Record<string, string>> = {
  '1:1': { '1K': '1024×1024', '2K': '2048×2048', '3K': '3072×3072', '4K': '4096×4096' },
  '3:4': { '1K': '864×1152', '2K': '1728×2304', '3K': '2592×3456', '4K': '3456×4608' },
  '4:3': { '1K': '1152×864', '2K': '2304×1728', '3K': '3456×2592', '4K': '4608×3456' },
  '16:9': { '1K': '1312×736', '2K': '2624×1472', '3K': '3936×2208', '4K': '5248×2944' },
  '9:16': { '1K': '736×1312', '2K': '1472×2624', '3K': '2208×3936', '4K': '2944×5248' },
  '2:3': { '1K': '832×1248', '2K': '1664×2496', '3K': '2496×3744', '4K': '3328×4992' },
  '3:2': { '1K': '1248×832', '2K': '2496×1664', '3K': '3744×2496', '4K': '4992×3328' },
  '21:9': { '1K': '1568×672', '2K': '3136×1344', '3K': '4704×2016', '4K': '6272×2688' },
}

const ACTIVE: ReadonlySet<string> = new Set(['queued', 'running'])

export function Studio(props: StudioProps): React.ReactElement {
  const { t } = props

  const [tab, setTab] = useState<ViewTab>('image')
  const [prompt, setPrompt] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [size, setSize] = useState<string>('1K')
  const [ratio, setRatio] = useState<string>('1:1')
  const [seed, setSeed] = useState<string>('')
  const [negative, setNegative] = useState('')

  const [vRatio, setVRatio] = useState<string>('16:9')
  const [vSeconds, setVSeconds] = useState<string>('5')
  const [vMode, setVMode] = useState<(typeof VIDEO_MODES)[number]>('text')
  const [firstFrame, setFirstFrame] = useState('')
  const [lastFrame, setLastFrame] = useState('')
  const [refImages, setRefImages] = useState('')
  const [refAudios, setRefAudios] = useState('')
  const [fromImagePrompt, setFromImagePrompt] = useState('')

  const [jobs, setJobs] = useState<readonly JobView[]>([])
  const [probe, setProbe] = useState<ProbeInfo | null>(null)
  const [probeError, setProbeError] = useState<string | null>(null)
  const promptRef = useRef<HTMLTextAreaElement | null>(null)

  /** Image-to-image / composition references, held as data URIs. */
  const [refs, setRefs] = useState<readonly ReferenceImage[]>([])
  const [refError, setRefError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const addFiles = useCallback(async (files: readonly File[]): Promise<void> => {
    if (files.length === 0) return
    setRefError(null)
    const { added, errors } = await toReferenceImages(files, refs.length)
    if (added.length > 0) setRefs((current) => [...current, ...added].slice(0, MAX_REFERENCES))
    if (errors.length > 0) setRefError(errors.join(' · '))
  }, [refs.length])

  // --- host polling -------------------------------------------------------
  // One timer for the whole view: the Host owns job state, so a single poll
  // keeps every card current regardless of which tab is open.
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = async (): Promise<void> => {
      try {
        const list = await api.jobs()
        if (!alive) return
        setJobs(list)
        const running = list.some((j) => ACTIVE.has(j.status))
        timer = setTimeout(() => { void tick() }, running ? 1_200 : 4_000)
      } catch (e) {
        if (!alive) return
        setProbeError(e instanceof Error ? e.message : String(e))
        timer = setTimeout(() => { void tick() }, 6_000)
      }
    }
    void tick()
    return () => {
      alive = false
      if (timer !== null) clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    let alive = true
    void api.probe()
      .then((p) => { if (alive) { setProbe(p); setProbeError(null) } })
      .catch((e: unknown) => { if (alive) setProbeError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [])

  useEffect(() => { promptRef.current?.focus() }, [])

  const activeJob = useMemo(() => jobs.find((j) => ACTIVE.has(j.status)) ?? null, [jobs])

  const submit = useCallback(async (): Promise<void> => {
    const text = prompt.trim()
    if (text.length === 0) { setError(t('error.noPrompt')); return }
    if (busy) { setError(t('error.busy')); return }
    if (probe !== null && !probe.keyConfigured) { setError(t('error.noKey')); return }
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      const seedValue = Number.parseInt(seed, 10)
      const common = {
        prompt: text,
        ...(Number.isFinite(seedValue) ? { seed: seedValue } : {}),
        ...(negative.trim().length > 0 ? { negative_prompt: negative.trim() } : {}),
      }
      if (tab === 'video') {
        const input: CreateVideoInput = {
          ...common,
          aspect_ratio: vRatio,
          seconds: vSeconds,
        }
        if (vMode === 'keyframe') {
          input.mode = 'keyframe'
          if (firstFrame.trim().length > 0) input.first_frame = firstFrame.trim()
          if (lastFrame.trim().length > 0) input.last_frame = lastFrame.trim()
          if (input.first_frame === undefined && input.last_frame === undefined) {
            throw new Error('keyframe mode needs a first or last frame URL')
          }
        } else if (vMode === 'reference') {
          input.mode = 'reference'
          const images = lines(refImages)
          const audios = lines(refAudios)
          if (images.length === 0 && audios.length === 0) {
            throw new Error('reference mode needs image or audio URLs')
          }
          if (images.length > 0) input.images = images.slice(0, 5)
          if (audios.length > 0) input.audios = audios.slice(0, 3)
        } else if (vMode === 'fromImage') {
          input.mode = 'keyframe'
          input.from_image_prompt = fromImagePrompt.trim().length > 0 ? fromImagePrompt.trim() : text
        } else {
          input.mode = 'text'
        }
        await api.createVideo(input)
      } else {
        await api.createImage({
          ...common,
          size,
          ratio,
          ...(refs.length > 0 ? { image: refs.map((r) => r.dataUri) } : {}),
        })
      }
      setPrompt('')
      setRefs([])
      const fresh = await api.jobs()
      setJobs(fresh)
    } catch (e) {
      setError(`${t('error.prefix')}：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }, [prompt, busy, probe, tab, seed, negative, size, ratio, refs, vRatio, vSeconds, vMode,
    firstFrame, lastFrame, refImages, refAudios, fromImagePrompt, t])

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      void submit()
    }
    if (e.key === 'Escape' && props.onClose !== undefined) {
      e.preventDefault()
      props.onClose()
    }
  }, [submit, props])

  const sendToChat = useCallback((job: JobView): void => {
    if (props.sendToChat === undefined) return
    props.sendToChat(renderForChat(job))
    setNotice(t('action.inserted'))
    setTimeout(() => setNotice(null), 1_600)
  }, [props, t])

  const reuse = useCallback((job: JobView): void => {
    setPrompt(job.prompt)
    setTab(job.kind === 'image' ? 'image' : 'video')
    if (job.kind === 'image') {
      if (typeof job.params.size === 'string') setSize(job.params.size)
      if (typeof job.params.ratio === 'string') setRatio(job.params.ratio)
    } else {
      if (typeof job.params.aspect_ratio === 'string') setVRatio(job.params.aspect_ratio)
      if (typeof job.params.seconds === 'string') setVSeconds(job.params.seconds)
      if (job.params.mode === 'keyframe') setVMode('keyframe')
      else if (job.params.mode === 'reference') setVMode('reference')
      else setVMode('text')
    }
    promptRef.current?.focus()
  }, [])

  /**
   * Feed a finished image back in as a reference.
   *
   * This is the fastest real workflow the panel has: generate something, then
   * ask for a variation of *that* result without downloading it first.
   *
   * The bytes come through the Host, not from the page: the CDN sends no CORS
   * headers, so a cross-origin `fetch()` in the browser fails with
   * "Failed to fetch".
   */
  const useAsReference = useCallback(async (job: JobView): Promise<void> => {
    if (refs.length >= MAX_REFERENCES) { setRefError(t('label.references.full')); return }
    if (job.kind !== 'image') { setRefError(t('error.notImage')); return }
    setRefError(null)
    try {
      const { dataUri, name } = await api.inlineReference(job.id)
      setRefs((current) => [...current, {
        id: `ref_${job.id}`,
        dataUri,
        name,
        bytes: Math.round(dataUri.length * 0.75),
        preview: dataUri,
      }].slice(0, MAX_REFERENCES))
      setTab('image')
    } catch (e) {
      setRefError(e instanceof Error ? e.message : String(e))
    }
  }, [refs.length, t])

  const running = activeJob !== null
  const statusTone = probeError !== null ? 'error'
    : probe !== null && !probe.keyConfigured ? 'warn'
    : running ? 'accent' : 'success'
  const statusText = probeError !== null ? t('error.host')
    : probe === null ? t('status.loading')
    : !probe.keyConfigured ? t('status.noKey')
    : running ? `${t('status.running')} · ${activeJob?.progress ?? 0}%`
    : t('status.keyReady')

  const pixelHint = PIXELS[ratio]?.[size] ?? ''
  const variant = props.variant ?? 'drawer'

  return (
    <div data-agnes-root="" className={`ag-studio ag-studio-${variant}`}>
      <div className="ag-head">
        <span className="ag-head-icon" aria-hidden="true"><IconSpark /></span>
        <span className="ag-head-text">
          <span className="ag-head-title">{t('panel.title')}</span>
          <span className="ag-head-sub">{probe?.imageModel ?? 'agnes-image-2.5-flash'}</span>
        </span>
        {props.onClose !== undefined
          ? <button type="button" className="ag-icon-btn" onClick={props.onClose} aria-label={t('action.close')} title={t('action.close')}><IconClose /></button>
          : null}
      </div>

      <div className="ag-tabs" role="tablist">
        {(['image', 'video', 'history'] as const).map((key) => (
          <button key={key} type="button" role="tab" className="ag-tab" data-active={tab === key}
            aria-selected={tab === key} onClick={() => setTab(key)}>
            {key === 'image' ? t('tab.image') : key === 'video' ? t('tab.video') : t('tab.gallery')}
            {key === 'history' && jobs.length > 0 ? <span className="ag-tab-badge">{jobs.length}</span> : null}
          </button>
        ))}
      </div>

      <div className="ag-body">
        {tab === 'history'
          ? <HistoryList jobs={jobs} t={t} onReuse={reuse} onUseAsReference={useAsReference} onSend={props.sendToChat !== undefined ? sendToChat : undefined} />
          : (
            <>
              <div className="ag-field">
                <div className="ag-label-row">
                  <span className="ag-label">{t('label.prompt')}</span>
                  <span className="ag-value">{prompt.length > 0 ? prompt.length : ''}</span>
                </div>
                <textarea
                  ref={promptRef}
                  className="ag-textarea"
                  value={prompt}
                  rows={4}
                  disabled={running}
                  placeholder={tab === 'video' ? t('label.prompt.videoPlaceholder') : t('label.prompt.placeholder')}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={onKeyDown}
                  aria-label={t('label.prompt')}
                />
              </div>

              {tab === 'image' ? (
                <>
                  <div className="ag-field">
                    <div className="ag-label-row">
                      <span className="ag-label">{t('label.ratio')}</span>
                      <span className="ag-value">{pixelHint}</span>
                    </div>
                    <div className="ag-chips">
                      {IMAGE_RATIOS.map((r) => (
                        <button key={r} type="button" className="ag-chip" data-active={ratio === r}
                          disabled={running} onClick={() => setRatio(r)} aria-pressed={ratio === r}>
                          <span className="ag-chip-ratio"><RatioBox value={r} />{r}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="ag-field">
                    <span className="ag-label">{t('label.size')}</span>
                    <div className="ag-chips">
                      {IMAGE_SIZES.map((s) => (
                        <button key={s} type="button" className="ag-chip" data-active={size === s}
                          disabled={running} onClick={() => setSize(s)} aria-pressed={size === s}>{s}</button>
                      ))}
                    </div>
                  </div>

                  {/* Image-to-image / multi-image composition references. */}
                  <div className="ag-field">
                    <div className="ag-label-row">
                      <span className="ag-label">{t('label.references')}</span>
                      <span className="ag-value">
                        {refs.length > 0 ? `${refs.length}/${MAX_REFERENCES}` : t('label.references.optional')}
                      </span>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      hidden
                      onChange={(e) => {
                        const files = [...(e.target.files ?? [])]
                        e.target.value = ''
                        void addFiles(files)
                      }}
                    />
                    {refs.length > 0 ? (
                      <div className="ag-refs">
                        {refs.map((ref) => (
                          <span key={ref.id} className="ag-ref" title={`${ref.name} · ${formatBytes(ref.bytes)}`}>
                            <img src={ref.preview} alt={ref.name} />
                            <button
                              type="button"
                              className="ag-ref-x"
                              aria-label={t('action.remove')}
                              disabled={running}
                              onClick={() => setRefs((current) => current.filter((r) => r.id !== ref.id))}
                            >✕</button>
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div
                      className="ag-drop"
                      data-over={dragOver ? 'true' : 'false'}
                      role="button"
                      tabIndex={0}
                      onClick={() => fileInputRef.current?.click()}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click() } }}
                      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={(e) => {
                        e.preventDefault()
                        setDragOver(false)
                        void addFiles([...e.dataTransfer.files])
                      }}
                    >
                      {refs.length >= MAX_REFERENCES ? t('label.references.full') : t('label.references.drop')}
                    </div>
                    {refError !== null ? <div className="ag-alert" data-tone="warn">{refError}</div> : null}
                  </div>
                </>
              ) : (
                <>
                  <div className="ag-field">
                    <span className="ag-label">{t('label.mode')}</span>
                    <div className="ag-seg" role="group" aria-label={t('label.mode')}>
                      {VIDEO_MODES.map((m) => (
                        <button key={m} type="button" className="ag-seg-item" data-active={vMode === m}
                          disabled={running} onClick={() => setVMode(m)}>
                          {t(m === 'text' ? 'mode.text' : m === 'keyframe' ? 'mode.keyframe' : m === 'reference' ? 'mode.reference' : 'mode.fromImage')}
                        </button>
                      ))}
                    </div>
                  </div>

                  {vMode === 'keyframe' ? (
                    <>
                      <Field label={t('label.firstFrame')}>
                        <input className="ag-input" value={firstFrame} disabled={running}
                          placeholder="https://…/first.png" onChange={(e) => setFirstFrame(e.target.value)} />
                      </Field>
                      <Field label={t('label.lastFrame')}>
                        <input className="ag-input" value={lastFrame} disabled={running}
                          placeholder="https://…/last.png" onChange={(e) => setLastFrame(e.target.value)} />
                      </Field>
                    </>
                  ) : null}

                  {vMode === 'reference' ? (
                    <>
                      <Field label={t('label.referenceImages')}>
                        <textarea className="ag-textarea" style={{ minHeight: 56 }} value={refImages} disabled={running}
                          placeholder={'https://…/a.png\nhttps://…/b.png'} onChange={(e) => setRefImages(e.target.value)} />
                      </Field>
                      <Field label={t('label.referenceAudios')}>
                        <textarea className="ag-textarea" style={{ minHeight: 44 }} value={refAudios} disabled={running}
                          placeholder="https://…/voice.mp3" onChange={(e) => setRefAudios(e.target.value)} />
                      </Field>
                    </>
                  ) : null}

                  {vMode === 'fromImage' ? (
                    <Field label={t('label.fromImagePrompt')} hint={t('label.fromImageHint')}>
                      <input className="ag-input" value={fromImagePrompt} disabled={running}
                        placeholder={t('label.prompt.placeholder')} onChange={(e) => setFromImagePrompt(e.target.value)} />
                    </Field>
                  ) : null}

                  <div className="ag-field">
                    <div className="ag-label-row">
                      <span className="ag-label">{t('label.ratio')}</span>
                      <span className="ag-value">{vRatio} · 720P</span>
                    </div>
                    <div className="ag-chips">
                      {VIDEO_RATIOS.map((r) => (
                        <button key={r} type="button" className="ag-chip" data-active={vRatio === r}
                          disabled={running} onClick={() => setVRatio(r)} aria-pressed={vRatio === r}>
                          <span className="ag-chip-ratio"><RatioBox value={r} />{r}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="ag-field">
                    <span className="ag-label">{t('label.duration')}</span>
                    <div className="ag-chips">
                      {VIDEO_SECONDS.map((s) => (
                        <button key={s} type="button" className="ag-chip" data-active={vSeconds === s}
                          disabled={running} onClick={() => setVSeconds(s)} aria-pressed={vSeconds === s}>
                          {s}{t('label.seconds')}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <button type="button" className="ag-disclosure" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>
                <span aria-hidden="true">{advanced ? '▾' : '▸'}</span>{t('label.advanced')}
              </button>
              {advanced ? (
                <div className="ag-advanced">
                  <Field label={t('label.seed')}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input className="ag-input" value={seed} inputMode="numeric" placeholder="—" disabled={running}
                        onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ''))} />
                      <button type="button" className="ag-btn ag-btn-sm" disabled={running}
                        title={t('action.seedRandom')}
                        onClick={() => setSeed(String(Math.floor(Math.random() * 2 ** 31)))}>⟳</button>
                    </div>
                  </Field>
                  <Field label={t('label.negative')}>
                    <input className="ag-input" value={negative} disabled={running}
                      placeholder={t('label.negative.placeholder')} onChange={(e) => setNegative(e.target.value)} />
                  </Field>
                </div>
              ) : null}

              <div className="ag-actions">
                <span className="ag-status">
                  <span className="ag-dot" data-tone={statusTone} data-pulse={running ? 'true' : 'false'} />
                  {statusText}
                </span>
                <span style={{ flex: 1 }} />
                {running && activeJob !== null ? (
                  <button type="button" className="ag-btn" onClick={() => { void api.cancelJob(activeJob.id) }}>
                    {t('action.cancel')}
                  </button>
                ) : null}
                <button type="button" className="ag-btn ag-btn-primary"
                  disabled={running || prompt.trim().length === 0}
                  data-busy={running ? 'true' : 'false'}
                  title={t('hint.shortcut')}
                  onClick={() => void submit()}>
                  {running ? t('status.running') : t('action.generate')}
                </button>
              </div>

              {error !== null ? <div className="ag-alert" role="alert">{error}</div> : null}
              {notice !== null ? <div className="ag-alert" data-tone="warn">{notice}</div> : null}
              {probeError !== null ? <div className="ag-alert">{probeError}</div> : null}
              {probe !== null && !probe.keyConfigured
                ? <div className="ag-alert" data-tone="warn">{t('error.noKey')}<br />{t('key.hint')}</div>
                : null}

              <div className="ag-section-head">
                <span className="ag-section-title">{t('history.title')}</span>
                <span className="ag-value">{t('history.count').replace('{n}', String(jobs.length))}</span>
              </div>
              <HistoryList
                jobs={jobs.slice(0, 6)}
                t={t}
                compact
                onReuse={reuse}
                onUseAsReference={useAsReference}
                onSend={props.sendToChat !== undefined ? sendToChat : undefined}
                empty={(
                  <div className="ag-empty">
                    <span>{t('history.empty')}</span>
                    <small>{t('history.emptyHint')}</small>
                  </div>
                )}
              />
            </>
          )}
      </div>

      <div className="ag-foot">
        {/*
         * The footer shows state, not a keyboard hint: the shortcut belongs on
         * the Generate button's own tooltip (where the action is), and "Esc
         * closes" is false on the page seat, which has nothing to close.
         */}
        <span>{t('hint.count').replace('{n}', String(jobs.length))}</span>
        {probe?.storeDir !== undefined && probe.storeDir.length > 0
          ? <code title={probe.storeDir}>{probe.storeDir}</code>
          : null}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

interface HistoryProps {
  jobs: readonly JobView[]
  t: Translate
  compact?: boolean
  empty?: React.ReactNode
  onReuse(job: JobView): void
  onUseAsReference?: ((job: JobView) => void | Promise<void>) | undefined
  onSend?: ((job: JobView) => void) | undefined
}

function HistoryList(props: HistoryProps): React.ReactElement {
  const { jobs, t } = props
  if (jobs.length === 0) {
    return <>{props.empty ?? <div className="ag-empty"><span>{t('history.empty')}</span></div>}</>
  }
  return (
    <div className="ag-grid">
      {jobs.map((job) => (
        <JobCard
          key={job.id}
          job={job}
          t={t}
          onReuse={props.onReuse}
          onUseAsReference={props.onUseAsReference}
          onSend={props.onSend}
        />
      ))}
    </div>
  )
}

function JobCard(props: {
  job: JobView
  t: Translate
  onReuse(job: JobView): void
  onUseAsReference?: ((job: JobView) => void | Promise<void>) | undefined
  onSend?: ((job: JobView) => void) | undefined
}): React.ReactElement {
  const { job, t } = props
  const [copied, setCopied] = useState(false)
  const url = job.urls[0] ?? ''
  const local = job.downloads[0] ?? ''
  const statusKey = (`status.${job.status}`) as LocaleKey

  const copy = (): void => {
    void navigator.clipboard?.writeText(job.prompt)
    setCopied(true)
    setTimeout(() => setCopied(false), 1_200)
  }

  return (
    <article className="ag-card" data-status={job.status}>
      <div className="ag-thumb">
        {job.kind === 'image' && url.length > 0
          ? <img src={url} alt={job.prompt} loading="lazy" />
          : job.kind === 'video' && url.length > 0
            ? <video src={url} muted loop playsInline preload="metadata" controls />
            : <span className="ag-thumb-icon" aria-hidden="true">
                {ACTIVE.has(job.status) ? <IconSpinner /> : job.kind === 'video' ? <IconFilm /> : <IconImage />}
              </span>}
        <span className="ag-thumb-badge">{job.kind === 'image' ? t('tab.image') : t('tab.video')}</span>
        {job.source === 'agent'
          ? <span className="ag-thumb-badge" data-kind="agent" title={t('history.agent')}>{t('history.agent')}</span>
          : null}
      </div>
      <div className="ag-card-body">
        <div className="ag-card-prompt" title={job.prompt}>{job.prompt}</div>
        <div className="ag-card-meta">
          <span className="ag-dot" data-tone={toneOf(job.status)} data-pulse={ACTIVE.has(job.status) ? 'true' : 'false'} />
          <span>{t(statusKey)}</span>
          {ACTIVE.has(job.status) ? <span>{job.progress}%</span> : null}
          {job.status === 'queued' && job.retryAt !== null
            ? <span>{t('status.retryIn').replace('{n}', String(Math.max(0, Math.round((job.retryAt - Date.now()) / 1000))))}</span>
            : null}
          <span>·</span>
          <span>{job.model}</span>
        </div>
        {ACTIVE.has(job.status)
          ? <div className="ag-progress"><div className="ag-progress-bar" style={{ width: `${Math.max(4, job.progress)}%` }} /></div>
          : null}
        {job.status === 'queued' && job.retryAt !== null
          ? <div className="ag-card-meta" data-tone="warn">{t('status.rateLimited')}</div>
          : null}
        {job.error !== null ? <div className="ag-alert" data-tone="warn">{job.error}</div> : null}
        <div className="ag-card-actions">
          {url.length > 0
            ? <a className="ag-link-btn" href={url} target="_blank" rel="noreferrer">{t('action.open')}</a>
            : null}
          {local.length > 0
            ? <button type="button" className="ag-link-btn" data-tone="muted" title={local}
                onClick={() => void navigator.clipboard?.writeText(local)}>{t('action.download')}</button>
            : null}
          <button type="button" className="ag-link-btn" data-tone="muted" onClick={copy}>
            {copied ? t('action.copied') : t('action.copyPrompt')}
          </button>
          <button type="button" className="ag-link-btn" data-tone="muted" onClick={() => props.onReuse(job)}>
            {t('action.reuse')}
          </button>
          {/* Only images can become a reference; a video has no usable still. */}
          {props.onUseAsReference !== undefined && job.kind === 'image' && url.length > 0
            ? <button type="button" className="ag-link-btn" onClick={() => void props.onUseAsReference?.(job)}>
                {t('action.asReference')}
              </button>
            : null}
          {props.onSend !== undefined
            ? <button type="button" className="ag-link-btn" onClick={() => props.onSend?.(job)}>{t('action.insert')}</button>
            : null}
          {ACTIVE.has(job.status)
            ? <button type="button" className="ag-link-btn" data-tone="muted" onClick={() => { void api.cancelJob(job.id) }}>{t('action.cancel')}</button>
            : null}
          {job.status === 'interrupted' && job.kind === 'video'
            ? <button type="button" className="ag-link-btn" onClick={() => { void api.resumeJob(job.id) }}>{t('action.resume')}</button>
            : null}
          {job.status === 'failed' || job.status === 'cancelled'
            ? <button type="button" className="ag-link-btn" onClick={() => { void api.retryJob(job.id) }}>{t('action.retry')}</button>
            : null}
          <button type="button" className="ag-link-btn" data-tone="muted" onClick={() => { void api.removeJob(job.id) }}>
            {t('action.remove')}
          </button>
        </div>
      </div>
    </article>
  )
}

function toneOf(status: string): string {
  switch (status) {
    case 'completed': return 'success'
    case 'failed': return 'error'
    case 'cancelled':
    case 'interrupted': return 'warn'
    case 'running':
    case 'queued': return 'accent'
    default: return 'accent'
  }
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

function Field(props: { label: string; hint?: string; children: React.ReactNode }): React.ReactElement {
  return (
    <label className="ag-field">
      <span className="ag-label">{props.label}</span>
      {props.children}
      {props.hint !== undefined ? <span className="ag-value">{props.hint}</span> : null}
    </label>
  )
}

function RatioBox(props: { value: string }): React.ReactElement {
  const [w, h] = props.value.split(':').map((n) => Number.parseInt(n, 10))
  const scale = 12 / Math.max(w ?? 1, h ?? 1)
  return <span className="ag-ratio-box" style={{ width: Math.max(4, (w ?? 1) * scale), height: Math.max(4, (h ?? 1) * scale) }} />
}

function lines(raw: string): string[] {
  return raw.split(/[\r\n,]+/).map((s) => s.trim()).filter((s) => s.length > 0)
}

/** The chat text a user gets from "send to chat". */
export function renderForChat(job: JobView): string {
  const url = job.urls[0] ?? ''
  const local = job.downloads[0] ?? ''
  const head = job.kind === 'image' ? '🎨 **图片已生成**' : '🎬 **视频已生成**'
  const parts = [head, `- 提示词：${job.prompt}`, `- 模型：${job.model}`]
  if (url.length > 0) parts.push('', job.kind === 'image' ? `![${job.prompt}](${url})` : `[▶ 在线播放](${url})`)
  if (local.length > 0) parts.push('', `- 本地文件：${local}`)
  return parts.join('\n')
}

// --- icons (inline, currentColor, no external assets) -----------------------

function IconSpark(): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 1.5l1.6 4.2L14 7.3l-4.4 1.6L8 13.1 6.4 8.9 2 7.3l4.4-1.6z" />
    </svg>
  )
}
function IconClose(): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  )
}
function IconImage(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" /><circle cx="9" cy="10" r="1.6" /><path d="M4 17l4.5-4.5L13 17l3-3 4 4" />
    </svg>
  )
}
function IconFilm(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M7 5v14M17 5v14M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4" />
    </svg>
  )
}
function IconSpinner(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 3a9 9 0 1 0 9 9" opacity=".9">
        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite" />
      </path>
    </svg>
  )
}

/** Sidebar / entry icon: a frame with a spark. */
export function EntryIcon(props: { size?: number }): React.ReactElement {
  const s = props.size ?? 14
  return (
    <svg viewBox="0 0 16 16" width={s} height={s} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="1.6" y="3" width="12.8" height="10" rx="2.4" />
      <path d="M4.4 10.2l2.2-2.4 1.9 2 1.3-1.4 1.8 1.8" />
      <path d="M10.6 4.9l.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5z" />
    </svg>
  )
}
