/**
 * 基于 opencv.js 的实时数字线图处理。
 *
 * 设计要点：
 *   - opencv.js 首次使用时才动态 import，避免主包体积膨胀。
 *   - 源图只加载一次（从 metadata.source 拉取），缩放到 `MAX_LONG_EDGE` 后缓存，
 *     后续滑块调参仅复用内存里的 ImageData。
 *   - 所有 cv.Mat 在函数末尾统一 delete()，防止 WASM 堆泄漏。
 */

export interface LineParameters {
  /** 1.0 ~ 16.0，越大轮廓越粗，细节丢失越多 */
  gaussianSigma: number
  /** Canny 低阈值，10 ~ 200 */
  cannyLow: number
  /** Canny 高阈值，30 ~ 260 */
  cannyHigh: number
  /** 是否叠加自适应阈值（加入细密纹理） */
  useAdaptive: boolean
  /** 自适应阈值 blockSize，奇数 5 ~ 51 */
  adaptiveBlockSize: number
  /** 自适应阈值常数 C，0 ~ 20 */
  adaptiveC: number
  /** 形态学闭运算核尺寸，0 / 3 / 5 / 7 / 9 （0 表示不做） */
  closeKernel: number
  /** 最小连通域面积占图像总面积比例，0 ~ 0.005 */
  minAreaRatio: number
  /** 仅保留面积前 N 条连通域，0 表示不限制 */
  keepLargestN: number
  /** 描线膨胀迭代次数，0 ~ 3 */
  dilateIters: number
  /** true = 白底黑线（默认），false = 黑底白线 */
  invert: boolean
}

export const DEFAULT_LINE_PARAMETERS: LineParameters = {
  gaussianSigma: 7,
  cannyLow: 45,
  cannyHigh: 130,
  useAdaptive: true,
  adaptiveBlockSize: 23,
  adaptiveC: 10,
  closeKernel: 3,
  minAreaRatio: 0.0003,
  keepLargestN: 0,
  dilateIters: 0,
  invert: true,
}

export const LINE_PRESETS: Record<string, { label: string; params: LineParameters }> = {
  skeleton: {
    label: '粗骨架',
    params: {
      gaussianSigma: 13,
      cannyLow: 70,
      cannyHigh: 180,
      useAdaptive: false,
      adaptiveBlockSize: 33,
      adaptiveC: 6,
      closeKernel: 5,
      minAreaRatio: 0.0012,
      keepLargestN: 40,
      dilateIters: 2,
      invert: true,
    },
  },
  standard: {
    label: '标准',
    params: { ...DEFAULT_LINE_PARAMETERS },
  },
  detailed: {
    label: '细致',
    params: {
      gaussianSigma: 1.4,
      cannyLow: 25,
      cannyHigh: 85,
      useAdaptive: true,
      adaptiveBlockSize: 13,
      adaptiveC: 14,
      closeKernel: 3,
      minAreaRatio: 0,
      keepLargestN: 0,
      dilateIters: 0,
      invert: true,
    },
  },
}

/**
 * 源图处理时的最大长边。
 * 与后端 previewLongEdge 对齐在 2048：
 *   - 原先取 3072，连通域扫描 + adaptiveThreshold 容易让主线程长时间阻塞；
 *   - 2048 下单次线图稳定在 1~2 秒，视觉差异对比微弱。
 */
const MAX_LONG_EDGE = 2048

/** 由 scripts/copy-opencv.mjs 在 predev/prebuild 时写入 public/vendor。 */
const OPENCV_URL = '/vendor/opencv.js'
/** 初始化阶段最长允许耗时（毫秒）。 */
const WASM_INIT_TIMEOUT_MS = 90_000

type Cv = typeof import('@techstark/opencv-js')

type CvWindow = Window &
  typeof globalThis & {
    cv?: Cv & {
      Mat?: unknown
      onRuntimeInitialized?: () => void
    }
  }

export type CvLoadProgress =
  | { stage: 'downloading'; received: number; total: number }
  | { stage: 'decoding'; wasmBytes: number }
  | { stage: 'injecting'; scriptBytes: number }
  | { stage: 'initializing'; elapsedMs: number }
  | { stage: 'ready'; elapsedMs: number }

let cvPromise: Promise<Cv> | null = null
let progressListeners: Array<(progress: CvLoadProgress) => void> = []

function emitProgress(progress: CvLoadProgress): void {
  for (const listener of progressListeners) {
    try {
      listener(progress)
    } catch {
      // 不让监听器异常影响加载流程
    }
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message || err.name || 'Error'
  }
  return typeof err === 'string' ? err : JSON.stringify(err)
}

/**
 * 启动或复用 opencv.js 加载任务。调用方可通过 onProgress 订阅每个阶段的进度；
 * 多次调用会复用同一个加载 Promise，多个监听器都能收到事件。
 */
export function getCv(onProgress?: (progress: CvLoadProgress) => void): Promise<Cv> {
  if (onProgress) {
    progressListeners.push(onProgress)
  }

  const win = window as CvWindow
  if (win.cv?.Mat) {
    onProgress?.({ stage: 'ready', elapsedMs: 0 })
    return Promise.resolve(win.cv as Cv)
  }

  if (cvPromise) {
    return cvPromise
  }

  cvPromise = (async (): Promise<Cv> => {
    const startedAt = performance.now()
    // 捕获 emscripten 日志：若初始化失败，可附到错误信息里帮助定位
    const runtimeLogs: string[] = []
    const pushLog = (prefix: string) => (message?: string) => {
      if (message !== undefined) {
        runtimeLogs.push(`[${prefix}] ${String(message)}`)
      }
    }

    // 关键里程碑时间戳：主线程卡死时至少能从 F12 控制台看清楚卡在哪一步
    const milestones: Array<{ name: string; at: number }> = []
    const mark = (name: string, extra?: string) => {
      const at = Math.round(performance.now() - startedAt)
      milestones.push({ name, at })
      console.log(`[opencv] +${at}ms ${name}${extra ? ' · ' + extra : ''}`)
    }
    // 把事件循环让一次，让 React/overlay 有机会渲染最新状态
    const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

    mark('start')

    // === 1. 下载 opencv.js 文本（真实字节进度） ===
    let response: Response
    try {
      response = await fetch(OPENCV_URL, { cache: 'force-cache' })
    } catch (error) {
      throw new Error(
        `无法连接到 ${OPENCV_URL}（${describeError(error)}）。` +
          '请确认 scripts/copy-opencv.mjs 已运行，public/vendor/opencv.js 存在。',
        { cause: error },
      )
    }

    if (!response.ok) {
      throw new Error(
        `下载 ${OPENCV_URL} 失败：HTTP ${response.status} ${response.statusText}。` +
          '若文件缺失，请重新执行 `npm run prepare:opencv`。',
      )
    }

    const lengthHeader = response.headers.get('content-length')
    const total = lengthHeader ? Number(lengthHeader) : 10_800_000
    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('浏览器未返回可读流（response.body 为空），无法监控下载进度。')
    }

    const chunks: Uint8Array[] = []
    let received = 0

    emitProgress({ stage: 'downloading', received: 0, total })

    try {
      let streaming = true
      while (streaming) {
        const { done, value } = await reader.read()
        if (done) {
          streaming = false
          break
        }
        if (value) {
          chunks.push(value)
          received += value.byteLength
          emitProgress({ stage: 'downloading', received, total })
        }
      }
    } catch (error) {
      throw new Error(`下载 opencv.js 时中断：${describeError(error)}`, { cause: error })
    }

    mark('downloaded', `${received} bytes`)
    await yieldToUi()

    // 合并成单个字符串，便于剥离 base64 wasm
    const merged = new Uint8Array(received)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.byteLength
    }
    // 清空数组释放引用
    chunks.length = 0
    const jsText = new TextDecoder('utf-8').decode(merged)
    mark('text-decoded', `${jsText.length} chars`)
    await yieldToUi()

    // === 2. 抽出内嵌 base64 wasm 并直接解码 ===
    // opencv.js 用 `wasmBinaryFile="data:application/octet-stream;base64,..."` 承载 wasm
    // 浏览器在某些壳里 fetch 超长 data URL 会把主线程卡死，自己解码最稳。
    const wasmPattern = /wasmBinaryFile\s*=\s*(['"])data:application\/octet-stream;base64,([A-Za-z0-9+/=]+)\1/
    const match = jsText.match(wasmPattern)
    if (!match) {
      throw new Error(
        '在 opencv.js 中找不到内嵌的 wasm 数据（wasmBinaryFile=...）。' +
          '该包可能不是 @techstark/opencv-js 的内嵌 wasm 版本。',
      )
    }

    const base64 = match[2]
    mark('wasm-base64-matched', `${base64.length} chars`)
    // 先把 decoding 状态推出去，再让事件循环渲染一次，才开始 atob
    emitProgress({ stage: 'decoding', wasmBytes: Math.round((base64.length * 3) / 4) })
    await yieldToUi()

    let wasmBinary: Uint8Array<ArrayBuffer>
    try {
      // 直接走 atob 同步路径；7.5MB 的 wasm 大约耗时 200~500ms，远短于 compile。
      // 避开 fetch(dataURL)——它在某些 Chromium 壳里会把主线程挂死。
      const binaryString = atob(base64)
      const buffer = new ArrayBuffer(binaryString.length)
      wasmBinary = new Uint8Array(buffer)
      for (let i = 0; i < binaryString.length; i += 1) {
        wasmBinary[i] = binaryString.charCodeAt(i)
      }
      mark('wasm-decoded-via-atob', `${wasmBinary.byteLength} bytes`)
    } catch (error) {
      throw new Error(`解码 wasm base64 失败：${describeError(error)}`, { cause: error })
    }
    emitProgress({ stage: 'decoding', wasmBytes: wasmBinary.byteLength })
    await yieldToUi()

    // === 3. 预设全局 __cvPreModule，提供 wasmBinary + instantiateWasm + onRuntimeInitialized ===
    // opencv.js UMD 工厂末尾是 `if (typeof Module === 'undefined') var Module = {};`，
    // 无法直接通过 window.cv 注入。我们在脚本文本里把这行改成读取 window.__cvPreModule，
    // 然后在此之前把 wasmBinary、instantiateWasm、onRuntimeInitialized 全挂上去，
    // 避免初始化完成后回调已经错过的竞态。
    let wasmResolve: (() => void) | null = null
    let wasmReject: ((err: Error) => void) | null = null
    const wasmReadyPromise = new Promise<void>((resolve, reject) => {
      wasmResolve = resolve
      wasmReject = reject
    })

    const preModuleHolder = {
      wasmBinary,
      instantiateWasm: (
        imports: WebAssembly.Imports,
        successCallback: (
          instance: WebAssembly.Instance,
          module: WebAssembly.Module,
        ) => void,
      ): Record<string, never> => {
        mark('instantiateWasm-called')
        // 关键：用 compileStreaming 触发 V8 的 off-thread wasm 编译，
        // 否则 WebAssembly.instantiate(bytes) 在部分 Chromium 版本会在主线程同步编译，
        // 导致页面卡死直到「无响应」弹窗。
        const wasmResponse = new Response(wasmBinary, {
          headers: { 'Content-Type': 'application/wasm' },
        })
        const compileStreaming = (
          WebAssembly as {
            compileStreaming?: (src: Promise<Response> | Response) => Promise<WebAssembly.Module>
          }
        ).compileStreaming
        const compilePromise = compileStreaming
          ? compileStreaming(wasmResponse)
          : WebAssembly.compile(wasmBinary)

        compilePromise
          .then((compiledModule) => {
            mark('wasm-compiled')
            // Instance 构造是同步链接，极快（几十毫秒量级）
            const instance = new WebAssembly.Instance(compiledModule, imports)
            mark('wasm-instantiated')
            successCallback(instance, compiledModule)
          })
          .catch((err) => {
            mark('wasm-compile-failed', describeError(err))
            runtimeLogs.push(`[instantiate] ${describeError(err)}`)
            wasmReject?.(
              new Error(
                `WebAssembly 编译/实例化失败：${describeError(err)}`,
                { cause: err },
              ),
            )
          })
        return {}
      },
      print: pushLog('stdout'),
      printErr: pushLog('stderr'),
      onRuntimeInitialized: () => {
        mark('onRuntimeInitialized')
        wasmResolve?.()
      },
    }
    ;(win as unknown as Record<string, unknown>).__cvPreModule = preModuleHolder

    // 1) 剥离 base64 wasm（注入体积从 ~10MB 降到 ~3MB）
    // 2) 把 `var Module = {}` 改成从 __cvPreModule 取，这样 wasmBinary/instantiateWasm 真正生效
    const moduleInitPattern =
      /if\s*\(\s*typeof\s+Module\s*===?\s*['"]undefined['"]\s*\)\s*\r?\n?\s*var\s+Module\s*=\s*\{\s*\};?/
    if (!moduleInitPattern.test(jsText)) {
      throw new Error(
        '未能在 opencv.js 中定位 Module 初始化语句，无法注入 wasmBinary。' +
          '可能是上游包版本不兼容（当前仅适配 @techstark/opencv-js 4.x）。',
      )
    }
    const slimText = jsText
      .replace(wasmPattern, 'wasmBinaryFile=""')
      .replace(
        moduleInitPattern,
        'if(typeof Module==="undefined")var Module=(typeof window!=="undefined"&&window.__cvPreModule)?window.__cvPreModule:{};',
      )
    mark('slim-text-ready', `${slimText.length} chars`)
    await yieldToUi()

    // === 4. 注入 slim script（UMD 末尾会触发 cv(Module) 并返回 Module） ===
    const scriptBytes = new Blob([slimText]).size
    emitProgress({ stage: 'injecting', scriptBytes })
    await yieldToUi()
    const scriptBlob = new Blob([slimText], { type: 'application/javascript' })
    const blobUrl = URL.createObjectURL(scriptBlob)
    mark('script-blob-created')

    try {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script')
        script.src = blobUrl
        script.async = false
        script.onload = () => {
          mark('script-onload')
          resolve()
        }
        script.onerror = () =>
          reject(new Error('opencv.js 脚本加载/执行失败（script onerror）'))
        document.head.appendChild(script)
      })
    } finally {
      URL.revokeObjectURL(blobUrl)
    }

    if (!win.cv) {
      throw new Error('opencv.js 已执行，但 window.cv 未被定义（UMD 包可能损坏）。')
    }
    mark('window-cv-set', `Mat=${!!win.cv.Mat}`)
    await yieldToUi()

    // === 5. 等 WebAssembly 初始化（onRuntimeInitialized 在注入前就已挂好） ===
    const initStarted = performance.now()
    let tickerId: number | null = null
    try {
      if (!win.cv.Mat) {
        tickerId = window.setInterval(() => {
          emitProgress({
            stage: 'initializing',
            elapsedMs: Math.round(performance.now() - initStarted),
          })
        }, 250)
        emitProgress({ stage: 'initializing', elapsedMs: 0 })

        await Promise.race([
          wasmReadyPromise,
          new Promise<never>((_, reject) => {
            window.setTimeout(() => {
              const tail = runtimeLogs.slice(-8).join('\n')
              const stepsReport = milestones
                .map((m) => `  +${m.at}ms ${m.name}`)
                .join('\n')
              reject(
                new Error(
                  `WebAssembly 初始化超时（> ${Math.round(
                    WASM_INIT_TIMEOUT_MS / 1000,
                  )} 秒）。\n\n里程碑：\n${stepsReport}` +
                    (tail
                      ? `\n\n最近的 emscripten 日志：\n${tail}`
                      : '\n\n没有捕获到 emscripten 日志，通常说明主线程被 wasm 编译霸占；建议换最新 Chrome/Edge 再试。'),
                ),
              )
            }, WASM_INIT_TIMEOUT_MS)
          }),
        ])
      }
    } finally {
      if (tickerId !== null) {
        window.clearInterval(tickerId)
      }
    }

    if (!win.cv.Mat) {
      const tail = runtimeLogs.slice(-8).join('\n')
      throw new Error(
        'WebAssembly 回调已触发，但 cv.Mat 仍不可用（opencv.js 损坏或 WASM 未加载）。' +
          (tail ? `\n\n最近的 emscripten 日志：\n${tail}` : ''),
      )
    }

    mark('cv.Mat-ready')
    emitProgress({
      stage: 'ready',
      elapsedMs: Math.round(performance.now() - startedAt),
    })
    return win.cv as Cv
  })().catch((error) => {
    cvPromise = null
    progressListeners = []
    throw error
  })

  return cvPromise
}

export interface LineSource {
  imageData: ImageData
  width: number
  height: number
  sourceWidth: number
  sourceHeight: number
}

let sourceCache: { url: string; data: LineSource } | null = null

function createRunLogger(tag: string): (name: string, extra?: string) => void {
  const startedAt = performance.now()
  return (name, extra) => {
    const at = Math.round(performance.now() - startedAt)
    console.log(`[${tag}] +${at}ms ${name}${extra ? ' · ' + extra : ''}`)
  }
}

/** 从一个 URL 加载位图并缩放到 MAX_LONG_EDGE，返回可反复使用的 ImageData。 */
export async function loadLineSource(url: string): Promise<LineSource> {
  if (sourceCache && sourceCache.url === url) {
    console.log('[source] cache hit', url)
    return sourceCache.data
  }

  const mark = createRunLogger('source')
  mark('start', url)

  const image = await loadImage(url)
  mark('image-loaded', `${image.naturalWidth}x${image.naturalHeight}`)

  const sourceWidth = image.naturalWidth
  const sourceHeight = image.naturalHeight
  const longEdge = Math.max(sourceWidth, sourceHeight)
  const scale = longEdge > MAX_LONG_EDGE ? MAX_LONG_EDGE / longEdge : 1
  const width = Math.round(sourceWidth * scale)
  const height = Math.round(sourceHeight * scale)
  mark('scaled-size', `${width}x${height} (scale=${scale.toFixed(3)})`)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    throw new Error('无法创建 Canvas 2D 上下文')
  }
  ctx.drawImage(image, 0, 0, width, height)
  mark('canvas-drawn')
  const imageData = ctx.getImageData(0, 0, width, height)
  mark('image-data-extracted', `${imageData.data.byteLength} bytes`)

  const data: LineSource = { imageData, width, height, sourceWidth, sourceHeight }
  sourceCache = { url, data }
  return data
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`加载图像失败：${url}`))
    image.src = url
  })
}

function toOddClamp(raw: number, min: number, max: number): number {
  const clamped = Math.min(max, Math.max(min, Math.round(raw)))
  return clamped % 2 === 1 ? clamped : clamped + 1
}

export interface LineRenderResult {
  blob: Blob
  url: string
  width: number
  height: number
  sourceWidth: number
  sourceHeight: number
  byteLength: number
  elapsedMs: number
}

/**
 * 把事件循环让一次，给浏览器重绘 + 响应用户操作（比如切换到别的面板）。
 * 浏览器端 opencv.js 的每个算子都同步跑在主线程，必须在算子之间主动让帧，
 * 否则整段管线会形成一个几百毫秒的 Long Task，表现为"页面卡死"。
 */
const yieldFrame = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0))

/** 运行一遍线图处理；调用方负责在新结果到来时 revoke 上一次的 URL。 */
export async function renderLine(
  source: LineSource,
  params: LineParameters,
): Promise<LineRenderResult> {
  const started = performance.now()
  const mark = createRunLogger('line')
  mark(
    'start',
    `${source.width}x${source.height} params=${JSON.stringify(params)}`,
  )

  const cv = await getCv()
  mark('cv-ready')
  await yieldFrame()

  // 载入 + 灰度
  const src = cv.matFromImageData(source.imageData)
  mark('mat-from-imagedata')
  const gray = new cv.Mat()
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
  src.delete()
  mark('cvtColor-gray')

  // 高斯模糊
  const blurred = new cv.Mat()
  const sigma = Math.max(0.1, params.gaussianSigma)
  cv.GaussianBlur(gray, blurred, new cv.Size(0, 0), sigma, sigma, cv.BORDER_DEFAULT)
  mark('GaussianBlur', `sigma=${sigma}`)
  await yieldFrame()

  // Canny
  let combined = new cv.Mat()
  cv.Canny(blurred, combined, params.cannyLow, params.cannyHigh)
  blurred.delete()
  mark('Canny', `low=${params.cannyLow} high=${params.cannyHigh}`)
  await yieldFrame()

  // 自适应阈值（可选）
  if (params.useAdaptive) {
    const adaptive = new cv.Mat()
    const block = toOddClamp(params.adaptiveBlockSize, 3, 99)
    cv.adaptiveThreshold(
      gray,
      adaptive,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY_INV,
      block,
      params.adaptiveC,
    )
    mark('adaptiveThreshold', `block=${block} C=${params.adaptiveC}`)
    const openKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3))
    cv.morphologyEx(adaptive, adaptive, cv.MORPH_OPEN, openKernel)
    openKernel.delete()
    mark('morph-open-on-adaptive')

    const merged = new cv.Mat()
    cv.bitwise_or(combined, adaptive, merged)
    adaptive.delete()
    combined.delete()
    combined = merged
    mark('bitwise_or(canny, adaptive)')
    await yieldFrame()
  }

  gray.delete()

  // 形态学闭合
  if (params.closeKernel > 0) {
    const size = toOddClamp(params.closeKernel, 3, 15)
    const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(size, size))
    const closed = new cv.Mat()
    cv.morphologyEx(combined, closed, cv.MORPH_CLOSE, kernel)
    kernel.delete()
    combined.delete()
    combined = closed
    mark('morph-close', `size=${size}`)
    await yieldFrame()
  }

  // 连通域过滤
  if (params.minAreaRatio > 0 || params.keepLargestN > 0) {
    const labels = new cv.Mat()
    const stats = new cv.Mat()
    const centroids = new cv.Mat()
    const numLabels = cv.connectedComponentsWithStats(
      combined,
      labels,
      stats,
      centroids,
      8,
      cv.CV_32S,
    )
    mark('connectedComponentsWithStats', `numLabels=${numLabels}`)
    const imgArea = combined.rows * combined.cols
    const minArea = Math.floor(imgArea * params.minAreaRatio)

    const areas: Array<{ id: number; area: number }> = []
    // stats 是 (numLabels, 5) 的 CV_32S 矩阵；row 0 为背景
    const statsData = stats.data32S
    const CC_STAT_AREA = 4
    for (let i = 1; i < numLabels; i += 1) {
      const area = statsData[i * 5 + CC_STAT_AREA]
      if (area >= minArea) {
        areas.push({ id: i, area })
      }
    }

    let keepIds: Set<number>
    if (params.keepLargestN > 0) {
      areas.sort((a, b) => b.area - a.area)
      keepIds = new Set(areas.slice(0, params.keepLargestN).map((item) => item.id))
    } else {
      keepIds = new Set(areas.map((item) => item.id))
    }
    mark('connected-components-kept', `count=${keepIds.size}/${areas.length}`)

    const labelsData = labels.data32S as Int32Array
    const filtered = cv.Mat.zeros(combined.rows, combined.cols, cv.CV_8UC1)
    const filteredData = filtered.data as Uint8Array
    // 分批扫描像素；每 1M 像素让一次帧，避免单个 Long Task 卡住主线程。
    const CHUNK = 1 << 20
    for (let base = 0; base < labelsData.length; base += CHUNK) {
      const end = Math.min(base + CHUNK, labelsData.length)
      for (let i = base; i < end; i += 1) {
        if (keepIds.has(labelsData[i])) {
          filteredData[i] = 255
        }
      }
      if (end < labelsData.length) {
        await yieldFrame()
      }
    }
    mark('components-filter-applied', `pixels=${labelsData.length}`)
    await yieldFrame()

    labels.delete()
    stats.delete()
    centroids.delete()
    combined.delete()
    combined = filtered
  }

  // 描线加粗
  if (params.dilateIters > 0) {
    const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3))
    const dilated = new cv.Mat()
    cv.dilate(combined, dilated, kernel, new cv.Point(-1, -1), params.dilateIters)
    kernel.delete()
    combined.delete()
    combined = dilated
    mark('dilate', `iters=${params.dilateIters}`)
    await yieldFrame()
  }

  // 反色
  if (params.invert) {
    const inverted = new cv.Mat()
    cv.bitwise_not(combined, inverted)
    combined.delete()
    combined = inverted
    mark('invert')
  }

  // 输出
  const outCanvas = document.createElement('canvas')
  outCanvas.width = combined.cols
  outCanvas.height = combined.rows
  cv.imshow(outCanvas, combined)
  mark('cv.imshow')
  const width = combined.cols
  const height = combined.rows
  combined.delete()

  const blob = await new Promise<Blob>((resolve, reject) => {
    outCanvas.toBlob(
      (result) => {
        if (result) {
          resolve(result)
        } else {
          reject(new Error('toBlob 返回空 Blob'))
        }
      },
      'image/png',
    )
  })
  mark('toBlob', `${blob.size} bytes`)

  const url = URL.createObjectURL(blob)
  return {
    blob,
    url,
    width,
    height,
    sourceWidth: source.sourceWidth,
    sourceHeight: source.sourceHeight,
    byteLength: blob.size,
    elapsedMs: Math.round(performance.now() - started),
  }
}

// ---------------------------------------------------------------------------
// 细线描边：完全独立的后处理（走后端，不用浏览器端 opencv.js）
// ---------------------------------------------------------------------------

export interface ThinLineResult {
  url: string
  blob: Blob
  width: number
  height: number
  byteLength: number
  elapsedMs: number
}

/**
 * 把已渲染好的线图 POST 到后端 /api/thin-line，
 * 后端 findContours + drawContours(LINE_AA) 后返回新 PNG。
 * 不加载浏览器端 opencv.js，不卡主线程。
 */
export async function applyThinLine(
  sourceUrl: string,
  lineWidth: number,
  apiBase: string,
): Promise<ThinLineResult> {
  const started = performance.now()

  // 把 blob URL 或普通 URL 拿到 Blob
  const resp = await fetch(sourceUrl)
  const srcBlob = await resp.blob()

  const form = new FormData()
  form.append('image', srcBlob, 'line.png')
  form.append('lineWidth', String(lineWidth))

  const result = await fetch(`${apiBase}/api/thin-line`, {
    method: 'POST',
    body: form,
  })

  if (!result.ok) {
    const text = await result.text().catch(() => '')
    throw new Error(`thin-line ${result.status}: ${text.slice(0, 300)}`)
  }

  const blob = await result.blob()
  const width = Number(result.headers.get('x-line-width') ?? 0)
  const height = Number(result.headers.get('x-line-height') ?? 0)
  const url = URL.createObjectURL(blob)

  return {
    url,
    blob,
    width,
    height,
    byteLength: blob.size,
    elapsedMs: Math.round(performance.now() - started),
  }
}
