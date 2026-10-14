'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers');

test('KaTeX：行内 / 块级 / Shift 纯 LaTeX', () => {
    const page = load(`
        <p>令 <span class="katex" id="inline"><span class="katex-mathml"><math><semantics><mi>x</mi><annotation encoding="application/x-tex">x^2</annotation></semantics></math></span><span class="katex-html">x²</span></span></p>
        <div class="katex-display"><span class="katex" id="block"><span class="katex-mathml"><math><semantics><annotation encoding="application/x-tex">\\sum_i a_i</annotation></semantics></math></span><span class="katex-html">Σ</span></span></div>`);

    assert.deepEqual(page.dblclick('#inline .katex-html'), { copied: '$x^2$', prevented: true });
    assert.equal(page.dblclick('#block .katex-html').copied, '$$\n\\sum_i a_i\n$$');
    assert.equal(page.dblclick('#inline .katex-html', { shiftKey: true }).copied, 'x^2');
});

test('MathJax 2：嵌套很深也能找到对应的 script，且不会拿到相邻公式', () => {
    const page = load(`
        <p>
            <span class="MathJax" id="MathJax-Element-1-Frame"><span id="MathJax-Span-1">a</span></span><script type="math/tex" id="MathJax-Element-1">a_1</script>
            <span class="MathJax" id="MathJax-Element-2-Frame"><span id="MathJax-Span-2"><span><span><span><span><span><span><span id="deep">b</span></span></span></span></span></span></span></span></span><script type="math/tex" id="MathJax-Element-2">b_2</script>
        </p>`);

    assert.equal(page.dblclick('#MathJax-Span-1').copied, '$a_1$');
    assert.equal(page.dblclick('#deep').copied, '$b_2$');
});

test('MathJax 3：通过页面 MathJax 对象读取原始公式', () => {
    const page = load(`<p>由 <mjx-container class="MathJax" jax="CHTML" id="c"><mjx-math><mjx-mi id="glyph">y</mjx-mi></mjx-math></mjx-container> 可知</p>`, {
        mathJax: { startup: { document: { math: [] } } },
    });
    page.window.MathJax.startup.document.math.push({ typesetRoot: page.document.getElementById('c'), math: '\\frac{1}{y}' });

    assert.equal(page.dblclick('#glyph').copied, '$\\frac{1}{y}$');
});

test('Wikipedia：原生 MathML 与 SVG 图片模式都去掉 {\\displaystyle ...}', () => {
    const page = load(`
        <span class="mwe-math-element" id="mathml"><math><semantics><mi id="mi">x</mi><annotation encoding="application/x-tex">{\\displaystyle x^{2}}</annotation></semantics></math></span>
        <span class="mwe-math-element"><img class="mwe-math-fallback-image-inline" id="img" alt="{\\displaystyle {a}+{b}}"></span>`);

    assert.equal(page.dblclick('#mi').copied, '$x^{2}$');
    assert.equal(page.dblclick('#img').copied, '${a}+{b}$');
});

test('Wikipedia 包装：外层括号不配对时不剥', () => {
    const page = load(`<span class="mwe-math-element"><img class="mwe-math-fallback-image-inline" id="img" alt="{\\displaystyle a}+{b}"></span>`);
    assert.equal(page.dblclick('#img', { shiftKey: true }).copied, '{\\displaystyle a}+{b}');
});

test('知乎：行内公式按行内复制，独占段落或以 \\\\ 结尾的按块级复制', () => {
    const page = load(`
        <p>令 <span class="ztext-math" data-tex="a^2" id="inline">a²</span> 为</p>
        <p><span class="ztext-math" data-tex="\\int f\\\\" id="trailing">∫f</span> 见上</p>
        <p><span class="ztext-math" data-tex="E=mc^2" id="alone">E=mc²</span></p>`);

    assert.equal(page.dblclick('#inline').copied, '$a^2$');
    assert.equal(page.dblclick('#trailing').copied, '$$\n\\int f\n$$');
    assert.equal(page.dblclick('#alone').copied, '$$\nE=mc^2\n$$');
});

test('正文定界符公式：光标落在公式上才复制', () => {
    const page = load(`<p id="p">Some <em id="word">word</em> here, and later $x_1+y^2$ and \\(\\alpha\\).</p>`);

    assert.equal(page.dblclick('#p', { caret: { text: 'x_1', offset: 1 } }).copied, '$x_1+y^2$');
    assert.equal(page.dblclick('#p', { caret: { text: '\\alpha' } }).copied, '$\\alpha$');
    assert.deepEqual(page.dblclick('#word', { caret: { text: 'word', offset: 1 } }), { copied: null, prevented: false });
});

test('普通文字不被接管：title / aria-label、代码块、可编辑区', () => {
    const page = load(`
        <a title="my_script.py" href="#" id="link">my_script.py</a>
        <section aria-label="Comment by john_doe"><p><b id="comment">hello</b> world</p></section>
        <div><pre><code id="code">echo $FOO_BAR $BAZ</code></pre></div>
        <div contenteditable="true"><div id="editor">Let $x_1$ be the theorem.</div></div>
        <div><textarea id="textarea">$a_1$</textarea></div>`);

    const untouched = { copied: null, prevented: false };
    assert.deepEqual(page.dblclick('#link'), untouched);
    assert.deepEqual(page.dblclick('#comment'), untouched);
    assert.deepEqual(page.dblclick('#code', { caret: { text: 'FOO_BAR', offset: 2 } }), untouched);
    assert.deepEqual(page.dblclick('#editor', { caret: { text: 'x_1' } }), untouched);
    assert.deepEqual(page.dblclick('#textarea'), untouched);
});

test('data-tex / data-latex 属性', () => {
    const page = load(`<p>见 <span data-latex="\\(\\beta\\)" id="b">β</span></p>`);
    assert.equal(page.dblclick('#b').copied, '$\\beta$');
});

test('后加入页面的公式节点（包括节点本身）会被标记', async () => {
    const page = load('<p id="p"></p>');
    // 等初始扫描（DOMContentLoaded）完成后再插入，确保走的是 MutationObserver。
    await new Promise(resolve => setTimeout(resolve, 0));

    const katex = page.document.createElement('span');
    katex.className = 'katex';
    page.document.getElementById('p').appendChild(katex);
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.ok(katex.classList.contains('umlc-copyable'));
});
