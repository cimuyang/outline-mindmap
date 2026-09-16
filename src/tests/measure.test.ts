import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { MAX_TEXT_WIDTH, PADDING_X, measureNode, type FontSpec } from '../view/measure'

const FONT: FontSpec = {
  family: 'sans-serif',
  size: 16,
  lineHeight: 23,
  key: '16|sans-serif',
}

describe('measureNode：行内公式', () => {
  beforeAll(() => {
    // node 测试环境没有 canvas；让 measure.ts 走自己的字符宽度估算分支。
    vi.stubGlobal('createEl', () => ({ getContext: () => null }))
  })

  afterAll(() => vi.unstubAllGlobals())

  it('公式作为不可拆分的原子参与折行，必要时可超过普通文本的 320px 上限', () => {
    const formula = `$${'a '.repeat(50).trim()}$`
    const size = measureNode(formula, FONT)
    expect(size.w).toBeGreaterThan(MAX_TEXT_WIDTH + PADDING_X * 2)
  })

  it('公式为上下标、分数等 MathJax 盒子预留额外的垂直空间', () => {
    const plain = measureNode('abc', FONT)
    const math = measureNode('$\\frac{a}{b}$', FONT)
    expect(math.h).toBeGreaterThan(plain.h)
  })

  it('多层嵌套分式会随结构深度继续增高', () => {
    const single = measureNode('$\\dfrac{1}{x}$', FONT)
    const nested = measureNode(
      '$\\dfrac{1}{1+\\dfrac{1}{1+\\dfrac{1}{x}}}$',
      FONT,
    )
    const scriptStyle = measureNode('$x=a_0+\\frac{1}{a_1+\\frac{1}{a_2+\\frac{1}{a_3}}}$', FONT)

    expect(nested.h).toBeGreaterThanOrEqual(single.h + Math.ceil(FONT.lineHeight * 1.4))
    // 普通 `\frac` 进入分母后会自动缩成 script style，不能按每层全尺寸无限堆高。
    expect(scriptStyle.h).toBeLessThan(90)
  })

  it('显式水平间距与竖向 rule 会进入节点尺寸', () => {
    const spaced = measureNode('$a\\hspace{8em}b$', FONT)
    const tall = measureNode('$a+\\rule{0.4em}{5em}+b$', FONT)

    expect(spaced.w).toBeGreaterThanOrEqual(180)
    expect(tall.h).toBeGreaterThanOrEqual(96)
  })

  it('组合的分式与叠加标注会累加竖向空间', () => {
    const stacked = measureNode(
      '$\\overset{\\dfrac{a}{b}}{\\dfrac{c}{d}}$',
      FONT,
    )

    expect(stacked.h).toBeGreaterThanOrEqual(78)
  })

  it('TeX 物理单位与带 raise 的 rule 会进入节点尺寸', () => {
    const inch = measureNode('$a\\hspace{1in}b$', FONT)
    const centimetre = measureNode('$a\\hspace{2.54cm}b$', FONT)
    const raised = measureNode('$a+\\rule[5em]{1em}{1em}+b$', FONT)

    expect(inch.w).toBeGreaterThanOrEqual(150)
    expect(Math.abs(inch.w - centimetre.w)).toBeLessThanOrEqual(2)
    expect(raised.h).toBeGreaterThanOrEqual(110)
  })

  it('公式宽度按可见内容估算，不被矩阵环境等 LaTeX 控制词撑出大片空白', () => {
    const plain = measureNode('$a+b$', FONT)
    const matrix = measureNode('$\\begin{pmatrix}a&b\\\\c&d\\\\e&f\\end{pmatrix}$', FONT)

    expect(matrix.w).toBeLessThan(220)
    expect(matrix.h).toBeGreaterThan(plain.h)
    // Obsidian 1.13.7 的 MathJax 会让三行矩阵的伸缩括号比旧估算再高约 8px。
    // 86px 是 GUI 实测不裁切所需的最小节点高度（16px 字号、23px 行高）。
    expect(matrix.h).toBeGreaterThanOrEqual(86)
  })
})
