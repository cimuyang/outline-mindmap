/**
 * 把构建产物装进 Obsidian 仓库。
 *
 * 每轮手动复制 main.js / manifest.json / styles.css 三个文件，是这个项目里最容易
 * 出错的一步：漏掉一次，接下来测的就是上一版，而且看不出来——插件照常工作，
 * 只是修好的 bug 还在。真出现过一次，所以把它自动化掉。
 *
 * 用法：
 *   node scripts/deploy.mjs                    # 用 deploy.json 里记着的目标
 *   node scripts/deploy.mjs "<仓库路径>" ...    # 临时指定，同时写进 deploy.json
 *
 * 「仓库路径」给的是仓库根目录（那个含 .obsidian 的文件夹），插件目录自己拼。
 * deploy.json 只在本机，不进版本库（.gitignore 里有）。
 *
 * 【只碰这三个文件】：绝不删目录、绝不动 data.json（那是用户的设置）、
 * 绝不碰仓库里的任何笔记。
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG = join(root, 'deploy.json')
const FILES = ['main.js', 'manifest.json', 'styles.css']

const pluginId = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')).id

/**
 * 装到哪个目录。
 *
 * Obsidian 认的是 manifest 里的 id，目录名不必等于 id——历史上手动装过的目录可能叫
 * `outline-mindmap-1.1.0` 之类。【这时必须复用那个目录】：另建一个以 id 命名的目录，
 * 同一个仓库里就有了两份 id 相同的插件，Obsidian 只会加载其中一份，而且不告诉你是哪份。
 * 那正是「明明装了新版，测出来还是旧行为」的来源。
 */
function targetDir(vault) {
  const plugins = join(vault, '.obsidian', 'plugins')
  if (existsSync(plugins)) {
    for (const name of readdirSync(plugins)) {
      const manifest = join(plugins, name, 'manifest.json')
      if (!existsSync(manifest)) continue
      try {
        if (JSON.parse(readFileSync(manifest, 'utf8')).id === pluginId) return join(plugins, name)
      } catch {
        // 手写坏了的 manifest 不该拦住部署，当它不存在
      }
    }
  }
  return join(plugins, pluginId)
}

const vaults = process.argv.slice(2)
if (vaults.length > 0) {
  writeFileSync(CONFIG, `${JSON.stringify({ vaults }, null, 2)}\n`)
} else if (existsSync(CONFIG)) {
  vaults.push(...JSON.parse(readFileSync(CONFIG, 'utf8')).vaults)
}

if (vaults.length === 0) {
  console.error('没有部署目标。先跑一次：node scripts/deploy.mjs "D:\\某个仓库"')
  process.exit(1)
}

for (const file of FILES) {
  if (!existsSync(join(root, file))) {
    console.error(`缺少 ${file}，先 npm run build`)
    process.exit(1)
  }
}

let failed = false
for (const vault of vaults) {
  // 仓库路径写错时不要默默建出一个假仓库来
  if (!existsSync(join(vault, '.obsidian'))) {
    console.error(`✗ ${vault}：不像是 Obsidian 仓库（没有 .obsidian 目录），跳过`)
    failed = true
    continue
  }
  const dest = targetDir(vault)
  mkdirSync(dest, { recursive: true })
  for (const file of FILES) copyFileSync(join(root, file), join(dest, file))
  const size = statSync(join(dest, 'main.js')).size
  console.log(`✓ ${dest}（main.js ${size} 字节）`)
}

console.log(
  failed
    ? '\n部分目标失败。'
    : '\n装好了。Obsidian 里按 Ctrl+P →「重新加载应用（不保存）」，或在第三方插件里关一下再开。',
)
process.exit(failed ? 1 : 0)
