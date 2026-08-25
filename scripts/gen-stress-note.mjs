/**
 * 生成 1000 节点压力测试笔记（M10 交付物）。
 *
 *   node scripts/gen-stress-note.mjs
 *
 * 输出是【确定性】的：不用随机数，同样的参数每次生成一模一样的文件。
 * 这样 bench/ 里那份笔记可以进版本库，性能数字才有可比性——
 * 换一批节点文字就换一批测量结果，那测出来的东西谁也不敢信。
 *
 * 结构刻意覆盖解析器的每一类输入（附录 A）：
 * - 六层标题 + 两层列表（跨 6/7 层的边界正好在中间）
 * - 长到会折行的标题、带 **粗体** / *斜体* / `代码` 的标题
 * - 正文段落（验证「正文跟随标题」）、代码块（里面的 # 不能被当成标题）
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 目标节点数。M10 验收就是按这个数字定的。 */
const TARGET = 1000
/**
 * 各层的分叉数：第 n 项 = 深度 n 的节点有几个子节点。
 *
 * 【逐层收窄】是有意的。等分叉数的树会把 1000 个节点全堆在前几层，
 * 6/7 层那道标题↔列表的边界根本走不到，压力笔记就白造了；
 * 收窄之后 1000 个节点正好铺满 8 层，两种 kind 都有量。
 */
const FANOUT = [3, 3, 2, 2, 2, 1, 1]
/** 最深 8 层 = 6 层标题 + 2 层列表。 */
const MAX_DEPTH = FANOUT.length + 1

const 主题 = [
  '产品规划',
  '技术架构',
  '团队协作',
  '市场调研',
  '质量保障',
  '运营增长',
  '数据分析',
  '客户支持',
]
const 动词 = ['梳理', '拆解', '复盘', '推进', '验证', '归档', '评估', '同步']
const 名词 = ['方案', '指标', '流程', '接口', '预算', '排期', '风险', '结论']

/**
 * 第 i 个节点的标题文字。按下标取模，因此完全确定。
 *
 * 每 13 个里放一条超长标题（触发 measure.ts 的折行），
 * 每 7 个里放一条带行内标记的（触发 inline.ts）。
 */
function 标题(i, depth) {
  const base = `${主题[i % 主题.length]}${动词[i % 动词.length]}${名词[i % 名词.length]}`
  if (i % 13 === 0) {
    return `${base}：一条特意写得很长很长的标题，用来撑满单个节点的最大宽度并折成好几行，顺便验证折行后的高度参与布局`
  }
  if (i % 7 === 0) return `**${base}** 与 *${depth} 层* 的 \`边界\``
  return `${base} ${i}`
}

/** 一个节点在文件里的起始行。depth 1–6 是标题，7 起是列表（列表基准深度 = 6）。 */
function 行首(depth) {
  return depth <= 6 ? `${'#'.repeat(depth)} ` : `${'\t'.repeat(depth - 7)}- `
}

/**
 * 深度优先造一棵 TARGET 个节点的树，凑够数就停。
 *
 * 深度优先 → 节点下标就是文档序，读起来和文件里看到的顺序一致；
 * 根节点按需要一个个加，最后一个通常是被截断的半棵树，正好也算一种真实形态。
 */
function 建树() {
  const roots = []
  let count = 0
  const grow = (depth) => {
    const node = { depth, index: count++, children: [] }
    const fanout = FANOUT[depth - 1] ?? 0
    for (let k = 0; k < fanout && count < TARGET; k++) node.children.push(grow(depth + 1))
    return node
  }
  while (count < TARGET) roots.push(grow(1))
  return { roots, count }
}

function 写节点(out, node) {
  out.push(`${行首(node.depth)}${标题(node.index, node.depth)}`)

  // 每 9 个节点带一段正文：验证「正文跟随标题一起移动」（附录 A.8）。
  // 列表节点的正文不好界定，只给标题节点加。
  if (node.depth <= 6 && node.index % 9 === 4) {
    out.push('')
    out.push(`这是第 ${node.index} 个节点的正文，移动这个节点时它必须原样跟着走。`)
  }
  // 每 97 个节点插一段代码块：里面的 # 绝不能被当成标题（附录 A.3）。
  if (node.depth <= 6 && node.index % 97 === 11) {
    out.push('')
    out.push('```md')
    out.push('# 这一行在代码块里，不是标题')
    out.push('```')
  }
  if (node.depth <= 6) out.push('')

  for (const child of node.children) 写节点(out, child)
  // 列表块（第 7 层起）自己不留空行，整块结束后补一个，免得下一个标题贴在列表屁股上
  if (node.depth === 6 && node.children.length > 0) out.push('')
}

const { roots, count } = 建树()
const out = [
  '---',
  'title: 1000 节点压力测试',
  '---',
  '',
  '本文件由 `scripts/gen-stress-note.mjs` 生成，请勿手工编辑。',
  '',
  `节点数：${count}，最深 ${MAX_DEPTH} 层（6 层标题 + 2 层列表），每节点最多 ${FANOUT} 个子节点。`,
  '',
]
for (const root of roots) 写节点(out, root)

const file = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bench', '1000节点压力测试笔记.md')
mkdirSync(dirname(file), { recursive: true })
// 固定用 \n：换行符本身有专门的往返测试，压力笔记不掺和这件事
writeFileSync(file, `${out.join('\n')}\n`, 'utf8')
process.stdout.write(`已生成 ${file}（${count} 个节点，${out.length} 行）\n`)
