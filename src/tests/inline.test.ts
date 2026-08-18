import { describe, expect, it } from 'vitest'
import { escapeHtml, parseInline, plainText, renderInline } from '../view/inline'

describe('parseInline', () => {
  it('纯文字只有一段，且不带任何样式', () => {
    expect(parseInline('普通标题')).toEqual([
      { text: '普通标题', bold: false, italic: false, highlight: false, strike: false },
    ])
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
    expect(seg).toEqual({
      text: '粗斜高亮',
      bold: true,
      italic: true,
      highlight: true,
      strike: false,
    })
  })

  it('四种样式全叠加', () => {
    const [seg] = parseInline('**~~==*全*==~~**')
    expect(seg).toEqual({
      text: '全',
      bold: true,
      italic: true,
      highlight: true,
      strike: true,
    })
  })

  it('部分加粗时切成多段，未加粗的部分保持原样', () => {
    expect(parseInline('前**中**后')).toEqual([
      { text: '前', bold: false, italic: false, highlight: false, strike: false },
      { text: '中', bold: true, italic: false, highlight: false, strike: false },
      { text: '后', bold: false, italic: false, highlight: false, strike: false },
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

describe('renderInline', () => {
  it('生成嵌套标签，内层在里外层在外', () => {
    expect(renderInline('***==粗斜高亮==***')).toBe(
      '<strong><em><mark>粗斜高亮</mark></em></strong>',
    )
  })

  it('分段渲染', () => {
    expect(renderInline('前**中**后')).toBe('前<strong>中</strong>后')
  })

  it('陷阱 13：HTML 必须转义，笔记里的 script 不能被执行', () => {
    expect(renderInline('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    )
    expect(renderInline('a & b')).toBe('a &amp; b')
    expect(renderInline('**<img src=x onerror="y">**')).toBe(
      '<strong>&lt;img src=x onerror=&quot;y&quot;&gt;</strong>',
    )
  })

  it('转义发生在样式包裹之前，标签本身不会被转义掉', () => {
    expect(renderInline('==<b>==')).toBe('<mark>&lt;b&gt;</mark>')
  })

  it('escapeHtml 覆盖 & < > "', () => {
    expect(escapeHtml('&<>"')).toBe('&amp;&lt;&gt;&quot;')
  })

  it('空文本渲染成空串', () => {
    expect(renderInline('')).toBe('')
  })
})
