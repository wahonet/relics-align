#!/usr/bin/env node
/**
 * 从 node_modules 拷贝 opencv.js 到 public/vendor/opencv.js。
 * 在 dev / build 前自动触发（见 package.json 的 predev / prebuild）。
 * 不使用 Vite 的 dynamic import 是因为 11MB 的 UMD JS 会被 optimizeDeps
 * 处理得不可控，也无法在浏览器侧读取真实下载进度。
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

const source = path.join(
  projectRoot,
  'node_modules',
  '@techstark',
  'opencv-js',
  'dist',
  'opencv.js',
)
const targetDir = path.join(projectRoot, 'public', 'vendor')
const target = path.join(targetDir, 'opencv.js')

async function main() {
  try {
    await fs.access(source)
  } catch {
    console.error(
      `[copy-opencv] 源文件不存在：${source}\n` +
        '请先运行 `npm install` 安装 @techstark/opencv-js。',
    )
    process.exitCode = 1
    return
  }

  const [srcStat, dstStat] = await Promise.all([
    fs.stat(source),
    fs.stat(target).catch(() => null),
  ])

  if (dstStat && dstStat.size === srcStat.size && dstStat.mtimeMs >= srcStat.mtimeMs) {
    console.log(
      `[copy-opencv] 目标已是最新（${(srcStat.size / 1024 / 1024).toFixed(1)} MB），跳过拷贝。`,
    )
    return
  }

  await fs.mkdir(targetDir, { recursive: true })
  await fs.copyFile(source, target)
  console.log(
    `[copy-opencv] 已拷贝 opencv.js → public/vendor/opencv.js（${(srcStat.size / 1024 / 1024).toFixed(1)} MB）`,
  )
}

main().catch((error) => {
  console.error('[copy-opencv] 失败：', error)
  process.exitCode = 1
})
