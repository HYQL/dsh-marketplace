window.__ModuleLoader__.load({ id: "agnes-media", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name,
  renderForChat: () => renderForChat
});
module.exports = __toCommonJS(index_exports);
var import_react3 = require("react");

// src/client/studio.tsx
var import_react = require("react");

// src/client/api.ts
var API_BASE = "/agnes-media-studio/api";
async function call(endpoint, payload, method = "POST") {
  const res = await fetch(`${API_BASE}/${endpoint}`, method === "GET" ? { method, cache: "no-store" } : {
    method,
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload ?? {})
  });
  let parsed = null;
  try {
    parsed = await res.json();
  } catch {
    throw new Error(`HTTP ${res.status}`);
  }
  if (res.ok && parsed?.ok === true) return parsed.value;
  throw new Error(parsed?.error?.message ?? `HTTP ${res.status}`);
}
var api = {
  probe: () => call("probe", {}, "GET"),
  entries: () => call("entries", {}, "GET"),
  setEntries: (patch) => call("setEntries", patch),
  /**
   * Bundle package names the profile selects.
   *
   * The entry switches are keyed by *bundle* name, so this is how the browser
   * learns which bundle page it should mount them on without hard-coding one.
   * Read from the profile manifest on the Host, so it needs no network.
   */
  bundles: () => call("bundles", void 0, "GET"),
  jobs: () => call("jobs", void 0, "GET"),
  createImage: (input) => call("createImage", input),
  createVideo: (input) => call("createVideo", input),
  cancelJob: (id) => call("cancelJob", { id }),
  removeJob: (id) => call("removeJob", { id }),
  clearJobs: () => call("clearJobs", {}),
  resumeJob: (id) => call("resumeJob", { id }),
  retryJob: (id) => call("retryJob", { id }),
  /**
   * Fetch a finished job's media as a data URI through the Host.
   *
   * The CDN sends no CORS headers, so the page cannot fetch it directly; the
   * Host can, and it already holds the key.
   */
  inlineReference: (id) => call("inlineReference", { id }),
  getVideoTask: (videoId, model) => call("getVideoTask", { video_id: videoId, model })
};

// src/client/upload.ts
var MAX_EDGE = 2048;
var PASSTHROUGH_BYTES = 1.5 * 1024 * 1024;
var MAX_SOURCE_BYTES = 24 * 1024 * 1024;
var MAX_REFERENCES = 5;
var UploadError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "UploadError";
  }
};
var counter = 0;
async function toReferenceImage(file) {
  if (!file.type.startsWith("image/")) {
    throw new UploadError(`not an image: ${file.name}`);
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new UploadError(`file too large: ${file.name} (${formatBytes(file.size)})`);
  }
  const dataUri = file.size <= PASSTHROUGH_BYTES ? await readAsDataUri(file) : await downscale(file);
  counter += 1;
  return {
    id: `ref_${Date.now().toString(36)}_${counter}`,
    dataUri,
    name: file.name,
    bytes: Math.round(dataUri.length * 0.75),
    preview: dataUri
  };
}
async function toReferenceImages(files, already) {
  const room = Math.max(0, MAX_REFERENCES - already);
  const picked = [...files].slice(0, room);
  const added = [];
  const errors = [];
  if (files.length > room) errors.push(`only ${MAX_REFERENCES} reference images are used`);
  for (const file of picked) {
    try {
      added.push(await toReferenceImage(file));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { added, errors };
}
function readAsDataUri(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string" && result.startsWith("data:")) resolve(result);
      else reject(new UploadError(`could not read ${file.name}`));
    };
    reader.onerror = () => reject(new UploadError(`could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}
async function downscale(file) {
  const bitmap = await loadBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new UploadError("canvas unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);
  if (typeof bitmap.close === "function") bitmap.close();
  const keepAlpha = file.type === "image/png" || file.type === "image/webp";
  const encoded = keepAlpha ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.92);
  if (!encoded.startsWith("data:")) throw new UploadError(`could not encode ${file.name}`);
  return encoded;
}
async function loadBitmap(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new UploadError(`could not decode ${file.name}`));
      el.src = url;
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// src/client/studio.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var IMAGE_SIZES = ["1K", "2K", "3K", "4K"];
var IMAGE_RATIOS = ["1:1", "3:4", "4:3", "16:9", "9:16", "2:3", "3:2", "21:9"];
var VIDEO_RATIOS = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
var VIDEO_SECONDS = ["4", "5", "6", "8", "10", "12"];
var VIDEO_MODES = ["text", "keyframe", "reference", "fromImage"];
var PIXELS = {
  "1:1": { "1K": "1024\xD71024", "2K": "2048\xD72048", "3K": "3072\xD73072", "4K": "4096\xD74096" },
  "3:4": { "1K": "864\xD71152", "2K": "1728\xD72304", "3K": "2592\xD73456", "4K": "3456\xD74608" },
  "4:3": { "1K": "1152\xD7864", "2K": "2304\xD71728", "3K": "3456\xD72592", "4K": "4608\xD73456" },
  "16:9": { "1K": "1312\xD7736", "2K": "2624\xD71472", "3K": "3936\xD72208", "4K": "5248\xD72944" },
  "9:16": { "1K": "736\xD71312", "2K": "1472\xD72624", "3K": "2208\xD73936", "4K": "2944\xD75248" },
  "2:3": { "1K": "832\xD71248", "2K": "1664\xD72496", "3K": "2496\xD73744", "4K": "3328\xD74992" },
  "3:2": { "1K": "1248\xD7832", "2K": "2496\xD71664", "3K": "3744\xD72496", "4K": "4992\xD73328" },
  "21:9": { "1K": "1568\xD7672", "2K": "3136\xD71344", "3K": "4704\xD72016", "4K": "6272\xD72688" }
};
var ACTIVE = /* @__PURE__ */ new Set(["queued", "running"]);
function Studio(props) {
  const { t } = props;
  const [tab, setTab] = (0, import_react.useState)("image");
  const [prompt, setPrompt] = (0, import_react.useState)("");
  const [advanced, setAdvanced] = (0, import_react.useState)(false);
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [error, setError] = (0, import_react.useState)(null);
  const [notice, setNotice] = (0, import_react.useState)(null);
  const [size, setSize] = (0, import_react.useState)("1K");
  const [ratio, setRatio] = (0, import_react.useState)("1:1");
  const [seed, setSeed] = (0, import_react.useState)("");
  const [negative, setNegative] = (0, import_react.useState)("");
  const [vRatio, setVRatio] = (0, import_react.useState)("16:9");
  const [vSeconds, setVSeconds] = (0, import_react.useState)("5");
  const [vMode, setVMode] = (0, import_react.useState)("text");
  const [firstFrame, setFirstFrame] = (0, import_react.useState)("");
  const [lastFrame, setLastFrame] = (0, import_react.useState)("");
  const [refImages, setRefImages] = (0, import_react.useState)("");
  const [refAudios, setRefAudios] = (0, import_react.useState)("");
  const [fromImagePrompt, setFromImagePrompt] = (0, import_react.useState)("");
  const [jobs, setJobs] = (0, import_react.useState)([]);
  const [probe, setProbe] = (0, import_react.useState)(null);
  const [probeError, setProbeError] = (0, import_react.useState)(null);
  const promptRef = (0, import_react.useRef)(null);
  const [refs, setRefs] = (0, import_react.useState)([]);
  const [refError, setRefError] = (0, import_react.useState)(null);
  const [dragOver, setDragOver] = (0, import_react.useState)(false);
  const fileInputRef = (0, import_react.useRef)(null);
  const addFiles = (0, import_react.useCallback)(async (files) => {
    if (files.length === 0) return;
    setRefError(null);
    const { added, errors } = await toReferenceImages(files, refs.length);
    if (added.length > 0) setRefs((current) => [...current, ...added].slice(0, MAX_REFERENCES));
    if (errors.length > 0) setRefError(errors.join(" \xB7 "));
  }, [refs.length]);
  (0, import_react.useEffect)(() => {
    let alive = true;
    let timer = null;
    const tick = async () => {
      try {
        const list = await api.jobs();
        if (!alive) return;
        setJobs(list);
        const running2 = list.some((j) => ACTIVE.has(j.status));
        timer = setTimeout(() => {
          void tick();
        }, running2 ? 1200 : 4e3);
      } catch (e) {
        if (!alive) return;
        setProbeError(e instanceof Error ? e.message : String(e));
        timer = setTimeout(() => {
          void tick();
        }, 6e3);
      }
    };
    void tick();
    return () => {
      alive = false;
      if (timer !== null) clearTimeout(timer);
    };
  }, []);
  (0, import_react.useEffect)(() => {
    let alive = true;
    void api.probe().then((p) => {
      if (alive) {
        setProbe(p);
        setProbeError(null);
      }
    }).catch((e) => {
      if (alive) setProbeError(e instanceof Error ? e.message : String(e));
    });
    return () => {
      alive = false;
    };
  }, []);
  (0, import_react.useEffect)(() => {
    promptRef.current?.focus();
  }, []);
  const activeJob = (0, import_react.useMemo)(() => jobs.find((j) => ACTIVE.has(j.status)) ?? null, [jobs]);
  const submit = (0, import_react.useCallback)(async () => {
    const text = prompt.trim();
    if (text.length === 0) {
      setError(t("error.noPrompt"));
      return;
    }
    if (busy) {
      setError(t("error.busy"));
      return;
    }
    if (probe !== null && !probe.keyConfigured) {
      setError(t("error.noKey"));
      return;
    }
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const seedValue = Number.parseInt(seed, 10);
      const common = {
        prompt: text,
        ...Number.isFinite(seedValue) ? { seed: seedValue } : {},
        ...negative.trim().length > 0 ? { negative_prompt: negative.trim() } : {}
      };
      if (tab === "video") {
        const input = {
          ...common,
          aspect_ratio: vRatio,
          seconds: vSeconds
        };
        if (vMode === "keyframe") {
          input.mode = "keyframe";
          if (firstFrame.trim().length > 0) input.first_frame = firstFrame.trim();
          if (lastFrame.trim().length > 0) input.last_frame = lastFrame.trim();
          if (input.first_frame === void 0 && input.last_frame === void 0) {
            throw new Error("keyframe mode needs a first or last frame URL");
          }
        } else if (vMode === "reference") {
          input.mode = "reference";
          const images = lines(refImages);
          const audios = lines(refAudios);
          if (images.length === 0 && audios.length === 0) {
            throw new Error("reference mode needs image or audio URLs");
          }
          if (images.length > 0) input.images = images.slice(0, 5);
          if (audios.length > 0) input.audios = audios.slice(0, 3);
        } else if (vMode === "fromImage") {
          input.mode = "keyframe";
          input.from_image_prompt = fromImagePrompt.trim().length > 0 ? fromImagePrompt.trim() : text;
        } else {
          input.mode = "text";
        }
        await api.createVideo(input);
      } else {
        await api.createImage({
          ...common,
          size,
          ratio,
          ...refs.length > 0 ? { image: refs.map((r) => r.dataUri) } : {}
        });
      }
      setPrompt("");
      setRefs([]);
      const fresh = await api.jobs();
      setJobs(fresh);
    } catch (e) {
      setError(`${t("error.prefix")}\uFF1A${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [
    prompt,
    busy,
    probe,
    tab,
    seed,
    negative,
    size,
    ratio,
    refs,
    vRatio,
    vSeconds,
    vMode,
    firstFrame,
    lastFrame,
    refImages,
    refAudios,
    fromImagePrompt,
    t
  ]);
  const onKeyDown = (0, import_react.useCallback)((e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void submit();
    }
    if (e.key === "Escape" && props.onClose !== void 0) {
      e.preventDefault();
      props.onClose();
    }
  }, [submit, props]);
  const sendToChat2 = (0, import_react.useCallback)((job) => {
    if (props.sendToChat === void 0) return;
    props.sendToChat(renderForChat(job));
    setNotice(t("action.inserted"));
    setTimeout(() => setNotice(null), 1600);
  }, [props, t]);
  const reuse = (0, import_react.useCallback)((job) => {
    setPrompt(job.prompt);
    setTab(job.kind === "image" ? "image" : "video");
    if (job.kind === "image") {
      if (typeof job.params.size === "string") setSize(job.params.size);
      if (typeof job.params.ratio === "string") setRatio(job.params.ratio);
    } else {
      if (typeof job.params.aspect_ratio === "string") setVRatio(job.params.aspect_ratio);
      if (typeof job.params.seconds === "string") setVSeconds(job.params.seconds);
      if (job.params.mode === "keyframe") setVMode("keyframe");
      else if (job.params.mode === "reference") setVMode("reference");
      else setVMode("text");
    }
    promptRef.current?.focus();
  }, []);
  const useAsReference = (0, import_react.useCallback)(async (job) => {
    if (refs.length >= MAX_REFERENCES) {
      setRefError(t("label.references.full"));
      return;
    }
    if (job.kind !== "image") {
      setRefError(t("error.notImage"));
      return;
    }
    setRefError(null);
    try {
      const { dataUri, name: name2 } = await api.inlineReference(job.id);
      setRefs((current) => [...current, {
        id: `ref_${job.id}`,
        dataUri,
        name: name2,
        bytes: Math.round(dataUri.length * 0.75),
        preview: dataUri
      }].slice(0, MAX_REFERENCES));
      setTab("image");
    } catch (e) {
      setRefError(e instanceof Error ? e.message : String(e));
    }
  }, [refs.length, t]);
  const running = activeJob !== null;
  const statusTone = probeError !== null ? "error" : probe !== null && !probe.keyConfigured ? "warn" : running ? "accent" : "success";
  const statusText = probeError !== null ? t("error.host") : probe === null ? t("status.loading") : !probe.keyConfigured ? t("status.noKey") : running ? `${t("status.running")} \xB7 ${activeJob?.progress ?? 0}%` : t("status.keyReady");
  const pixelHint = PIXELS[ratio]?.[size] ?? "";
  const variant = props.variant ?? "drawer";
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { "data-agnes-root": "", className: `ag-studio ag-studio-${variant}`, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ag-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ag-head-icon", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IconSpark, {}) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "ag-head-text", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ag-head-title", children: t("panel.title") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ag-head-sub", children: probe?.imageModel ?? "agnes-image-2.5-flash" })
      ] }),
      props.onClose !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "ag-icon-btn", onClick: props.onClose, "aria-label": t("action.close"), title: t("action.close"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IconClose, {}) }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "ag-tabs", role: "tablist", children: ["image", "video", "history"].map((key) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "button",
      {
        type: "button",
        role: "tab",
        className: "ag-tab",
        "data-active": tab === key,
        "aria-selected": tab === key,
        onClick: () => setTab(key),
        children: [
          key === "image" ? t("tab.image") : key === "video" ? t("tab.video") : t("tab.gallery"),
          key === "history" && jobs.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ag-tab-badge", children: jobs.length }) : null
        ]
      },
      key
    )) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "ag-body", children: tab === "history" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(HistoryList, { jobs, t, onReuse: reuse, onUseAsReference: useAsReference, onSend: props.sendToChat !== void 0 ? sendToChat2 : void 0 }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ag-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ag-label-row", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ag-label", children: t("label.prompt") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ag-value", children: prompt.length > 0 ? prompt.length : "" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "textarea",
          {
            ref: promptRef,
            className: "ag-textarea",
            value: prompt,
            rows: 4,
            disabled: running,
            placeholder: tab === "video" ? t("label.prompt.videoPlaceholder") : t("label.prompt.placeholder"),
            onChange: (e) => setPrompt(e.target.value),
            onKeyDown,
            "aria-label": t("label.prompt")
          }
        )
      ] }),
      tab === "image" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ag-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ag-label-row", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ag-label", children: t("label.ratio") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ag-value", children: pixelHint })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "ag-chips", children: IMAGE_RATIOS.map((r) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "button",
            {
              type: "button",
              className: "ag-chip",
              "data-active": ratio === r,
              disabled: running,
              onClick: () => setRatio(r),
              "aria-pressed": ratio === r,
              children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "ag-chip-ratio", children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RatioBox, { value: r }),
                r
              ] })
            },
            r
          )) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ag-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ag-label", children: t("label.size") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "ag-chips", children: IMAGE_SIZES.map((s) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "button",
            {
              type: "button",
              className: "ag-chip",
              "data-active": size === s,
              disabled: running,
              onClick: () => setSize(s),
              "aria-pressed": size === s,
              children: s
            },
            s
          )) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ag-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ag-label-row", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ag-label", children: t("label.references") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ag-value", children: refs.length > 0 ? `${refs.length}/${MAX_REFERENCES}` : t("label.references.optional") })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "input",
            {
              ref: fileInputRef,
              type: "file",
              accept: "image/*",
              multiple: true,
              hidden: true,
              onChange: (e) => {
                const files = [...e.target.files ?? []];
                e.target.value = "";
                void addFiles(files);
              }
            }
          ),
          refs.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "ag-refs", children: refs.map((ref) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "ag-ref", title: `${ref.name} \xB7 ${formatBytes(ref.bytes)}`, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", { src: ref.preview, alt: ref.name }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "button",
              {
                type: "button",
                className: "ag-ref-x",
                "aria-label": t("action.remove"),
                disabled: running,
                onClick: () => setRefs((current) => current.filter((r) => r.id !== ref.id)),
                children: "\u2715"
              }
            )
          ] }, ref.id)) }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "div",
            {
              className: "ag-drop",
              "data-over": dragOver ? "true" : "false",
              role: "button",
              tabIndex: 0,
              onClick: () => fileInputRef.current?.click(),
              onKeyDown: (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              },
              onDragOver: (e) => {
                e.preventDefault();
                setDragOver(true);
              },
              onDragLeave: () => setDragOver(false),
              onDrop: (e) => {
                e.preventDefault();
                setDragOver(false);
                void addFiles([...e.dataTransfer.files]);
              },
              children: refs.length >= MAX_REFERENCES ? t("label.references.full") : t("label.references.drop")
            }
          ),
          refError !== null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "ag-alert", "data-tone": "warn", children: refError }) : null
        ] })
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ag-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ag-label", children: t("label.mode") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "ag-seg", role: "group", "aria-label": t("label.mode"), children: VIDEO_MODES.map((m) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "button",
            {
              type: "button",
              className: "ag-seg-item",
              "data-active": vMode === m,
              disabled: running,
              onClick: () => setVMode(m),
              children: t(m === "text" ? "mode.text" : m === "keyframe" ? "mode.keyframe" : m === "reference" ? "mode.reference" : "mode.fromImage")
            },
            m
          )) })
        ] }),
        vMode === "keyframe" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: t("label.firstFrame"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "input",
            {
              className: "ag-input",
              value: firstFrame,
              disabled: running,
              placeholder: "https://\u2026/first.png",
              onChange: (e) => setFirstFrame(e.target.value)
            }
          ) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: t("label.lastFrame"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "input",
            {
              className: "ag-input",
              value: lastFrame,
              disabled: running,
              placeholder: "https://\u2026/last.png",
              onChange: (e) => setLastFrame(e.target.value)
            }
          ) })
        ] }) : null,
        vMode === "reference" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: t("label.referenceImages"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "textarea",
            {
              className: "ag-textarea",
              style: { minHeight: 56 },
              value: refImages,
              disabled: running,
              placeholder: "https://\u2026/a.png\nhttps://\u2026/b.png",
              onChange: (e) => setRefImages(e.target.value)
            }
          ) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: t("label.referenceAudios"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "textarea",
            {
              className: "ag-textarea",
              style: { minHeight: 44 },
              value: refAudios,
              disabled: running,
              placeholder: "https://\u2026/voice.mp3",
              onChange: (e) => setRefAudios(e.target.value)
            }
          ) })
        ] }) : null,
        vMode === "fromImage" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: t("label.fromImagePrompt"), hint: t("label.fromImageHint"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            className: "ag-input",
            value: fromImagePrompt,
            disabled: running,
            placeholder: t("label.prompt.placeholder"),
            onChange: (e) => setFromImagePrompt(e.target.value)
          }
        ) }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ag-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ag-label-row", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ag-label", children: t("label.ratio") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "ag-value", children: [
              vRatio,
              " \xB7 720P"
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "ag-chips", children: VIDEO_RATIOS.map((r) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "button",
            {
              type: "button",
              className: "ag-chip",
              "data-active": vRatio === r,
              disabled: running,
              onClick: () => setVRatio(r),
              "aria-pressed": vRatio === r,
              children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "ag-chip-ratio", children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RatioBox, { value: r }),
                r
              ] })
            },
            r
          )) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ag-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ag-label", children: t("label.duration") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "ag-chips", children: VIDEO_SECONDS.map((s) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
            "button",
            {
              type: "button",
              className: "ag-chip",
              "data-active": vSeconds === s,
              disabled: running,
              onClick: () => setVSeconds(s),
              "aria-pressed": vSeconds === s,
              children: [
                s,
                t("label.seconds")
              ]
            },
            s
          )) })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: "ag-disclosure", onClick: () => setAdvanced(!advanced), "aria-expanded": advanced, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { "aria-hidden": "true", children: advanced ? "\u25BE" : "\u25B8" }),
        t("label.advanced")
      ] }),
      advanced ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ag-advanced", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: t("label.seed"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 6 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "input",
            {
              className: "ag-input",
              value: seed,
              inputMode: "numeric",
              placeholder: "\u2014",
              disabled: running,
              onChange: (e) => setSeed(e.target.value.replace(/[^0-9]/g, ""))
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "button",
            {
              type: "button",
              className: "ag-btn ag-btn-sm",
              disabled: running,
              title: t("action.seedRandom"),
              onClick: () => setSeed(String(Math.floor(Math.random() * 2 ** 31))),
              children: "\u27F3"
            }
          )
        ] }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: t("label.negative"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            className: "ag-input",
            value: negative,
            disabled: running,
            placeholder: t("label.negative.placeholder"),
            onChange: (e) => setNegative(e.target.value)
          }
        ) })
      ] }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ag-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "ag-status", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ag-dot", "data-tone": statusTone, "data-pulse": running ? "true" : "false" }),
          statusText
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { flex: 1 } }),
        running && activeJob !== null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "ag-btn", onClick: () => {
          void api.cancelJob(activeJob.id);
        }, children: t("action.cancel") }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            type: "button",
            className: "ag-btn ag-btn-primary",
            disabled: running || prompt.trim().length === 0,
            "data-busy": running ? "true" : "false",
            title: t("hint.shortcut"),
            onClick: () => void submit(),
            children: running ? t("status.running") : t("action.generate")
          }
        )
      ] }),
      error !== null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "ag-alert", role: "alert", children: error }) : null,
      notice !== null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "ag-alert", "data-tone": "warn", children: notice }) : null,
      probeError !== null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "ag-alert", children: probeError }) : null,
      probe !== null && !probe.keyConfigured ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ag-alert", "data-tone": "warn", children: [
        t("error.noKey"),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("br", {}),
        t("key.hint")
      ] }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ag-section-head", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ag-section-title", children: t("history.title") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ag-value", children: t("history.count").replace("{n}", String(jobs.length)) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        HistoryList,
        {
          jobs: jobs.slice(0, 6),
          t,
          compact: true,
          onReuse: reuse,
          onUseAsReference: useAsReference,
          onSend: props.sendToChat !== void 0 ? sendToChat2 : void 0,
          empty: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ag-empty", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("history.empty") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: t("history.emptyHint") })
          ] })
        }
      )
    ] }) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ag-foot", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("hint.count").replace("{n}", String(jobs.length)) }),
      probe?.storeDir !== void 0 && probe.storeDir.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { title: probe.storeDir, children: probe.storeDir }) : null
    ] })
  ] });
}
function HistoryList(props) {
  const { jobs, t } = props;
  if (jobs.length === 0) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children: props.empty ?? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "ag-empty", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("history.empty") }) }) });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "ag-grid", children: jobs.map((job) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    JobCard,
    {
      job,
      t,
      onReuse: props.onReuse,
      onUseAsReference: props.onUseAsReference,
      onSend: props.onSend
    },
    job.id
  )) });
}
function JobCard(props) {
  const { job, t } = props;
  const [copied, setCopied] = (0, import_react.useState)(false);
  const url = job.urls[0] ?? "";
  const local = job.downloads[0] ?? "";
  const statusKey = `status.${job.status}`;
  const copy = () => {
    void navigator.clipboard?.writeText(job.prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { className: "ag-card", "data-status": job.status, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ag-thumb", children: [
      job.kind === "image" && url.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", { src: url, alt: job.prompt, loading: "lazy" }) : job.kind === "video" && url.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("video", { src: url, muted: true, loop: true, playsInline: true, preload: "metadata", controls: true }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ag-thumb-icon", "aria-hidden": "true", children: ACTIVE.has(job.status) ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IconSpinner, {}) : job.kind === "video" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IconFilm, {}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IconImage, {}) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ag-thumb-badge", children: job.kind === "image" ? t("tab.image") : t("tab.video") }),
      job.source === "agent" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ag-thumb-badge", "data-kind": "agent", title: t("history.agent"), children: t("history.agent") }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ag-card-body", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "ag-card-prompt", title: job.prompt, children: job.prompt }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ag-card-meta", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ag-dot", "data-tone": toneOf(job.status), "data-pulse": ACTIVE.has(job.status) ? "true" : "false" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t(statusKey) }),
        ACTIVE.has(job.status) ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
          job.progress,
          "%"
        ] }) : null,
        job.status === "queued" && job.retryAt !== null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("status.retryIn").replace("{n}", String(Math.max(0, Math.round((job.retryAt - Date.now()) / 1e3)))) }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\xB7" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: job.model })
      ] }),
      ACTIVE.has(job.status) ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "ag-progress", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "ag-progress-bar", style: { width: `${Math.max(4, job.progress)}%` } }) }) : null,
      job.status === "queued" && job.retryAt !== null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "ag-card-meta", "data-tone": "warn", children: t("status.rateLimited") }) : null,
      job.error !== null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "ag-alert", "data-tone": "warn", children: job.error }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ag-card-actions", children: [
        url.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", { className: "ag-link-btn", href: url, target: "_blank", rel: "noreferrer", children: t("action.open") }) : null,
        local.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            type: "button",
            className: "ag-link-btn",
            "data-tone": "muted",
            title: local,
            onClick: () => void navigator.clipboard?.writeText(local),
            children: t("action.download")
          }
        ) : null,
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "ag-link-btn", "data-tone": "muted", onClick: copy, children: copied ? t("action.copied") : t("action.copyPrompt") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "ag-link-btn", "data-tone": "muted", onClick: () => props.onReuse(job), children: t("action.reuse") }),
        props.onUseAsReference !== void 0 && job.kind === "image" && url.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "ag-link-btn", onClick: () => void props.onUseAsReference?.(job), children: t("action.asReference") }) : null,
        props.onSend !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "ag-link-btn", onClick: () => props.onSend?.(job), children: t("action.insert") }) : null,
        ACTIVE.has(job.status) ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "ag-link-btn", "data-tone": "muted", onClick: () => {
          void api.cancelJob(job.id);
        }, children: t("action.cancel") }) : null,
        job.status === "interrupted" && job.kind === "video" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "ag-link-btn", onClick: () => {
          void api.resumeJob(job.id);
        }, children: t("action.resume") }) : null,
        job.status === "failed" || job.status === "cancelled" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "ag-link-btn", onClick: () => {
          void api.retryJob(job.id);
        }, children: t("action.retry") }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "ag-link-btn", "data-tone": "muted", onClick: () => {
          void api.removeJob(job.id);
        }, children: t("action.remove") })
      ] })
    ] })
  ] });
}
function toneOf(status) {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
      return "error";
    case "cancelled":
    case "interrupted":
      return "warn";
    case "running":
    case "queued":
      return "accent";
    default:
      return "accent";
  }
}
function Field(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "ag-field", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ag-label", children: props.label }),
    props.children,
    props.hint !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ag-value", children: props.hint }) : null
  ] });
}
function RatioBox(props) {
  const [w, h] = props.value.split(":").map((n) => Number.parseInt(n, 10));
  const scale = 12 / Math.max(w ?? 1, h ?? 1);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ag-ratio-box", style: { width: Math.max(4, (w ?? 1) * scale), height: Math.max(4, (h ?? 1) * scale) } });
}
function lines(raw) {
  return raw.split(/[\r\n,]+/).map((s) => s.trim()).filter((s) => s.length > 0);
}
function renderForChat(job) {
  const url = job.urls[0] ?? "";
  const local = job.downloads[0] ?? "";
  const head = job.kind === "image" ? "\u{1F3A8} **\u56FE\u7247\u5DF2\u751F\u6210**" : "\u{1F3AC} **\u89C6\u9891\u5DF2\u751F\u6210**";
  const parts = [head, `- \u63D0\u793A\u8BCD\uFF1A${job.prompt}`, `- \u6A21\u578B\uFF1A${job.model}`];
  if (url.length > 0) parts.push("", job.kind === "image" ? `![${job.prompt}](${url})` : `[\u25B6 \u5728\u7EBF\u64AD\u653E](${url})`);
  if (local.length > 0) parts.push("", `- \u672C\u5730\u6587\u4EF6\uFF1A${local}`);
  return parts.join("\n");
}
function IconSpark() {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { viewBox: "0 0 16 16", width: "16", height: "16", fill: "none", stroke: "currentColor", strokeWidth: "1.3", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M8 1.5l1.6 4.2L14 7.3l-4.4 1.6L8 13.1 6.4 8.9 2 7.3l4.4-1.6z" }) });
}
function IconClose() {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { viewBox: "0 0 16 16", width: "14", height: "14", fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M4 4l8 8M12 4l-8 8" }) });
}
function IconImage() {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { viewBox: "0 0 24 24", width: "26", height: "26", fill: "none", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", { x: "3", y: "4.5", width: "18", height: "15", rx: "2.5" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "9", cy: "10", r: "1.6" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M4 17l4.5-4.5L13 17l3-3 4 4" })
  ] });
}
function IconFilm() {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { viewBox: "0 0 24 24", width: "26", height: "26", fill: "none", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", { x: "3", y: "5", width: "18", height: "14", rx: "2.5" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M7 5v14M17 5v14M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4" })
  ] });
}
function IconSpinner() {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { viewBox: "0 0 24 24", width: "24", height: "24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M12 3a9 9 0 1 0 9 9", opacity: ".9", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("animateTransform", { attributeName: "transform", type: "rotate", from: "0 12 12", to: "360 12 12", dur: "1s", repeatCount: "indefinite" }) }) });
}
function EntryIcon(props) {
  const s = props.size ?? 14;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { viewBox: "0 0 16 16", width: s, height: s, fill: "none", stroke: "currentColor", strokeWidth: "1.3", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", { x: "1.6", y: "3", width: "12.8", height: "10", rx: "2.4" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M4.4 10.2l2.2-2.4 1.9 2 1.3-1.4 1.8 1.8" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M10.6 4.9l.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5z" })
  ] });
}

// src/client/styles.ts
var STYLE_ID = "agnes-media-styles";
var CSS = `
[data-agnes-root] {
  --ag-bg: var(--dsw-alias-bg-layer-1, #1e1e20);
  --ag-bg-soft: var(--dsw-alias-bg-layer-2, #26262a);
  --ag-overlay: var(--dsw-alias-bg-overlay, #2a2a2e);
  --ag-fg: var(--dsw-alias-label-primary, #f2f2f5);
  --ag-fg-soft: var(--dsw-alias-label-secondary, #a8a8b3);
  --ag-border: var(--dsw-alias-border-l1, rgba(255,255,255,.10));
  --ag-border-strong: var(--dsw-alias-border-l2, rgba(255,255,255,.18));
  --ag-accent: var(--dsw-alias-brand-primary, #6ea8fe);
  --ag-accent-soft: color-mix(in srgb, var(--ag-accent) 16%, transparent);
  --ag-accent-line: color-mix(in srgb, var(--ag-accent) 45%, transparent);
  /*
   * Text that sits ON the accent fill. The app's base background is the
   * complement of the accent in every theme \u2014 near-white on a light theme's
   * saturated blue, near-black on a dark theme's pastel blue \u2014 so it is the one
   * token that always contrasts. A literal #fff fails in dark mode, where the
   * brand colour is light.
   */
  --ag-on-accent: var(--dsw-alias-bg-base, #0b1220);
  --ag-error: var(--dsw-alias-state-error-primary, #f87171);
  --ag-success: var(--dsw-alias-state-success-primary, #34d399);
  --ag-warn: var(--dsw-alias-state-warn-primary, #fbbf24);
  --ag-idle: var(--dsw-alias-state-idle-primary, #6b7280);
  --ag-radius: 10px;
  --ag-radius-sm: 7px;
  --ag-shadow: 0 18px 48px -12px rgba(0,0,0,.45), 0 2px 8px rgba(0,0,0,.18);
  color-scheme: light dark;
}

/* ---------- studio shell ---------- */
[data-agnes-root] .ag-studio { display: flex; flex-direction: column; min-height: 0; height: 100%; width: 100% }
[data-agnes-root] .ag-studio-drawer { flex: 1 }
[data-agnes-root] .ag-studio-page { max-width: 760px; margin: 0 auto; height: auto; min-height: 100% }
[data-agnes-root].ag-page {
  height: 100%; overflow-y: auto; background: var(--dsw-alias-bg-base, transparent);
  color: var(--ag-fg); padding: 22px 20px 28px; box-sizing: border-box;
}
[data-agnes-root] .ag-page-inner { max-width: 760px; margin: 0 auto }
[data-agnes-root] .ag-studio-page .ag-body { overflow: visible; padding-left: 0; padding-right: 0 }
[data-agnes-root] .ag-studio-page .ag-head { padding-left: 0; padding-right: 0 }
[data-agnes-root] .ag-studio-page .ag-tabs { padding-left: 0 }
[data-agnes-root] .ag-studio-page .ag-foot { padding-left: 0; padding-right: 0 }
[data-agnes-root] .ag-studio-page .ag-grid { grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)) }

/* ---------- drawer ---------- */
[data-agnes-root] .ag-scrim {
  position: fixed; inset: 0; z-index: 9997;
  background: color-mix(in srgb, #000 32%, transparent);
  backdrop-filter: blur(1.5px);
  animation: ag-fade .14s ease-out;
}
[data-agnes-root] .ag-drawer {
  position: fixed; top: 0; right: 0; bottom: 0; z-index: 9998;
  width: min(432px, 100vw);
  display: flex; flex-direction: column;
  background: var(--ag-bg);
  color: var(--ag-fg);
  border-left: 1px solid var(--ag-border-strong);
  box-shadow: var(--ag-shadow);
  font-size: 13px; line-height: 1.45;
  animation: ag-slide .18s cubic-bezier(.2,.7,.3,1);
}
[data-agnes-root] .ag-drawer > .ag-studio { flex: 1; min-height: 0 }
@keyframes ag-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes ag-slide { from { transform: translateX(16px); opacity: .4 } to { transform: none; opacity: 1 } }
@media (prefers-reduced-motion: reduce) {
  [data-agnes-root] .ag-drawer, [data-agnes-root] .ag-scrim { animation: none }
}

/* ---------- header ---------- */
[data-agnes-root] .ag-head {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; border-bottom: 1px solid var(--ag-border);
}
[data-agnes-root] .ag-head-icon {
  width: 30px; height: 30px; border-radius: 9px; flex: 0 0 30px;
  display: grid; place-items: center;
  background: var(--ag-accent-soft); color: var(--ag-accent);
}
[data-agnes-root] .ag-head-text { display: flex; flex-direction: column; min-width: 0; flex: 1 }
[data-agnes-root] .ag-head-title { font-size: 13px; font-weight: 600; letter-spacing: .01em }
[data-agnes-root] .ag-head-sub { font-size: 11px; color: var(--ag-fg-soft); white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
[data-agnes-root] .ag-icon-btn,
[data-agnes-root].ag-icon-btn {
  appearance: none; border: 1px solid transparent; background: transparent;
  color: var(--ag-fg-soft); cursor: pointer; border-radius: var(--ag-radius-sm);
  width: 28px; height: 28px; display: grid; place-items: center; flex: 0 0 28px;
  padding: 0;
}
[data-agnes-root] .ag-icon-btn:hover,
[data-agnes-root].ag-icon-btn:hover { color: var(--ag-fg); background: var(--ag-bg-soft); border-color: var(--ag-border) }
[data-agnes-root] .ag-icon-btn:focus-visible,
[data-agnes-root].ag-icon-btn:focus-visible { outline: 2px solid var(--ag-accent); outline-offset: 1px }

/* ---------- tabs ---------- */
[data-agnes-root] .ag-tabs { display: flex; gap: 2px; padding: 8px 12px 0 }
[data-agnes-root] .ag-tab {
  appearance: none; border: none; background: transparent; cursor: pointer;
  color: var(--ag-fg-soft); font: inherit; font-size: 12px;
  padding: 6px 12px 8px; border-radius: 8px 8px 0 0; position: relative;
  display: inline-flex; align-items: center; gap: 6px;
}
[data-agnes-root] .ag-tab:hover { color: var(--ag-fg) }
[data-agnes-root] .ag-tab[data-active="true"] { color: var(--ag-fg); font-weight: 600 }
[data-agnes-root] .ag-tab[data-active="true"]::after {
  content: ''; position: absolute; left: 10px; right: 10px; bottom: 0; height: 2px;
  border-radius: 2px; background: var(--ag-accent);
}
[data-agnes-root] .ag-tab-badge {
  font-size: 10px; padding: 0 5px; border-radius: 8px; line-height: 15px;
  background: var(--ag-accent-soft); color: var(--ag-accent);
}

/* ---------- body ---------- */
[data-agnes-root] .ag-body { flex: 1; overflow-y: auto; padding: 12px 14px 18px; display: flex; flex-direction: column; gap: 12px }
[data-agnes-root] .ag-body::-webkit-scrollbar { width: 10px }
[data-agnes-root] .ag-body::-webkit-scrollbar-thumb {
  background-color: color-mix(in srgb, var(--ag-fg-soft) 34%, transparent);
  border: 3px solid transparent; background-clip: padding-box; border-radius: 8px;
}

[data-agnes-root] .ag-field { display: flex; flex-direction: column; gap: 6px }
[data-agnes-root] .ag-label { font-size: 11px; color: var(--ag-fg-soft); font-weight: 500; letter-spacing: .02em }
[data-agnes-root] .ag-label-row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px }
[data-agnes-root] .ag-value { font-size: 11px; color: var(--ag-fg-soft); font-variant-numeric: tabular-nums }

[data-agnes-root] .ag-textarea,
[data-agnes-root] .ag-input {
  width: 100%; box-sizing: border-box; font: inherit; font-size: 13px;
  color: var(--ag-fg); background: var(--ag-bg-soft);
  border: 1px solid var(--ag-border); border-radius: var(--ag-radius-sm);
  padding: 8px 10px; transition: border-color .12s, box-shadow .12s;
}
[data-agnes-root] .ag-textarea { min-height: 88px; resize: vertical; line-height: 1.5 }
[data-agnes-root] .ag-input { padding: 6px 8px; font-size: 12px }
[data-agnes-root] .ag-textarea::placeholder,
[data-agnes-root] .ag-input::placeholder { color: color-mix(in srgb, var(--ag-fg-soft) 72%, transparent) }
[data-agnes-root] .ag-textarea:focus,
[data-agnes-root] .ag-input:focus {
  outline: none; border-color: var(--ag-accent);
  box-shadow: 0 0 0 3px var(--ag-accent-soft);
}
[data-agnes-root] .ag-textarea:disabled,
[data-agnes-root] .ag-input:disabled { opacity: .55; cursor: not-allowed }

/* ---------- chips ---------- */
[data-agnes-root] .ag-chips { display: flex; flex-wrap: wrap; gap: 6px }
[data-agnes-root] .ag-chip {
  appearance: none; cursor: pointer; font: inherit; font-size: 11.5px;
  padding: 5px 10px; border-radius: 999px;
  border: 1px solid var(--ag-border); background: transparent; color: var(--ag-fg-soft);
  transition: color .12s, border-color .12s, background .12s;
}
[data-agnes-root] .ag-chip:hover:not(:disabled) { color: var(--ag-fg); border-color: var(--ag-border-strong) }
[data-agnes-root] .ag-chip[data-active="true"] {
  color: var(--ag-accent); border-color: var(--ag-accent-line); background: var(--ag-accent-soft);
}
[data-agnes-root] .ag-chip:disabled { opacity: .5; cursor: not-allowed }
[data-agnes-root] .ag-chip-ratio { display: inline-flex; align-items: center; gap: 6px }
[data-agnes-root] .ag-ratio-box {
  display: inline-block; border: 1.5px solid currentColor; border-radius: 2px; opacity: .85;
}

/* ---------- segmented ---------- */
[data-agnes-root] .ag-seg { display: flex; padding: 2px; gap: 2px; background: var(--ag-bg-soft);
  border: 1px solid var(--ag-border); border-radius: var(--ag-radius-sm) }
[data-agnes-root] .ag-seg-item {
  flex: 1; appearance: none; border: none; background: transparent; cursor: pointer;
  font: inherit; font-size: 11.5px; color: var(--ag-fg-soft); padding: 5px 6px; border-radius: 5px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
[data-agnes-root] .ag-seg-item:hover:not([data-active="true"]) { color: var(--ag-fg) }
[data-agnes-root] .ag-seg-item[data-active="true"] { background: var(--ag-bg); color: var(--ag-fg); box-shadow: 0 1px 2px rgba(0,0,0,.12); font-weight: 500 }
[data-agnes-root] .ag-seg-item:disabled { opacity: .5; cursor: not-allowed }

/* ---------- advanced ---------- */
[data-agnes-root] .ag-disclosure {
  appearance: none; border: none; background: transparent; cursor: pointer; padding: 2px 0;
  display: flex; align-items: center; gap: 5px; font: inherit; font-size: 11.5px; color: var(--ag-fg-soft);
}
[data-agnes-root] .ag-disclosure:hover { color: var(--ag-fg) }
[data-agnes-root] .ag-advanced { display: flex; flex-direction: column; gap: 10px; padding: 10px;
  border: 1px dashed var(--ag-border-strong); border-radius: var(--ag-radius) }

/* ---------- actions ---------- */
[data-agnes-root] .ag-actions { display: flex; align-items: center; gap: 8px }
[data-agnes-root] .ag-btn {
  appearance: none; font: inherit; font-size: 12.5px; cursor: pointer;
  border-radius: var(--ag-radius-sm); padding: 7px 14px; border: 1px solid var(--ag-border-strong);
  background: transparent; color: var(--ag-fg);
}
[data-agnes-root] .ag-btn:hover:not(:disabled) { background: var(--ag-bg-soft) }
[data-agnes-root] .ag-btn-primary {
  border-color: transparent; background: var(--ag-accent);
  color: var(--ag-on-accent); font-weight: 600; min-width: 108px;
  display: inline-flex; align-items: center; justify-content: center; gap: 7px;
}
[data-agnes-root] .ag-btn-primary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--ag-accent) 88%, var(--ag-on-accent));
}
/*
 * Disabled state for the primary action.
 *
 * A blanket opacity on a filled button drags the label toward the surface
 * behind it, so in dark mode the label and the fill converge on the same grey
 * and the text disappears. The disabled button therefore keeps an opaque
 * surface and gets its own legible label colour instead of being faded.
 *
 * The data-busy marker is the "generating\u2026" state: it is disabled for input
 * purposes but it is live work, so it keeps the accent fill and the on-accent
 * label.
 */
[data-agnes-root] .ag-btn:disabled { opacity: .5; cursor: not-allowed }
[data-agnes-root] .ag-btn-primary:disabled,
[data-agnes-root] .ag-btn-primary[aria-disabled="true"] {
  opacity: 1;
  background: var(--ag-bg-soft);
  border-color: var(--ag-border-strong);
  color: var(--ag-fg);
}
[data-agnes-root] .ag-btn-primary[data-busy="true"]:disabled {
  background: var(--ag-accent);
  border-color: transparent;
  color: var(--ag-on-accent);
  cursor: progress;
}
[data-agnes-root] .ag-btn-sm { padding: 4px 9px; font-size: 11.5px }

/* ---------- status ---------- */
[data-agnes-root] .ag-status { display: flex; align-items: center; gap: 7px; font-size: 11.5px; color: var(--ag-fg-soft); min-height: 18px }
[data-agnes-root] .ag-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ag-idle); flex: 0 0 7px }
[data-agnes-root] .ag-dot[data-tone="accent"] { background: var(--ag-accent) }
[data-agnes-root] .ag-dot[data-tone="success"] { background: var(--ag-success) }
[data-agnes-root] .ag-dot[data-tone="error"] { background: var(--ag-error) }
[data-agnes-root] .ag-dot[data-tone="warn"] { background: var(--ag-warn) }
[data-agnes-root] .ag-dot[data-pulse="true"] { animation: ag-pulse 1.4s ease-in-out infinite }
@keyframes ag-pulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }

[data-agnes-root] .ag-alert {
  font-size: 12px; padding: 8px 10px; border-radius: var(--ag-radius-sm);
  border: 1px solid color-mix(in srgb, var(--ag-error) 40%, transparent);
  background: color-mix(in srgb, var(--ag-error) 12%, transparent);
  color: var(--ag-fg); white-space: pre-wrap; word-break: break-word;
}
[data-agnes-root] .ag-alert[data-tone="warn"] {
  border-color: color-mix(in srgb, var(--ag-warn) 40%, transparent);
  background: color-mix(in srgb, var(--ag-warn) 12%, transparent);
}

/* ---------- progress ---------- */
[data-agnes-root] .ag-progress { height: 3px; border-radius: 3px; background: var(--ag-bg-soft); overflow: hidden }
[data-agnes-root] .ag-progress-bar { height: 100%; background: var(--ag-accent); transition: width .4s ease }

/* ---------- history ---------- */
[data-agnes-root] .ag-section-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 2px }
[data-agnes-root] .ag-section-title { font-size: 11px; color: var(--ag-fg-soft); font-weight: 600; letter-spacing: .04em; text-transform: uppercase }
[data-agnes-root] .ag-empty {
  border: 1px dashed var(--ag-border-strong); border-radius: var(--ag-radius);
  padding: 20px 14px; text-align: center; color: var(--ag-fg-soft); font-size: 12px;
  display: flex; flex-direction: column; gap: 4px;
}
[data-agnes-root] .ag-empty small { font-size: 11px; opacity: .8 }

[data-agnes-root] .ag-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px }
[data-agnes-root] .ag-card {
  border: 1px solid var(--ag-border); border-radius: var(--ag-radius); overflow: hidden;
  background: var(--ag-bg-soft); display: flex; flex-direction: column;
}
[data-agnes-root] .ag-card[data-status="failed"] { border-color: color-mix(in srgb, var(--ag-error) 45%, transparent) }
[data-agnes-root] .ag-thumb {
  position: relative; aspect-ratio: 16 / 10; background: var(--ag-bg);
  display: grid; place-items: center; overflow: hidden;
}
[data-agnes-root] .ag-thumb img,
[data-agnes-root] .ag-thumb video { width: 100%; height: 100%; object-fit: cover; display: block }
[data-agnes-root] .ag-thumb-icon { color: var(--ag-fg-soft); opacity: .55 }
[data-agnes-root] .ag-thumb-badge {
  position: absolute; left: 6px; top: 6px; font-size: 10px; line-height: 16px;
  padding: 0 6px; border-radius: 999px; background: color-mix(in srgb, #000 55%, transparent);
  color: #fff; backdrop-filter: blur(3px);
}
/* A second badge sits opposite the kind badge, so both stay readable. */
[data-agnes-root] .ag-thumb-badge[data-kind="agent"] {
  left: auto; right: 6px;
  background: color-mix(in srgb, var(--ag-accent) 78%, #000);
}
[data-agnes-root] .ag-card-body { padding: 7px 8px 8px; display: flex; flex-direction: column; gap: 5px; min-width: 0 }
[data-agnes-root] .ag-card-prompt {
  font-size: 11.5px; color: var(--ag-fg); display: -webkit-box; -webkit-line-clamp: 2;
  -webkit-box-orient: vertical; overflow: hidden; word-break: break-word;
}
[data-agnes-root] .ag-card-meta { font-size: 10.5px; color: var(--ag-fg-soft); display: flex; gap: 6px; align-items: center; flex-wrap: wrap }
[data-agnes-root] .ag-card-actions { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px }
[data-agnes-root] .ag-link-btn {
  appearance: none; border: none; background: transparent; cursor: pointer;
  font: inherit; font-size: 10.5px; padding: 2px 4px; border-radius: 4px; color: var(--ag-accent);
  text-decoration: none;
}
[data-agnes-root] .ag-link-btn:hover { background: var(--ag-accent-soft) }
[data-agnes-root] .ag-link-btn[data-tone="muted"] { color: var(--ag-fg-soft) }

[data-agnes-root] .ag-foot {
  padding: 8px 14px 10px; border-top: 1px solid var(--ag-border);
  font-size: 10.5px; color: var(--ag-fg-soft);
  display: flex; justify-content: space-between; gap: 8px; align-items: center;
}
[data-agnes-root] .ag-foot code { font-size: 10px; opacity: .8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 60% }

/* ---------- reference images (image-to-image) ---------- */
[data-agnes-root] .ag-refs { display: flex; flex-wrap: wrap; gap: 6px }
[data-agnes-root] .ag-ref {
  position: relative; width: 56px; height: 56px; border-radius: 6px; overflow: hidden;
  border: 1px solid var(--ag-border); background: var(--ag-bg);
}
[data-agnes-root] .ag-ref img { width: 100%; height: 100%; object-fit: cover; display: block }
[data-agnes-root] .ag-ref-x {
  position: absolute; right: 2px; top: 2px; width: 16px; height: 16px; padding: 0;
  border: none; border-radius: 50%; cursor: pointer; font-size: 9px; line-height: 1;
  display: grid; place-items: center;
  background: color-mix(in srgb, #000 68%, transparent); color: #fff;
}
[data-agnes-root] .ag-ref-x:hover { background: var(--ag-error) }
[data-agnes-root] .ag-ref-x:disabled { opacity: .45; cursor: not-allowed }
[data-agnes-root] .ag-drop {
  border: 1px dashed var(--ag-border-strong); border-radius: var(--ag-radius-sm);
  padding: 10px; text-align: center; font-size: 11.5px; color: var(--ag-fg-soft); cursor: pointer;
}
[data-agnes-root] .ag-drop:hover,
[data-agnes-root] .ag-drop[data-over="true"] {
  border-color: var(--ag-accent); color: var(--ag-accent); background: var(--ag-accent-soft);
}
[data-agnes-root] .ag-drop:focus-visible { outline: 2px solid var(--ag-accent); outline-offset: 1px }

/* ---------- entry switches (bundle page section) ---------- */
[data-agnes-root] .ag-entries { display: flex; flex-direction: column; gap: 4px }
[data-agnes-root] .ag-entries-title {
  margin: 0 0 6px; font-size: 12px; font-weight: 600;
  color: var(--ag-fg); letter-spacing: .02em;
}
[data-agnes-root] .ag-entry-row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 9px 0; border-bottom: 1px solid var(--ag-border);
}
[data-agnes-root] .ag-entry-row:last-of-type { border-bottom: none }
[data-agnes-root] .ag-entry-text { display: flex; flex-direction: column; gap: 2px; min-width: 0 }
[data-agnes-root] .ag-entry-label { font-size: 12.5px; color: var(--ag-fg) }
[data-agnes-root] .ag-entry-hint { font-size: 11px; color: var(--ag-fg-soft) }
[data-agnes-root] .ag-switch {
  appearance: none; border: none; cursor: pointer; flex: 0 0 38px;
  width: 38px; height: 22px; padding: 0; border-radius: 999px;
  background: var(--ag-bg-soft); border: 1px solid var(--ag-border-strong);
  position: relative; transition: background .14s, border-color .14s;
}
[data-agnes-root] .ag-switch-thumb {
  position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
  border-radius: 50%; background: var(--ag-fg-soft);
  transition: transform .14s, background .14s;
}
[data-agnes-root] .ag-switch[data-checked="true"] {
  background: var(--ag-accent); border-color: var(--ag-accent);
}
[data-agnes-root] .ag-switch[data-checked="true"] .ag-switch-thumb {
  transform: translateX(16px); background: var(--ag-on-accent);
}
[data-agnes-root] .ag-switch:disabled { opacity: .5; cursor: not-allowed }
[data-agnes-root] .ag-switch:focus-visible { outline: 2px solid var(--ag-accent); outline-offset: 2px }
[data-agnes-root] .ag-entries-note { margin: 6px 0 0; font-size: 11px; color: var(--ag-fg-soft) }
[data-agnes-root] .ag-entries-error { margin: 6px 0 0; font-size: 11.5px; color: var(--ag-error) }
`;
function installStyles() {
  if (typeof document === "undefined") return () => {
  };
  const existing = document.getElementById(STYLE_ID);
  if (existing !== null) return () => {
  };
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
  return () => {
    el.remove();
  };
}

// src/client/locales.ts
var NS = "agnes-media";
var en = {
  "entry.label": "Agnes Media",
  "entry.title": "Agnes Media \u2014 AI image & video studio",
  "panel.title": "Agnes Media Studio",
  "panel.subtitle": "Agnes Image 2.5 Flash \xB7 Agnes Video 2.5 Flash",
  "action.close": "Close",
  "action.generate": "Generate",
  "action.cancel": "Cancel",
  "action.resume": "Resume",
  "action.retry": "Retry",
  "action.remove": "Remove",
  "action.clear": "Clear history",
  "action.open": "Open",
  "action.download": "Open local file",
  "action.copyPrompt": "Copy prompt",
  "action.copied": "Copied",
  "action.insert": "Send to chat",
  "action.inserted": "Sent",
  "action.reuse": "Reuse settings",
  "action.asReference": "Use as reference",
  "action.seedRandom": "Random seed",
  "action.refresh": "Refresh",
  "tab.image": "Image",
  "tab.video": "Video",
  "tab.gallery": "History",
  "label.prompt": "Prompt",
  "label.prompt.placeholder": "Describe the image or video you want\u2026",
  "label.prompt.videoPlaceholder": "Describe the shot: subject, camera move, lighting, mood\u2026",
  "label.size": "Size",
  "label.ratio": "Aspect ratio",
  "label.count": "Count",
  "label.duration": "Duration",
  "label.resolution": "Resolution",
  "label.seed": "Seed",
  "label.negative": "Negative prompt",
  "label.negative.placeholder": "What to avoid (optional)",
  "label.model": "Model",
  "label.mode": "Mode",
  "label.advanced": "Advanced",
  "label.pixels": "Output",
  "label.seconds": "s",
  "label.references": "Reference images",
  "label.references.optional": "optional",
  "label.references.drop": "Drop images, or click to choose \u2014 up to 5",
  "label.references.full": "Reference list is full (5)",
  "label.references.hint": "Used for image-to-image and composition.",
  "mode.text": "Text \u2192 video",
  "mode.keyframe": "First/last frame",
  "mode.reference": "Reference media",
  "mode.fromImage": "One-step from prompt",
  "label.firstFrame": "First frame URL",
  "label.lastFrame": "Last frame URL",
  "label.referenceImages": "Reference image URLs (one per line, max 5)",
  "label.referenceAudios": "Reference audio URLs (one per line, max 3)",
  "label.fromImagePrompt": "Keyframe prompt",
  "label.fromImageHint": "Agnes renders the keyframe first, then animates it \u2014 no public asset URL needed.",
  "status.idle": "Ready",
  "status.queued": "Queued",
  "status.running": "Generating\u2026",
  "status.polling": "Rendering\u2026",
  "status.completed": "Done",
  "status.failed": "Failed",
  "status.cancelled": "Cancelled",
  "status.interrupted": "Interrupted",
  "status.rateLimited": "Rate limited \u2014 retrying",
  "status.retryIn": "retry in {n}s",
  "status.noKey": "No API key configured",
  "status.keyReady": "Key ready",
  "status.loading": "Loading\u2026",
  "history.title": "History",
  "history.empty": "Nothing generated yet.",
  "history.emptyHint": "Results are stored on the host, so they survive a reload.",
  "history.count": "{n} items",
  "history.agent": "from chat",
  "hint.shortcut": "Ctrl/\u2318 + Enter generates",
  "hint.storedAt": "Stored in {dir}",
  "hint.count": "{n} results",
  "entries.title": "Entries",
  "entries.page": "Sidebar workbench",
  "entries.page.hint": "A panel beside Plugins and Schedules in the sidebar.",
  "entries.drawer": "In-chat drawer",
  "entries.drawer.hint": "The \u2728 button in a conversation header, opening a side drawer.",
  "entries.noPage": "The sidebar entry is off \u2014 open the drawer with \u2728 in a conversation header, or turn the switch above back on.",
  "entries.hostDown": 'The Host bridge is unreachable (the page was loaded before the plugin reloaded \u2014 refresh). Verify with the log line "[agnes-media] web-server bridge mounted".',
  "error.prefix": "Failed",
  "error.noPrompt": "Enter a prompt first.",
  "error.noSession": "No active conversation.",
  "error.noKey": "Set AGNES_API_KEY in DSH settings (Settings \u2192 Models \u2192 Credentials) or in cordis.patch.yml.",
  "error.busy": "A generation is already running.",
  "error.notImage": "Only images can be used as a reference.",
  "error.host": "Host unreachable \u2014 is the plugin loaded?",
  "key.hint": "Get a free key at platform.agnes-ai.cn \u2192 API Keys.",
  "job.age": "{n}s ago",
  "job.eta": "elapsed {n}s"
};
var zh = {
  "entry.label": "Agnes \u5A92\u4F53",
  "entry.title": "Agnes \u5A92\u4F53 \u2014 AI \u751F\u56FE / \u751F\u89C6\u9891\u5DE5\u4F5C\u53F0",
  "panel.title": "Agnes \u5A92\u4F53\u5DE5\u4F5C\u53F0",
  "panel.subtitle": "Agnes Image 2.5 Flash \xB7 Agnes Video 2.5 Flash",
  "action.close": "\u5173\u95ED",
  "action.generate": "\u751F\u6210",
  "action.cancel": "\u53D6\u6D88",
  "action.resume": "\u7EE7\u7EED",
  "action.retry": "\u91CD\u8BD5",
  "action.remove": "\u5220\u9664",
  "action.clear": "\u6E05\u7A7A\u5386\u53F2",
  "action.open": "\u6253\u5F00",
  "action.download": "\u6253\u5F00\u672C\u5730\u6587\u4EF6",
  "action.copyPrompt": "\u590D\u5236\u63D0\u793A\u8BCD",
  "action.copied": "\u5DF2\u590D\u5236",
  "action.insert": "\u53D1\u9001\u5230\u5BF9\u8BDD",
  "action.inserted": "\u5DF2\u53D1\u9001",
  "action.reuse": "\u590D\u7528\u53C2\u6570",
  "action.asReference": "\u4F5C\u4E3A\u53C2\u8003\u56FE",
  "action.seedRandom": "\u968F\u673A\u79CD\u5B50",
  "action.refresh": "\u5237\u65B0",
  "tab.image": "\u56FE\u7247",
  "tab.video": "\u89C6\u9891",
  "tab.gallery": "\u5386\u53F2",
  "label.prompt": "\u63D0\u793A\u8BCD",
  "label.prompt.placeholder": "\u63CF\u8FF0\u4F60\u8981\u751F\u6210\u7684\u753B\u9762\u2026",
  "label.prompt.videoPlaceholder": "\u63CF\u8FF0\u955C\u5934\uFF1A\u4E3B\u4F53\u3001\u8FD0\u955C\u3001\u5149\u7EBF\u3001\u6C1B\u56F4\u2026",
  "label.size": "\u5C3A\u5BF8",
  "label.ratio": "\u5BBD\u9AD8\u6BD4",
  "label.count": "\u6570\u91CF",
  "label.duration": "\u65F6\u957F",
  "label.resolution": "\u6E05\u6670\u5EA6",
  "label.seed": "\u968F\u673A\u79CD\u5B50",
  "label.negative": "\u53CD\u5411\u63D0\u793A\u8BCD",
  "label.negative.placeholder": "\u60F3\u907F\u514D\u7684\u5185\u5BB9\uFF08\u53EF\u9009\uFF09",
  "label.model": "\u6A21\u578B",
  "label.mode": "\u6A21\u5F0F",
  "label.advanced": "\u9AD8\u7EA7",
  "label.pixels": "\u8F93\u51FA",
  "label.seconds": "\u79D2",
  "label.references": "\u53C2\u8003\u56FE",
  "label.references.optional": "\u53EF\u9009",
  "label.references.drop": "\u62D6\u5165\u56FE\u7247\u6216\u70B9\u51FB\u9009\u62E9 \u2014\u2014 \u6700\u591A 5 \u5F20",
  "label.references.full": "\u53C2\u8003\u56FE\u5DF2\u6EE1\uFF085 \u5F20\uFF09",
  "label.references.hint": "\u7528\u4E8E\u56FE\u751F\u56FE\u4E0E\u591A\u56FE\u5408\u6210\u3002",
  "mode.text": "\u6587\u751F\u89C6\u9891",
  "mode.keyframe": "\u9996\u5C3E\u5E27",
  "mode.reference": "\u53C2\u8003\u7D20\u6750",
  "mode.fromImage": "\u63D0\u793A\u8BCD\u4E00\u6B65\u6D41",
  "label.firstFrame": "\u9996\u5E27 URL",
  "label.lastFrame": "\u5C3E\u5E27 URL",
  "label.referenceImages": "\u53C2\u8003\u56FE URL\uFF08\u6BCF\u884C\u4E00\u4E2A\uFF0C\u6700\u591A 5 \u5F20\uFF09",
  "label.referenceAudios": "\u53C2\u8003\u97F3\u9891 URL\uFF08\u6BCF\u884C\u4E00\u4E2A\uFF0C\u6700\u591A 3 \u6BB5\uFF09",
  "label.fromImagePrompt": "\u5173\u952E\u5E27\u63D0\u793A\u8BCD",
  "label.fromImageHint": "Agnes \u5148\u751F\u6210\u5173\u952E\u5E27\u518D\u8BA9\u5B83\u52A8\u8D77\u6765\uFF0C\u65E0\u9700\u81EA\u5907\u516C\u5171\u7D20\u6750\u5730\u5740\u3002",
  "status.idle": "\u5C31\u7EEA",
  "status.queued": "\u6392\u961F\u4E2D",
  "status.running": "\u751F\u6210\u4E2D\u2026",
  "status.polling": "\u6E32\u67D3\u4E2D\u2026",
  "status.completed": "\u5B8C\u6210",
  "status.failed": "\u5931\u8D25",
  "status.cancelled": "\u5DF2\u53D6\u6D88",
  "status.interrupted": "\u5DF2\u4E2D\u65AD",
  "status.rateLimited": "\u89E6\u53D1\u9650\u6D41\uFF0C\u81EA\u52A8\u91CD\u8BD5\u4E2D",
  "status.retryIn": "{n} \u79D2\u540E\u91CD\u8BD5",
  "status.noKey": "\u672A\u914D\u7F6E API Key",
  "status.keyReady": "Key \u5DF2\u5C31\u7EEA",
  "status.loading": "\u52A0\u8F7D\u4E2D\u2026",
  "history.title": "\u751F\u6210\u5386\u53F2",
  "history.empty": "\u8FD8\u6CA1\u6709\u751F\u6210\u8BB0\u5F55\u3002",
  "history.emptyHint": "\u7ED3\u679C\u4FDD\u5B58\u5728\u5BBF\u4E3B\u4FA7\uFF0C\u5237\u65B0\u9875\u9762\u4E5F\u4E0D\u4F1A\u4E22\u3002",
  "history.count": "{n} \u6761",
  "history.agent": "\u6765\u81EA\u5BF9\u8BDD",
  "hint.shortcut": "Ctrl/\u2318 + Enter \u751F\u6210",
  "hint.storedAt": "\u4FDD\u5B58\u5728 {dir}",
  "hint.count": "{n} \u6761\u7ED3\u679C",
  "entries.title": "\u5165\u53E3\u5F00\u5173",
  "entries.page": "\u4FA7\u680F\u5DE5\u4F5C\u53F0",
  "entries.page.hint": "\u4FA7\u680F\u4E2D\u4E0E\u300C\u63D2\u4EF6\u300D\u300C\u5B9A\u65F6\u4EFB\u52A1\u300D\u5E76\u5217\u7684\u9762\u677F\u3002",
  "entries.drawer": "\u4F1A\u8BDD\u5185\u62BD\u5C49",
  "entries.drawer.hint": "\u5BF9\u8BDD\u5934\u90E8\u7684 \u2728 \u6309\u94AE\uFF0C\u70B9\u51FB\u540E\u4ECE\u53F3\u4FA7\u6ED1\u51FA\u3002",
  "entries.hostDown": "\u5BBF\u4E3B\u4FA7\u63A5\u53E3\u4E0D\u53EF\u7528\uFF08\u63D2\u4EF6\u91CD\u88C5/\u91CD\u542F\u540E\u9700\u5237\u65B0\u9875\u9762\uFF09\u3002\u5B9A\u4F4D\u6B65\u9AA4\uFF1A\u72B6\u6001\u680F\u7684\u5165\u53E3\u5F00\u5173\u662F\u5426\u6B63\u5E38\uFF0C\u5BBF\u4E3B\u63A7\u5236\u53F0\u662F\u5426\u51FA\u73B0 [agnes-media] web-server bridge mounted\u3002",
  "entries.noPage": "\u4FA7\u680F\u5165\u53E3\u5DF2\u5173\u95ED\uFF0C\u6240\u4EE5\u8FD9\u4E00\u9875\u53EA\u80FD\u4ECE\u8FD9\u91CC\u6253\u5F00\uFF1A\u5148\u5728\u300C\u5DE5\u4F5C\u53F0\u300D\u5916\u5C42\u6536\u8D77\u89C6\u56FE\uFF08Esc \u6216\u53F3\u4FA7\u300C\u804A\u5929\u300D\uFF09\uFF0C\u518D\u4ECE\u4FA7\u680F\u8FDB\u5165\uFF0C\u6216\u91CD\u65B0\u6253\u5F00\u4E0A\u9762\u7684\u5F00\u5173\u3002",
  "error.prefix": "\u751F\u6210\u5931\u8D25",
  "error.noPrompt": "\u8BF7\u5148\u8F93\u5165\u63D0\u793A\u8BCD\u3002",
  "error.noSession": "\u6CA1\u6709\u6D3B\u52A8\u4F1A\u8BDD\u3002",
  "error.noKey": "\u8BF7\u8BBE\u7F6E AGNES_API_KEY\uFF08\u8BBE\u7F6E \u2192 \u6A21\u578B \u2192 \u51ED\u636E\uFF09\u6216\u5728 cordis.patch.yml \u91CC\u586B apiKey\u3002",
  "error.busy": "\u5DF2\u6709\u4EFB\u52A1\u6B63\u5728\u751F\u6210\u3002",
  "error.notImage": "\u53EA\u6709\u56FE\u7247\u80FD\u4F5C\u4E3A\u53C2\u8003\u56FE\u3002",
  "error.host": "\u8FDE\u4E0D\u4E0A\u5BBF\u4E3B \u2014\u2014 \u63D2\u4EF6\u662F\u5426\u5DF2\u52A0\u8F7D\uFF1F",
  "key.hint": "\u5728 platform.agnes-ai.cn \u2192 API Keys \u514D\u8D39\u521B\u5EFA\u3002",
  "job.age": "{n} \u79D2\u524D",
  "job.eta": "\u5DF2\u7528\u65F6 {n} \u79D2"
};
var dictionaries = { zh, en };

// src/client/entries.tsx
var import_react2 = require("react");

// src/client/entry-state.ts
var cache = null;
var listeners = /* @__PURE__ */ new Set();
function getEntryPrefs() {
  return cache;
}
function setEntryPrefs(next) {
  if (cache !== null && cache.pageEnabled === next.pageEnabled && cache.drawerEnabled === next.drawerEnabled) {
    return;
  }
  cache = next;
  for (const listener of listeners) listener();
}
function subscribeEntryPrefs(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// src/client/entries.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
function EntrySwitches(props) {
  const { t } = props;
  const [prefs, setPrefs] = (0, import_react2.useState)(() => getEntryPrefs());
  const [error, setError] = (0, import_react2.useState)(null);
  const [saving, setSaving] = (0, import_react2.useState)(false);
  (0, import_react2.useEffect)(() => subscribeEntryPrefs(() => setPrefs(() => getEntryPrefs())), []);
  (0, import_react2.useEffect)(() => {
    let alive = true;
    void api.entries().then((value) => {
      if (alive) {
        setEntryPrefs(value);
        setError(null);
      }
    }).catch((e) => {
      if (!alive) return;
      if (getEntryPrefs() === null) setEntryPrefs({ pageEnabled: true, drawerEnabled: true });
      setError(e instanceof Error ? e.message : String(e));
    });
    return () => {
      alive = false;
    };
  }, []);
  const toggle = (0, import_react2.useCallback)(async (key, next) => {
    const current = prefs ?? getEntryPrefs();
    if (current === null || saving) return;
    const previous = current;
    setEntryPrefs({ ...previous, [key]: next });
    setSaving(true);
    setError(null);
    try {
      setEntryPrefs(await api.setEntries({ [key]: next }));
    } catch (e) {
      setEntryPrefs(previous);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [prefs, saving]);
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { "data-agnes-root": "", className: "ag-entries", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h3", { className: "ag-entries-title", children: t("entries.title") }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      Row,
      {
        label: t("entries.page"),
        hint: t("entries.page.hint"),
        checked: prefs?.pageEnabled ?? true,
        disabled: prefs === null || saving,
        onChange: (next) => void toggle("pageEnabled", next)
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      Row,
      {
        label: t("entries.drawer"),
        hint: t("entries.drawer.hint"),
        checked: prefs?.drawerEnabled ?? true,
        disabled: prefs === null || saving,
        onChange: (next) => void toggle("drawerEnabled", next)
      }
    ),
    error !== null ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "ag-entries-error", children: t("entries.hostDown") }) : null,
    prefs !== null && !prefs.pageEnabled ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "ag-entries-note", children: t("entries.noPage") }) : null
  ] });
}
function Row(props) {
  const { label, hint, checked, disabled, onChange } = props;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { className: "ag-entry-row", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "ag-entry-text", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "ag-entry-label", children: label }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "ag-entry-hint", children: hint })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      "button",
      {
        type: "button",
        role: "switch",
        "aria-checked": checked,
        "aria-label": label,
        className: "ag-switch",
        "data-checked": checked ? "true" : "false",
        disabled,
        onClick: () => onChange(!checked),
        children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "ag-switch-thumb" })
      }
    )
  ] });
}

// src/client/seats.ts
var OWN_BUNDLE = "agnes-media";
var ROW_ID = "agnes-media-studio";
var BUNDLE_SLOT = "plugins.bundle.config";
function createSeats(options) {
  const { slots, keys, locale, registrant, render, log } = options;
  const disposers = [];
  const settled = /* @__PURE__ */ new Set();
  let disposed = false;
  const occupy = (key) => {
    try {
      const seat = slots.register({
        name: BUNDLE_SLOT,
        key,
        locale,
        registrant
      }, (props) => render(key, props));
      settled.add(key);
      return typeof seat === "function" ? () => {
        seat();
      } : () => {
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/already has an entry for key/i.test(message)) {
        settled.add(key);
        return () => {
        };
      }
      if (/is not declared/i.test(message)) return null;
      log?.(`entry switches refused the seat "${key}":`, error);
      return null;
    }
  };
  const mount = () => {
    if (disposed) return;
    for (const key of keys) {
      try {
        const dispose = slots.inject(BUNDLE_SLOT, () => {
          const seat = occupy(key);
          if (seat !== null) disposers.push(seat);
          return () => {
          };
        });
        if (typeof dispose === "function") disposers.push(dispose);
      } catch (error) {
        log?.(`cannot inject into ${BUNDLE_SLOT} for key "${key}":`, error);
      }
    }
  };
  const report = () => {
    let present = /* @__PURE__ */ new Set();
    try {
      present = new Set((slots.entries?.(BUNDLE_SLOT) ?? []).map((entry) => entry.options?.key).filter((key) => typeof key === "string"));
    } catch {
    }
    return {
      holding: keys.filter((key) => present.has(key)),
      missing: keys.filter((key) => !present.has(key))
    };
  };
  return {
    mount,
    report,
    dispose: () => {
      disposed = true;
      for (const dispose of disposers.splice(0).reverse()) {
        try {
          dispose();
        } catch {
        }
      }
      settled.clear();
    }
  };
}
function candidateKeys(bundles) {
  const keys = [];
  const add = (key) => {
    if (!keys.includes(key)) keys.push(key);
  };
  add(OWN_BUNDLE);
  add(`${OWN_BUNDLE}#${ROW_ID}`);
  for (const name2 of bundles) {
    if (name2 === OWN_BUNDLE) continue;
    add(name2);
    add(`${name2}#${ROW_ID}`);
  }
  return keys;
}

// src/client/index.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
var name = "agnes-media/client";
var inject = ["slots", "locale", "sessions"];
var PANEL_KEY = "agnes-media";
var OVERLAY = "shell.overlay";
var WORKSPACE = "agnes-media.workspace";
var drawerOpen = false;
var drawerListeners = /* @__PURE__ */ new Set();
function setDrawer(next) {
  if (drawerOpen === next) return;
  drawerOpen = next;
  for (const listener of drawerListeners) listener();
}
function toggleDrawer() {
  setDrawer(!drawerOpen);
}
function useDrawer() {
  const [open, setOpen] = (0, import_react3.useState)(drawerOpen);
  (0, import_react3.useEffect)(() => subscribeDrawer(() => setOpen(drawerOpen)), []);
  return open;
}
function subscribeDrawer(listener) {
  drawerListeners.add(listener);
  return () => {
    drawerListeners.delete(listener);
  };
}
var boundSend = null;
var slotSend = null;
var channelListeners = /* @__PURE__ */ new Set();
function sendToChat() {
  return boundSend ?? slotSend;
}
function setChannel(next) {
  if (boundSend === next) return;
  boundSend = next;
  for (const listener of channelListeners) listener();
}
function setSlotSend(next) {
  if (slotSend === next) return;
  slotSend = next;
  for (const listener of channelListeners) listener();
}
function subscribeChannel(listener) {
  channelListeners.add(listener);
  return () => {
    channelListeners.delete(listener);
  };
}
function useSendChannel() {
  const [channel, setChannel2] = (0, import_react3.useState)(() => sendToChat());
  (0, import_react3.useEffect)(() => subscribeChannel(() => setChannel2(() => sendToChat())), []);
  return channel;
}
function sendChannelFor(ctx, sessionId) {
  try {
    const binding = ctx.sessions?.binding?.(sessionId);
    const conversation = binding?.ctx?.get?.("conversation");
    return typeof conversation?.send === "function" ? (text) => {
      void conversation.send?.(text);
    } : null;
  } catch {
    return null;
  }
}
function apply(ctx) {
  try {
    run(ctx);
  } catch (error) {
    console.error("[agnes-media] client apply() failed, degrading:", error);
  }
}
function run(ctx) {
  const disposeStyles = installStyles();
  safeEffect(ctx, () => disposeStyles, "agnes-media: styles");
  safeEffect(ctx, () => ctx.locale?.register(NS, dictionaries) ?? (() => {
  }), "agnes-media: dictionaries");
  const t = ctx.locale?.bind(NS) ?? ((key) => key);
  const slots = ctx.slots;
  if (typeof slots?.inject !== "function" || typeof slots?.register !== "function") return;
  const entries = {
    page: { on: () => {
    }, off: () => {
    }, live: () => true },
    drawer: { on: () => {
    }, off: () => {
    }, live: () => true }
  };
  let offSidebarRow = slots.inject("sidebar.panellist", () => slots.register({
    name: "sidebar.panellist",
    id: PANEL_KEY,
    order: 20,
    label: () => t("entry.label"),
    locale: NS
  }, (owner) => EntryIcon({ size: owner?.size ?? 16 })));
  let offPage = slots.inject("main", () => slots.register({
    name: "main",
    key: PANEL_KEY,
    locale: NS
  }, () => StudioPage({ t })));
  entries.page = {
    on: () => {
      if (offSidebarRow !== null || offPage !== null) return;
      offSidebarRow = slots.inject("sidebar.panellist", () => slots.register({
        name: "sidebar.panellist",
        id: PANEL_KEY,
        order: 20,
        label: () => t("entry.label"),
        locale: NS
      }, (owner) => EntryIcon({ size: owner?.size ?? 16 })));
      offPage = slots.inject("main", () => slots.register({
        name: "main",
        key: PANEL_KEY,
        locale: NS
      }, () => StudioPage({ t })));
    },
    off: () => {
      if (typeof offSidebarRow === "function") offSidebarRow();
      if (typeof offPage === "function") offPage();
      offSidebarRow = null;
      offPage = null;
    },
    live: () => offSidebarRow !== null || offPage !== null
  };
  safeEffect(ctx, () => () => {
    if (typeof offSidebarRow === "function") offSidebarRow();
    if (typeof offPage === "function") offPage();
  }, "agnes-media: sidebar row");
  const offHeader = slots.inject("conversation.session.header.utilities", () => slots.register({
    name: "conversation.session.header.utilities",
    id: "agnes-media-quick",
    order: 20,
    locale: NS,
    inject: (sessionId) => {
      setChannel(typeof sessionId === "string" && sessionId.length > 0 ? sendChannelFor(ctx, sessionId) : null);
      return {};
    }
    /*
     * The component always renders `QuickButton`, which decides for itself
     * whether to draw anything. Registering a conditional component here instead
     * would mean the registration's lifetime follows a UI toggle, and the
     * session channel this slot publishes would vanish with it.
     */
  }, () => QuickButton({ t })));
  safeEffect(ctx, () => offHeader, "agnes-media: header button");
  let offDrawer = slots.inject(OVERLAY, () => slots.register({
    name: OVERLAY,
    id: "agnes-media-drawer",
    order: 90,
    children: { [WORKSPACE]: { kind: "single", scope: "session" } }
  }, (props) => DrawerSeat({ t, props })));
  let offWorkspace = null;
  const openWorkspace = () => {
    try {
      const child = slots.inject(WORKSPACE, () => slots.register({
        name: WORKSPACE,
        id: "agnes-media-workspace",
        inject: (sessionId) => {
          setSlotSend(typeof sessionId === "string" && sessionId.length > 0 ? sendChannelFor(ctx, sessionId) : null);
          return {};
        }
      }, () => null));
      if (typeof child === "function") offWorkspace = child;
    } catch (error) {
      console.error("[agnes-media] cannot mount the drawer channel:", error);
    }
  };
  openWorkspace();
  entries.drawer = {
    on: () => {
      if (offDrawer !== null) return;
      offDrawer = slots.inject(OVERLAY, () => slots.register({
        name: OVERLAY,
        id: "agnes-media-drawer",
        order: 90,
        children: { [WORKSPACE]: { kind: "single", scope: "session" } }
      }, (props) => DrawerSeat({ t, props })));
      if (offWorkspace === null) openWorkspace();
    },
    off: () => {
      if (typeof offDrawer === "function") offDrawer();
      offDrawer = null;
      if (typeof offWorkspace === "function") offWorkspace();
      offWorkspace = null;
      setSlotSend(null);
    },
    live: () => offDrawer !== null
  };
  safeEffect(ctx, () => typeof offWorkspace === "function" ? offWorkspace : () => {
  }, "agnes-media: workspace slot");
  const seats = createSeats({
    slots,
    keys: candidateKeys([]),
    locale: NS,
    registrant: "agnes-media",
    render: (key, props) => EntrySwitches({ t, seat: key, hostProps: props }),
    log: (line, ...rest) => {
      console.info(`[agnes-media] ${line}`, ...rest);
    }
  });
  seats.mount();
  safeEffect(ctx, () => () => seats.dispose(), "agnes-media: entry switches");
  const applyEntries = (next) => {
    if (next.pageEnabled) entries.page.on();
    else entries.page.off();
    if (next.drawerEnabled) entries.drawer.on();
    else entries.drawer.off();
  };
  safeEffect(ctx, () => subscribeEntryPrefs(() => {
    const next = getEntryPrefs();
    if (next !== null) applyEntries(next);
  }), "agnes-media: entry sync");
  void api.entries().then((next) => setEntryPrefs(next)).catch(() => {
  });
  try {
    const report = seats.report();
    console.info(
      "[agnes-media] boot ok | entry switches held:",
      report.holding.join(", ") || "(page not mounted yet)"
    );
  } catch (error) {
    console.error("[agnes-media] boot diagnostic failed:", error);
  }
}
function safeEffect(ctx, callback, label) {
  const effect = ctx.effect;
  if (typeof effect !== "function") return;
  try {
    effect.call(ctx, () => {
      const disposer = callback();
      return typeof disposer === "function" ? disposer : void 0;
    }, label);
  } catch (error) {
    console.error(`[agnes-media] ${label} failed:`, error);
  }
}
function StudioPage(props) {
  const send = useSendChannel();
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { "data-agnes-root": "", className: "ag-page", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "ag-page-inner", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Studio, { t: props.t, variant: "page", sendToChat: send ?? void 0 }) }) });
}
function QuickButton(props) {
  const open = useDrawer();
  const enabled = useEntryEnabled();
  if (!enabled) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
    "button",
    {
      type: "button",
      className: "ag-icon-btn",
      "data-agnes-root": "",
      "aria-pressed": open,
      "aria-label": props.t("entry.title"),
      title: props.t("entry.title"),
      onClick: () => toggleDrawer(),
      children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(EntryIcon, { size: 16 })
    }
  );
}
function useEntryEnabled() {
  const [enabled, setEnabled] = (0, import_react3.useState)(() => getEntryPrefs()?.drawerEnabled ?? true);
  (0, import_react3.useEffect)(() => subscribeEntryPrefs(() => setEnabled(() => getEntryPrefs()?.drawerEnabled ?? true)), []);
  return enabled;
}
function DrawerSeat(props) {
  const open = useDrawer();
  const send = useSendChannel();
  (0, import_react3.useEffect)(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") setDrawer(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  (0, import_react3.useEffect)(() => {
    void props.props.renderSlot?.(WORKSPACE, {});
  });
  if (!open) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { "data-agnes-root": "", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "ag-scrim", "aria-hidden": "true", onClick: () => setDrawer(false) }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("aside", { className: "ag-drawer", role: "dialog", "aria-modal": "true", "aria-label": props.t("panel.title"), children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      Studio,
      {
        t: props.t,
        variant: "drawer",
        onClose: () => setDrawer(false),
        sendToChat: send ?? void 0
      }
    ) })
  ] });
}
return module.exports; } });
//# sourceMappingURL=client.js.map
