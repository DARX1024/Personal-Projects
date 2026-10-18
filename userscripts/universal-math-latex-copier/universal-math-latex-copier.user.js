// ==UserScript==
// @name         Universal Math LaTeX Copier
// @namespace    https://github.com/DARX1024/Personal-Projects
// @version      2.3.1
// @description  在大多数网站上双击公式复制 LaTeX；普通双击复制为 Markdown 数学格式，Shift+双击复制纯 LaTeX
// @author       DARX1024
// @match        *://*/*
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @run-at       document-end
// @downloadURL  https://raw.githubusercontent.com/DARX1024/Personal-Projects/main/userscripts/universal-math-latex-copier/universal-math-latex-copier.user.js
// @updateURL    https://raw.githubusercontent.com/DARX1024/Personal-Projects/main/userscripts/universal-math-latex-copier/universal-math-latex-copier.user.js
// ==/UserScript==

(function () {
    'use strict';

    const VERSION = '2.3.1';

    // 统一配置项，后续需要改交互或样式时，优先从这里调整。
    const CONFIG = {
        inlineWrapper: ['$', '$'],
        displayWrapper: ['$$\n', '\n$$'],
        toastDuration: 1400,
        enableHoverStyle: true,
        debug: false,
        maxTextMathContainerLength: 4000,
    };

    // 声明了 @grant 后脚本运行在沙箱里，页面上的 MathJax 等全局变量只能经 unsafeWindow 读取。
    const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    // 这些区域里的双击是正常选词 / 编辑，正文定界符兜底不能接管。
    const EDITABLE_OR_CODE_SELECTOR = 'pre, code, textarea, input, [contenteditable]:not([contenteditable="false"])';

    const DELIMITED_MATH_SOURCE = String.raw`\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$\$[\s\S]+?\$\$|\$(?!\$)(?:\\.|[^$\\\n])+\$`;
    const DELIMITED_MATH_REGEX = new RegExp(DELIMITED_MATH_SOURCE);
    const DELIMITED_MATH_GLOBAL_REGEX = new RegExp(DELIMITED_MATH_SOURCE, 'g');

    function log(...args) {
        if (CONFIG.debug) console.log('[Math Copier]', ...args);
    }

    function injectStyles() {
        // hover 样式按配置开关动态注入，避免配置项形同虚设。
        const hoverRule = CONFIG.enableHoverStyle
            ? `
        .umlc-copyable:hover {
            background: rgba(127,127,127,0.12);
        }`
            : '';

        GM_addStyle(`
        .umlc-copyable {
            cursor: copy !important;
            border-radius: 6px;
            transition: background-color 0.15s ease, outline-color 0.15s ease;
        }${hoverRule}
        .umlc-copied {
            background: rgba(90, 200, 120, 0.20) !important;
        }
        #umlc-toast {
            position: fixed;
            right: 20px;
            bottom: 20px;
            z-index: 2147483647;
            padding: 10px 14px;
            border-radius: 10px;
            font-size: 14px;
            line-height: 1.45;
            color: #fff;
            background: rgba(20,20,20,0.92);
            box-shadow: 0 6px 18px rgba(0,0,0,0.25);
            opacity: 0;
            transform: translateY(8px);
            transition: opacity .18s ease, transform .18s ease;
            pointer-events: none;
            max-width: 420px;
            white-space: pre-wrap;
            word-break: break-word;
        }
        #umlc-toast.show {
            opacity: 1;
            transform: translateY(0);
        }
    `);
    }

    function createToast() {
        let toast = document.getElementById('umlc-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'umlc-toast';
            document.body.appendChild(toast);
        }
        return toast;
    }

    let toastTimer = null;

    function showToast(text) {
        const toast = createToast();
        toast.textContent = text;
        toast.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            toast.classList.remove('show');
        }, CONFIG.toastDuration);
    }

    function normalizeLatex(text) {
        if (!text) return '';

        // 统一空白字符和换行，减少不同网站渲染器带来的格式噪音。
        return text
            .replace(/\u00a0/g, ' ')
            .replace(/\r\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    function looksLikeLatex(text) {
        if (!text) return false;

        // 只对“有明显 LaTeX 特征”的文本兜底，避免把普通可见公式文本误判成源码。
        return /\\[a-zA-Z]+|\\.|[_^{}]/.test(text);
    }

    function copyText(text) {
        try {
            GM_setClipboard(text, 'text');
            return true;
        } catch (e) {
            log('GM_setClipboard failed', e);
            return false;
        }
    }

    function flash(el) {
        el.classList.add('umlc-copied');
        setTimeout(() => el.classList.remove('umlc-copied'), 180);
    }

    function wrapLatex(latex, displayMode, rawOnly) {
        if (rawOnly) return latex;
        if (displayMode) return `${CONFIG.displayWrapper[0]}${latex}${CONFIG.displayWrapper[1]}`;
        return `${CONFIG.inlineWrapper[0]}${latex}${CONFIG.inlineWrapper[1]}`;
    }

    function isProbablyBlock(el) {
        if (!el) return false;

        // 先用常见数学渲染器的结构特征判断，再退回 CSS display 判断。
        if (
            el.classList.contains('math-display') ||
            el.classList.contains('katex-display') ||
            el.closest('.math-display, .katex-display, mjx-container[display="true"]')
        ) {
            return true;
        }

        const display = getComputedStyle(el).display;
        return display === 'block' || display === 'flex';
    }

    function firstNonEmpty(...values) {
        for (const value of values) {
            if (typeof value === 'string' && value.trim()) return value.trim();
        }
        return '';
    }

    function getAttributeLatex(root, includeAccessibleText = false) {
        const values = [
            root.getAttribute('data-tex'),
            root.getAttribute('data-latex'),
            root.getAttribute('alt'),
        ];

        if (includeAccessibleText) {
            // aria-label / title 常是朗读文本或普通提示，只有带明显 LaTeX 特征时才采用。
            values.push(
                ...[root.getAttribute('aria-label'), root.getAttribute('title')]
                    .filter(value => looksLikeLatex(value))
            );
        }

        return firstNonEmpty(...values);
    }

    function stripMathDelimiters(text) {
        const clean = normalizeLatex(text);

        // 去掉公式两端常见的包裹符，避免某些站点把 `$...$` 原样塞进属性里。
        if (/^\$\$[\s\S]*\$\$$/.test(clean)) {
            return clean.replace(/^\$\$\s*|\s*\$\$$/g, '').trim();
        }

        if (/^\$[\s\S]*\$$/.test(clean)) {
            return clean.replace(/^\$\s*|\s*\$$/g, '').trim();
        }

        if (/^\\\([\s\S]*\\\)$/.test(clean)) {
            return clean.replace(/^\\\(\s*|\s*\\\)$/g, '').trim();
        }

        if (/^\\\[[\s\S]*\\\]$/.test(clean)) {
            return clean.replace(/^\\\[\s*|\s*\\\]$/g, '').trim();
        }

        return clean;
    }

    // 返回 text[0] 处的 `{` 对应的 `}` 位置，跳过 `\{` `\}` 转义；不配对时返回 -1。
    function matchingBraceIndex(text) {
        let depth = 0;
        for (let i = 0; i < text.length; i += 1) {
            const char = text[i];
            if (char === '\\') {
                i += 1;
            } else if (char === '{') {
                depth += 1;
            } else if (char === '}') {
                depth -= 1;
                if (depth === 0) return i;
            }
        }
        return -1;
    }

    function stripWikipediaPresentationWrapper(text) {
        const clean = normalizeLatex(text);
        const match = clean.match(/^\{\\(?:displaystyle|textstyle|scriptstyle|scriptscriptstyle)\s+([\s\S]+)\}$/);

        // 只有外层 `{` 一直包到结尾时才是包装，避免把 `{\displaystyle a}+{b}` 剥成不配对的 `a}+{b`。
        if (!match || matchingBraceIndex(clean) !== clean.length - 1) return clean;
        return match[1].trim();
    }

    function findClosestMatchInChain(root, predicate, maxDepth = 6) {
        let current = root;
        let depth = 0;

        while (current && depth <= maxDepth) {
            if (predicate(current)) return current;
            current = current.parentElement;
            depth += 1;
        }

        return null;
    }

    function isMathScript(node) {
        return node?.tagName === 'SCRIPT' && /^math\/tex/i.test(node.type);
    }

    function findNearbyMathScript(root, maxDepth = 6) {
        const start = findClosestMatchInChain(root, node => node instanceof Element, maxDepth);
        if (!start) return null;

        // 只在起点自身内部找后代 script；祖先的后代里可能是同段落的其他公式。
        const descendant = start.querySelector?.('script[type^="math/tex"]');
        if (descendant) return descendant;

        let current = start;
        let depth = 0;

        while (current && depth <= maxDepth) {
            if (isMathScript(current)) return current;

            // MathJax 2 的 script 紧跟在渲染容器（或 MathJax_Display 外层）后面。
            for (const sibling of [current.nextElementSibling, current.previousElementSibling]) {
                if (isMathScript(sibling)) return sibling;
            }

            current = current.parentElement;
            depth += 1;
        }

        return null;
    }

    function getMathJaxSourceScript(root) {
        if (!root) return null;
        if (isMathScript(root)) return root;

        // MathJax 2 渲染容器 id 为 `MathJax-Element-N-Frame`，原始 script 的 id 去掉 `-Frame`。
        // 用 closest 直接找到外层容器，公式嵌套再深也不受遍历层数限制。
        const frame = root.closest?.('[id^="MathJax-Element-"][id$="-Frame"]');
        if (frame) {
            const source = document.getElementById(frame.id.slice(0, -6));
            if (isMathScript(source)) return source;
        }

        return findNearbyMathScript(root);
    }

    function getMathJaxOriginalText(root) {
        const sourceScript = getMathJaxSourceScript(root);
        if (sourceScript?.textContent?.trim()) {
            return sourceScript.textContent;
        }

        const mathJax = pageWindow.MathJax;

        // MathJax 2 的 element jax 上直接带 originalText。
        if (mathJax?.Hub?.getJaxFor && root) {
            const frame = root.closest?.('[id^="MathJax-Element-"][id$="-Frame"]');
            const candidates = [frame, root].filter(Boolean);

            for (const candidate of candidates) {
                try {
                    const jax = mathJax.Hub.getJaxFor(candidate);
                    if (jax?.originalText?.trim()) {
                        return jax.originalText;
                    }
                } catch (error) {
                    log('MathJax getJaxFor failed', error);
                }
            }
        }

        // MathJax 3/4：math item 的 typesetRoot 就是页面上的 mjx-container。
        const mathDocument = mathJax?.startup?.document;
        if (mathDocument && root) {
            const container = root.closest?.('mjx-container') || root;

            try {
                for (const item of mathDocument.math || []) {
                    if (item?.typesetRoot === container && typeof item.math === 'string' && item.math.trim()) {
                        return item.math;
                    }
                }
            } catch (error) {
                log('MathJax math list failed', error);
            }

            try {
                const items = mathDocument.getMathItemsWithin?.(container);
                const item = items?.find?.(entry => typeof entry?.math === 'string' && entry.math.trim());
                if (item?.math) {
                    return item.math;
                }
            } catch (error) {
                log('MathJax getMathItemsWithin failed', error);
            }
        }

        return '';
    }

    function getEventCaretPosition(event) {
        if (document.caretRangeFromPoint) {
            const range = document.caretRangeFromPoint(event.clientX, event.clientY);
            if (range) {
                return {
                    node: range.startContainer,
                    offset: range.startOffset
                };
            }
        }

        if (document.caretPositionFromPoint) {
            const position = document.caretPositionFromPoint(event.clientX, event.clientY);
            if (position) {
                return {
                    node: position.offsetNode,
                    offset: position.offset
                };
            }
        }

        return { node: null, offset: 0 };
    }

    function getTextOffsetWithin(root, node, offset) {
        if (!root || !node) return -1;
        if (root !== node && !root.contains(node)) return -1;

        try {
            const range = document.createRange();
            range.selectNodeContents(root);
            range.setEnd(node, offset);
            return range.toString().length;
        } catch (error) {
            log('Failed to compute text offset', error);
            return -1;
        }
    }

    function findNearestTextMathContainer(target) {
        if (target.closest(EDITABLE_OR_CODE_SELECTOR)) return null;

        let current = target;

        while (current && current !== document.body) {
            if (/^(SCRIPT|STYLE|SVG|CANVAS)$/i.test(current.tagName)) return null;
            if (current.closest('.katex, .katex-display, mjx-container, .MathJax, .MathJax_Display, math, .math-holder, .ztext-math, .mwe-math-element')) return null;

            const text = current.textContent || '';

            // 祖先的文本只会更长，超过上限后不必再往上算。
            if (text.length > CONFIG.maxTextMathContainerLength) return null;
            if (DELIMITED_MATH_REGEX.test(text)) return current;

            current = current.parentElement;
        }

        return null;
    }

    // 只返回光标所在的那个公式；allowSingleFallback 时，若文本里恰好只有一个公式，
    // 光标不在公式上也返回它（用于本身就是公式容器的节点）。
    function extractDelimitedMath(text, cursorOffset, allowSingleFallback = false) {
        if (!text) return null;

        const matches = [];
        for (const match of text.matchAll(DELIMITED_MATH_GLOBAL_REGEX)) {
            const value = match[0];
            const start = match.index ?? -1;
            if (start < 0) continue;

            const latex = stripMathDelimiters(value);
            if (!latex || !looksLikeLatex(latex)) continue;

            matches.push({
                latex,
                display: value.startsWith('$$') || value.startsWith('\\['),
                start,
                end: start + value.length
            });
        }

        const toResult = match => ({ latex: match.latex, display: match.display });

        if (typeof cursorOffset === 'number' && cursorOffset >= 0) {
            const containing = matches.find(match => cursorOffset >= match.start && cursorOffset <= match.end);
            if (containing) return toResult(containing);
        }

        return allowSingleFallback && matches.length === 1 ? toResult(matches[0]) : null;
    }

    // 知乎行内、块级公式都用 .ztext-math；块级公式的 data-tex 通常以 `\\` 结尾，
    // 或者公式独占一个段落。
    function isZhihuDisplayMath(root, latex) {
        if (/\\\\\s*$/.test(root.getAttribute('data-tex') || latex || '')) return true;

        const block = root.parentElement?.closest('p, div, figure, li');
        return !!block && block.textContent.trim() === root.textContent.trim();
    }

    function stripTrailingLineBreak(latex) {
        return latex.replace(/\s*\\\\\s*$/, '');
    }

    function extractLatexFromMarkedRoot(root, event) {
        if (!root) return null;

        const annotationLatex = root.querySelector('annotation[encoding="application/x-tex"], math annotation')?.textContent || '';
        const descendantScript = root.querySelector('script[type^="math/tex"]')?.textContent || '';
        const descendantImageAlt = root.querySelector('img[alt]')?.getAttribute('alt') || '';
        const mathJaxLatex = getMathJaxOriginalText(root);
        const structuredLatex = firstNonEmpty(
            mathJaxLatex,
            annotationLatex,
            descendantScript,
            getAttributeLatex(root, true),
            descendantImageAlt
        );

        let delimitedText = null;
        if (!structuredLatex) {
            const { node, offset } = event ? getEventCaretPosition(event) : { node: null, offset: 0 };
            const cursorOffset = getTextOffsetWithin(root, node, offset);
            delimitedText = extractDelimitedMath(root.textContent || '', cursorOffset, true);
        }

        const latex = structuredLatex || delimitedText?.latex || '';
        if (!latex) return null;

        const isZhihu = root.classList.contains('ztext-math');
        const clean = stripWikipediaPresentationWrapper(stripMathDelimiters(latex));

        return {
            latex: isZhihu ? stripTrailingLineBreak(clean) : clean,
            display:
                delimitedText?.display ||
                root.classList.contains('MathJax_Display') ||
                root.classList.contains('MathJax_SVG_Display') ||
                root.classList.contains('MJXc-display') ||
                root.classList.contains('katex-display') ||
                (isZhihu && isZhihuDisplayMath(root, latex)) ||
                root.classList.contains('mwe-math-fallback-image-display') ||
                root.classList.contains('mwe-math-mathml-display') ||
                isProbablyBlock(root)
        };
    }

    // -------------------------
    // Adapter system
    // -------------------------
    // 不同网站使用的公式渲染器差异很大，所以用适配器模式逐个尝试。
    // 每个适配器只关心两件事：
    // 1. 是否命中了自己的 DOM 结构
    // 2. 如何从该结构中提取 LaTeX 和显示模式
    const adapters = [
        // 1) KaTeX
        {
            name: 'KaTeX',
            matchTarget(target) {
                return target.closest('.katex, .katex-display');
            },
            extract(root) {
                const ann = root.querySelector('.katex-mathml annotation')
                    || root.querySelector('annotation[encoding="application/x-tex"]')
                    || root.querySelector('math annotation');
                const latex = ann ? ann.textContent : '';

                return latex ? {
                    latex: normalizeLatex(latex),
                    display: !!root.closest('.katex-display') || root.classList.contains('katex-display') || isProbablyBlock(root)
                } : null;
            }
        },

        // 2) MathJax v3
        {
            name: 'MathJax v3',
            matchTarget(target) {
                return target.closest('mjx-container, .mjx-chtml, .mjx-svg');
            },
            extract(root) {
                const container = root.closest('mjx-container') || root;
                const displayAttr = container.getAttribute?.('display') === 'true';
                const assistive = container.querySelector('mjx-assistive-mml annotation')
                    || container.querySelector('mjx-assistive-mml math annotation')
                    || container.querySelector('annotation[encoding="application/x-tex"]');
                const latex = firstNonEmpty(
                    assistive ? assistive.textContent : '',
                    getMathJaxOriginalText(container)
                );

                return latex ? {
                    latex: normalizeLatex(latex),
                    display: displayAttr || isProbablyBlock(container)
                } : null;
            }
        },

        // 3) MathJax v2 常见结构
        {
            name: 'MathJax v2',
            matchTarget(target) {
                return target.closest('.MathJax, .MathJax_Display, .MathJax_SVG, .MathJax_SVG_Display, .MJXc-display, [id^="MathJax-Element-"], [id^="MathJax-Span-"], script[type^="math/tex"]');
            },
            extract(root) {
                if (root.tagName === 'SCRIPT' && /^math\/tex/i.test(root.type)) {
                    return {
                        latex: normalizeLatex(root.textContent || ''),
                        display: /mode=display/i.test(root.type)
                    };
                }

                let latex = '';
                let display = false;

                // MathJax v2 常把原始公式放在相邻的 script 标签里。
                const previewSiblingScript = getMathJaxSourceScript(root);

                if (previewSiblingScript) {
                    latex = previewSiblingScript.textContent || '';
                    display =
                        /mode=display/i.test(previewSiblingScript.type) ||
                        root.classList.contains('MathJax_Display') ||
                        root.classList.contains('MathJax_SVG_Display') ||
                        root.classList.contains('MJXc-display');
                }

                if (!latex) {
                    latex = getAttributeLatex(root, true);
                }

                if (!latex) {
                    latex = getMathJaxOriginalText(root);
                }

                if (!latex) return null;

                return {
                    latex: normalizeLatex(latex),
                    display:
                        display ||
                        root.classList.contains('MathJax_Display') ||
                        root.classList.contains('MathJax_SVG_Display') ||
                        root.classList.contains('MJXc-display') ||
                        isProbablyBlock(root)
                };
            }
        },

        // 4) Wikipedia 公式容器：要排在原生 MathML 前面，
        //    否则原生 MathML 渲染模式下会被 MathML 适配器抢先，复制出带 {\displaystyle ...} 的源码。
        {
            name: 'Wikipedia Math',
            matchTarget(target) {
                return target.closest('.mwe-math-element, .mwe-math-mathml-inline, .mwe-math-mathml-display, .mwe-math-fallback-image-inline, .mwe-math-fallback-image-display');
            },
            extract(root) {
                const container = root.closest('.mwe-math-element') || root;
                const annotationLatex = container.querySelector('annotation[encoding="application/x-tex"]')?.textContent || '';
                const fallbackLatex = firstNonEmpty(
                    container.querySelector('img[alt]')?.getAttribute('alt'),
                    container.getAttribute('alt'),
                    container.getAttribute('aria-label'),
                    container.getAttribute('data-tex')
                );
                const latex = firstNonEmpty(annotationLatex, fallbackLatex);

                if (!latex) return null;

                return {
                    latex: stripWikipediaPresentationWrapper(stripMathDelimiters(latex)),
                    display:
                        container.classList.contains('mwe-math-fallback-image-display') ||
                        container.classList.contains('mwe-math-mathml-display') ||
                        !!container.closest('.mwe-math-display') ||
                        !!container.querySelector('math[display="block"]') ||
                        isProbablyBlock(container)
                };
            }
        },

        // 5) 原生 MathML
        {
            name: 'MathML',
            matchTarget(target) {
                return target.closest('math');
            },
            extract(root) {
                const texAnnotation = root.querySelector('annotation[encoding="application/x-tex"]')?.textContent || '';
                const anyAnnotation = root.querySelector('annotation')?.textContent || '';
                const latex = firstNonEmpty(texAnnotation, looksLikeLatex(anyAnnotation) ? anyAnnotation : '');

                if (!latex) return null;

                return {
                    latex: stripWikipediaPresentationWrapper(latex),
                    display: root.getAttribute('display') === 'block' || isProbablyBlock(root)
                };
            }
        },

        // 6) 知乎
        {
            name: 'Zhihu',
            matchTarget(target) {
                return target.closest('.math-holder, .ztext-math');
            },
            extract(root) {
                // 知乎的容器里经常同时存在：
                // 1. 渲染后的可见文本
                // 2. 原始 LaTeX 属性
                // 3. 隐藏的重复节点
                // 直接读 textContent 很容易把这几份内容拼在一起，所以优先取结构化来源。
                const annotationLatex = root.querySelector('annotation[encoding="application/x-tex"], math annotation')?.textContent || '';
                const descendantAlt = root.querySelector('[alt]')?.getAttribute('alt') || '';
                const textFallback = looksLikeLatex(root.textContent) ? root.textContent : '';
                const latex = firstNonEmpty(
                    getAttributeLatex(root, true),
                    annotationLatex,
                    descendantAlt,
                    textFallback
                );

                if (!latex) return null;

                return {
                    latex: stripTrailingLineBreak(stripMathDelimiters(latex)),
                    display:
                        (root.classList.contains('ztext-math') && isZhihuDisplayMath(root, latex)) ||
                        isProbablyBlock(root)
                };
            }
        },

        // 7) 通用兜底：网站把公式源码放在 data-tex / data-latex 属性里。
        //    不读 aria-label / title：普通链接、按钮、带用户名的容器都会带这些属性。
        {
            name: 'Generic attributes fallback',
            matchTarget(target) {
                return target.closest('[data-tex], [data-latex]');
            },
            extract(root) {
                const latex = getAttributeLatex(root);
                if (!latex) return null;

                return {
                    latex: stripMathDelimiters(latex),
                    display: isProbablyBlock(root)
                };
            }
        },

        // 8) Markdown / 博客正文中的原始定界符公式：只有光标确实落在某个公式上才接管双击，
        //    其余位置保留浏览器原生的双击选词。
        {
            name: 'Delimited text math',
            matchTarget(target, event) {
                if (!event) return null;

                const textContainer = target.closest('.arithmatex, .MathJax_Preview');
                if (textContainer) return textContainer;

                return findNearestTextMathContainer(target);
            },
            extract(root, target, event) {
                const { node, offset } = getEventCaretPosition(event);
                const cursorOffset = getTextOffsetWithin(root, node, offset);
                const isMathContainer = root.matches('.arithmatex, .MathJax_Preview');

                return extractDelimitedMath(root.textContent || '', cursorOffset, isMathContainer);
            }
        },

        // 9) 通用已标记节点兜底：如果一个节点已经被扫描阶段认定为“像公式”，
        // 但专用适配器没提取成功，则在这里统一尝试再抽取一次源码。
        {
            name: 'Marked root fallback',
            matchTarget(target) {
                return target.closest('.umlc-copyable');
            },
            extract(root, target, event) {
                return extractLatexFromMarkedRoot(root, event);
            }
        }
    ];

    function detectMathTarget(target, event) {
        for (const adapter of adapters) {
            const root = adapter.matchTarget(target, event);
            if (!root) continue;

            const result = adapter.extract(root, target, event);
            if (result && result.latex) {
                return {
                    root,
                    latex: result.latex,
                    display: !!result.display,
                    adapter: adapter.name
                };
            }
        }

        return null;
    }

    function markCopyable(root) {
        if (!(root instanceof Element)) return;
        if (root.classList.contains('umlc-copyable')) return;

        root.classList.add('umlc-copyable');
    }

    // 主动扫描常见数学节点，给它们打上可复制标记（hover 样式 + 兜底适配器）。
    const MATH_NODE_SELECTOR = [
        '.katex',
        '.katex-display',
        'mjx-container',
        '.mjx-chtml',
        '.mjx-svg',
        '.MathJax',
        '.MathJax_Display',
        '.MathJax_Preview',
        '.MathJax_SVG',
        '.MathJax_SVG_Display',
        '.MJXc-display',
        '.arithmatex',
        'math',
        '.math-holder',
        '.ztext-math',
        '.mwe-math-element',
        '.mwe-math-mathml-inline',
        '.mwe-math-mathml-display',
        '.mwe-math-fallback-image-inline',
        '.mwe-math-fallback-image-display',
        '[data-tex]',
        '[data-latex]',
        'script[type^="math/tex"]'
    ].join(', ');

    function scan(root = document) {
        if (root instanceof Element && root.matches(MATH_NODE_SELECTOR)) {
            markCopyable(root);
        }
        root.querySelectorAll?.(MATH_NODE_SELECTOR).forEach(markCopyable);
    }

    document.addEventListener('dblclick', (event) => {
        const rawTarget = event.target;
        const target = rawTarget instanceof Element
            ? rawTarget
            : rawTarget instanceof Node
                ? rawTarget.parentElement
                : null;

        // 博客正文中的公式经常只是普通文本节点，双击时 target 可能不是 Element。
        // 这里统一提升到父元素，避免正文公式适配器根本拿不到机会。
        if (!(target instanceof Element)) return;

        const info = detectMathTarget(target, event);
        if (!info) {
            if (target.closest('.umlc-copyable')) {
                log('No LaTeX extracted from marked target', target);
            }
            return;
        }

        // 公式命中后拦截原页面的双击逻辑，避免触发站点自带的双击事件。
        event.preventDefault();
        event.stopPropagation();

        // 双击选词在 mousedown 阶段就已发生，preventDefault 拦不住，这里手动清掉公式里的零碎选区。
        window.getSelection()?.removeAllRanges();

        const rawOnly = event.shiftKey;
        const text = wrapLatex(info.latex, info.display, rawOnly);

        if (copyText(text)) {
            markCopyable(info.root);
            flash(info.root);
            showToast(
                rawOnly
                    ? `已复制纯 LaTeX\n[${info.adapter}]`
                    : info.display
                        ? `已复制块级公式 $$...$$\n[${info.adapter}]`
                        : `已复制行内公式 $...$\n[${info.adapter}]`
            );
            log('Copied by adapter:', info.adapter, info);
        } else {
            showToast('复制失败');
        }
    }, true);

    // 页面后续如果懒加载出新的公式节点，继续自动补标记。
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (!(node instanceof Element)) continue;
                scan(node);
            }
        }
    });

    function init() {
        injectStyles();
        scan(document);

        if (document.body) {
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        }

        log('initialized', VERSION);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
