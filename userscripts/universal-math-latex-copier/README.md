# Universal Math LaTeX Copier

Tampermonkey 用户脚本：在大多数网站上**双击公式复制 LaTeX 源码**。

- 普通双击：复制为 Markdown 数学格式（行内 `$...$`，块级 `$$...$$`）
- Shift + 双击：复制纯 LaTeX，不带定界符

## 支持的公式来源

| 来源 | 取源码方式 |
| --- | --- |
| KaTeX | `.katex-mathml` 中的 TeX annotation |
| MathJax 3 / 4 | assistive MathML 的 annotation，或页面 `MathJax` 对象中的原始公式 |
| MathJax 2 | 相邻的 `<script type="math/tex">`，或 `MathJax.Hub` |
| 原生 MathML | `<annotation encoding="application/x-tex">` |
| 知乎 | `data-tex` 属性 |
| Wikipedia | TeX annotation 或图片 `alt`，并去掉外层 `{\displaystyle ...}` |
| 其他 | `data-tex` / `data-latex` 属性；正文中未渲染的 `$...$`、`\(...\)` 等定界符公式 |

正文里未渲染的定界符公式，只有双击位置**落在公式上**才会复制；代码块、输入框和可编辑区（如 Overleaf、各类编辑器）中不接管双击，普通选词不受影响。

## 安装

1. 浏览器安装 Tampermonkey（或 Violentmonkey）。
2. 打开 [universal-math-latex-copier.user.js 原始文件](https://raw.githubusercontent.com/DARX1024/Personal-Projects/main/userscripts/universal-math-latex-copier/universal-math-latex-copier.user.js)，脚本管理器会弹出安装页。

脚本通过 `@updateURL` 从本仓库 `main` 分支自动更新。

## 开发

```sh
npm install
npm test
```

测试用 Node 内置 `node:test` 和 jsdom，在模拟页面中双击各类公式节点，检查复制结果，以及普通文字、代码块、可编辑区不被接管。
