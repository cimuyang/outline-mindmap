import { describe, expect, it } from 'vitest'
import { parseInline, plainText, tagsFor } from '../view/inline'

/** 无样式片段的完整形状，省得每处都把六个字段写全。 */
const plain = (text: string) => ({
  text,
  bold: false,
  italic: false,
  highlight: false,
  strike: false,
  link: false,
})

describe('parseInline', () => {
  it('纯文字只有一段，且不带任何样式', () => {
    expect(parseInline('普通标题')).toEqual([plain('普通标题')])
  })

  it('四种基础语法各自生效', () => {
    expect(parseInline('**粗**')[0]?.bold).toBe(true)
    expect(parseInline('*斜*')[0]?.italic).toBe(true)
    expect(parseInline('==高亮==')[0]?.highlight).toBe(true)
    expect(parseInline('~~删除~~')[0]?.strike).toBe(true)
  })

  it('`***` 同时是粗和斜，不会被拆成 `**` + `*`', () => {
    const [seg] = parseInline('***粗斜***')
    expect(seg?.bold).toBe(true)
    expect(seg?.italic).toBe(true)
    expect(seg?.text).toBe('粗斜')
  })

  it('嵌套组合：***==粗斜高亮==***', () => {
    const [seg] = parseInline('***==粗斜高亮==***')
    expect(seg).toEqual({ ...plain('粗斜高亮'), bold: true, italic: true, highlight: true })
  })

  it('四种样式全叠加', () => {
    const [seg] = parseInline('**~~==*全*==~~**')
    expect(seg).toEqual({
      ...plain('全'),
      bold: true,
      italic: true,
      highlight: true,
      strike: true,
    })
  })

  it('部分加粗时切成多段，未加粗的部分保持原样', () => {
    expect(parseInline('前**中**后')).toEqual([
      plain('前'),
      { ...plain('中'), bold: true },
      plain('后'),
    ])
  })

  it('未配对的标记当普通文字，不吞字符', () => {
    expect(plainText('2 * 3 = 6')).toBe('2 * 3 = 6')
    expect(plainText('**没关上')).toBe('**没关上')
    expect(plainText('a ~~ b')).toBe('a ~~ b')
  })

  it('交叉嵌套是病态输入：不猜意图，但保证不吞掉正文字符', () => {
    // `**a *b** c*`：`*` 想在 `**` 之外闭合，无法构成合法嵌套。
    // 这种输入怎么渲染都不算错，唯一的硬要求是正文一个字都不能丢。
    const out = plainText('**a *b** c*')
    expect(out).toContain('a')
    expect(out).toContain('b')
    expect(out).toContain('c')
  })

  it('反斜杠转义标记字符', () => {
    expect(plainText('\\*不是斜体\\*')).toBe('*不是斜体*')
    expect(parseInline('\\*不是斜体\\*')[0]?.italic).toBe(false)
  })

  it('空文本返回空数组', () => {
    expect(parseInline('')).toEqual([])
  })

  it('相邻的同样式片段被合并，不会一字一段', () => {
    expect(parseInline('abc')).toHaveLength(1)
    expect(parseInline('**a**b**c**')).toHaveLength(3)
  })
})

describe('parseInline：链接', () => {
  it('`[[笔记]]` 显示笔记名，方括号不出现在正文里', () => {
    expect(parseInline('[[某笔记]]')).toEqual([{ ...plain('某笔记'), link: true }])
  })

  it('`[[路径|别名]]` 显示别名，路径不占宽度', () => {
    expect(plainText('[[文件夹/子/目标|别名]]')).toBe('别名')
  })

  it('`[[笔记#小节]]` 与 `[[#小节]]` 都显示小节名', () => {
    expect(plainText('[[笔记#小节]]')).toBe('小节')
    expect(plainText('[[#小节]]')).toBe('小节')
  })

  it('标准 `[文字](url)` 只显示文字，URL 不显示', () => {
    expect(parseInline('[文字](https://a.example/b)')).toEqual([
      { ...plain('文字'), link: true },
    ])
  })

  it('链接和前后文字断成不同片段', () => {
    expect(parseInline('前[[中]]后')).toEqual([
      plain('前'),
      { ...plain('中'), link: true },
      plain('后'),
    ])
  })

  it('链接继承外层强调：`**[[笔记]]**` 是粗体链接', () => {
    expect(parseInline('**[[笔记]]**')).toEqual([
      { ...plain('笔记'), bold: true, link: true },
    ])
  })

  it('链接内部的 `**` 属于目标名，不当加粗解析', () => {
    expect(plainText('[[a**b**c]]')).toBe('a**b**c')
  })

  it('没闭合的链接当普通文字，一个字符都不吞', () => {
    expect(plainText('[[没关上')).toBe('[[没关上')
    expect(plainText('[文字](没关上')).toBe('[文字](没关上')
    expect(plainText('单个 [ 方括号')).toBe('单个 [ 方括号')
  })

  it('`[](url)` 没有可读文字，不留空片段', () => {
    expect(parseInline('[](https://a.example)')).toEqual([])
  })

  it('方括号叠在一起时，取里面那个合法的链接，外面的当普通文字', () => {
    // `[[a[[b]]`：外层的 `[[a[[b]]` 目标名里还有 `[`，不是合法链接；
    // 但里面的 `[[b]]` 自成一个链接。这也是 Obsidian 自己的读法。
    expect(parseInline('[[a[[b]]')).toEqual([
      plain('[[a'),
      { ...plain('b'), link: true },
    ])
  })

  it('纯文字的 link 一律为 false', () => {
    expect(parseInline('普通')[0]?.link).toBe(false)
  })
})

describe('tagsFor', () => {
  it('内层在前、外层在后：`***==x==***` → mark 最内、strong 最外', () => {
    const [seg] = parseInline('***==粗斜高亮==***')
    expect(tagsFor(seg!).map((t) => t.tag)).toEqual(['mark', 'em', 'strong'])
  })

  it('无样式片段不需要任何包裹', () => {
    const [seg] = parseInline('普通')
    expect(tagsFor(seg!)).toEqual([])
  })

  it('链接在最内层，且用不可点击的 span 带 om-link', () => {
    const [seg] = parseInline('**[[笔记]]**')
    expect(tagsFor(seg!)).toEqual([{ tag: 'span', cls: 'om-link' }, { tag: 'strong' }])
  })

  it('四种样式全叠加时层序稳定', () => {
    const [seg] = parseInline('**~~==*全*==~~**')
    expect(tagsFor(seg!).map((t) => t.tag)).toEqual(['s', 'mark', 'em', 'strong'])
  })

  it('链接一律是不可点击的 span，绝不产出 a 标签', () => {
    const [seg] = parseInline('[[笔记]]')
    expect(tagsFor(seg!).some((t) => t.tag === 'a')).toBe(false)
  })
})

/**
 * 陷阱 13 的接班测试。
 *
 * 旧实现拼 HTML 字符串，所以要测「`<script>` 有没有被转义成实体」。现在 inline.ts
 * 【不再产出任何 HTML】：标记字符原样留在片段的 text 里，由 NodeRenderer 走
 * createEl + appendText 写进 DOM。所以这里改成守住新的不变量——尖括号不被当语法、
 * 原样带过，一个字符都不增删。
 *
 * 「标签不会被执行」这一半不在这里测：测试环境是 node，没有 DOM。它由渲染层的
 * 类型本身保证——tagsFor 只报出固定的五个标签名，片段文字只经文本节点落地，
 * 代码里没有任何一处能把字符串当 HTML 解析（见 NodeRenderer.renderTextInto）。
 */
describe('parseInline：HTML 不是语法', () => {
  it('尖括号原样保留，不被解析也不被转义', () => {
    const raw = '<script>alert(1)</script>'
    expect(plainText(raw)).toBe(raw)
    expect(parseInline(raw)).toEqual([plain(raw)])
  })

  it('带引号和属性的标签同样只是文字', () => {
    const raw = '<img src="x" onerror="alert(1)">'
    expect(plainText(raw)).toBe(raw)
  })

  it('标签夹在强调里也不影响强调本身', () => {
    expect(parseInline('**<b>x</b>**')).toEqual([{ ...plain('<b>x</b>'), bold: true }])
  })
})

describe('parseInline：行内公式', () => {
  it('`$...$` 单独切成公式片段，定界符不进入公式源码', () => {
    expect(parseInline('位权：$2^i$')).toEqual([
      plain('位权：'),
      { ...plain('2^i'), math: true },
    ])
  })

  it('公式内部的 Markdown 标记保持为 LaTeX 源码，不参与强调解析', () => {
    expect(parseInline('$a*b**c$')).toEqual([
      { ...plain('a*b**c'), math: true },
    ])
  })

  it('一行可以有多个公式，公式之间的普通文字照常解析', () => {
    expect(parseInline('$x$ + $y$')).toEqual([
      { ...plain('x'), math: true },
      plain(' + '),
      { ...plain('y'), math: true },
    ])
  })

  it('公式继承外层强调，但强调标记不进入公式源码', () => {
    expect(parseInline('**$x^2$**')).toEqual([
      { ...plain('x^2'), bold: true, math: true },
    ])
  })

  it('转义美元符号与未闭合美元符号都保持普通文字', () => {
    expect(parseInline('价格：\\$5')).toEqual([plain('价格：$5')])
    expect(parseInline('未闭合 $x')).toEqual([plain('未闭合 $x')])
  })

  it('跟随 Obsidian 的边界规则：内侧空格和价格串不误判成公式', () => {
    expect(parseInline('公式 $ x $')).toEqual([plain('公式 $ x $')])
    expect(parseInline('价格 $5 和 $10')).toEqual([plain('价格 $5 和 $10')])
    expect(parseInline('价格区间 $5-$10')).toEqual([plain('价格区间 $5-$10')])
    expect(parseInline('单价对比 $5/$10')).toEqual([plain('单价对比 $5/$10')])
  })

  it('同一节点里公式后接价格时，只渲染真正的公式', () => {
    const segments = parseInline(String.raw`温度 $T_1=273.15\,\mathrm{K}$，价格 $5 和 $10`)
    expect(segments.filter((segment) => segment.math).map((segment) => segment.text)).toEqual([
      String.raw`T_1=273.15\,\mathrm{K}`,
    ])
    expect(plainText(String.raw`温度 $T_1=273.15\,\mathrm{K}$，价格 $5 和 $10`)).toContain(
      '价格 $5 和 $10',
    )
  })

  it('`$$...$$` 不冒充行内公式', () => {
    expect(parseInline('$$x^2$$')).toEqual([plain('$$x^2$$')])
  })
})
