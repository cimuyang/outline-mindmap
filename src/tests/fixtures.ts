/**
 * 幂等性测试用的 fixture 集合。覆盖 操作手册.md M1 列出的全部场景。
 *
 * `canonical: true` 表示这份文本已经是序列化器的规范输出形态
 * （Tab 缩进、`-` 标记、`# ` 单空格、无尾部闭合 #），
 * 因此可以额外断言「用 serializeNode 重写标题行后逐字节不变」。
 */

export interface Fixture {
  name: string
  md: string
  canonical: boolean
}

export const FIXTURES: Fixture[] = [
  { name: '空文件', md: '', canonical: true },

  { name: '纯正文无标题', md: '这是一段正文。\n\n还有一段。\n', canonical: true },

  { name: '单 H1', md: '# 根\n', canonical: true },

  { name: '多 H1', md: '# 甲\n\n# 乙\n\n# 丙\n', canonical: true },

  {
    name: 'H1–H6 全层级',
    md: '# 一\n## 二\n### 三\n#### 四\n##### 五\n###### 六\n',
    canonical: true,
  },

  {
    name: 'H6 下带列表（第 7 层及以后）',
    md: '# 一\n## 二\n### 三\n#### 四\n##### 五\n###### 六\n- 七\n\t- 八\n\t\t- 九\n',
    canonical: true,
  },

  {
    name: 'H3 下直接带列表',
    md: '### 三\n- 甲\n\t- 乙\n### 另一个三\n',
    canonical: true,
  },

  {
    name: '列表嵌套 5 层',
    md: '# 根\n- 1\n\t- 2\n\t\t- 3\n\t\t\t- 4\n\t\t\t\t- 5\n',
    canonical: true,
  },

  {
    name: '代码围栏内含 # 与 -',
    md: '# 根\n\n```md\n# 这不是标题\n- 这不是列表\n## 也不是\n```\n\n## 真的二级\n',
    canonical: true,
  },

  {
    name: '波浪围栏 + 围栏内围栏',
    md: '# 根\n\n~~~\n```\n# 假标题\n```\n~~~\n\n## 二\n',
    canonical: true,
  },

  {
    name: 'frontmatter',
    md: '---\ntitle: 测试\ntags:\n  - a\n---\n\n# 根\n\n## 子\n',
    canonical: true,
  },

  {
    name: '标题下带正文和引用块',
    md: '# 根\n\n一段正文。\n\n> 引用第一行\n> 引用第二行\n\n## 子\n\n更多正文。\n',
    canonical: true,
  },

  {
    name: '混合空格与 Tab 缩进',
    md: '### 三\n- 甲\n    - 乙\n\t- 丙\n        - 丁\n',
    canonical: false,
  },

  {
    name: '列表中间夹正文（模式终止）',
    md: '# 根\n\n- 甲\n- 乙\n\n这是一段正文，列表节点模式在此终止。\n\n- 丙不再是节点\n- 丁也不是\n',
    canonical: true,
  },

  {
    name: 'CRLF 换行',
    md: '# 根\r\n\r\n## 子一\r\n\r\n## 子二\r\n',
    canonical: true,
  },

  {
    name: '非规范写法（* 标记 / 尾部 # / 多空格）',
    md: '#  根 ##\n* 甲\n+ 乙\n',
    canonical: false,
  },

  {
    name: '标题层级跳跃',
    md: '# 一\n### 三\n#### 四\n## 二\n',
    canonical: true,
  },

  {
    name: '文件开头就是列表',
    md: '- 甲\n\t- 乙\n\n# 后面的标题\n',
    canonical: true,
  },

  {
    name: '列表项多行续行',
    md: '# 根\n- 甲\n  续行属于甲的正文\n- 乙\n',
    canonical: true,
  },

  {
    name: '严格换行已就位（3 空行）',
    md: '# 一\n\n\n\n# 二\n\n\n\n# 三\n',
    canonical: true,
  },

  {
    name: '无尾随换行',
    md: '# 一\n## 二',
    canonical: true,
  },
]
