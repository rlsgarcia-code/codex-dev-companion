import assert from "node:assert/strict";
import test from "node:test";
import { renderSafeMarkdown } from "../src/safe-markdown";

test("preserves the first line of unlabeled and unclosed code fences", () => {
  assert.equal(
    renderSafeMarkdown("```\nconst first = true;\nsecond();\n```"),
    "<pre><code>const first = true;\nsecond();</code></pre>"
  );
  assert.equal(
    renderSafeMarkdown("```\nfirst line\nsecond line"),
    "<pre><code>first line\nsecond line</code></pre>"
  );
});

test("renders labeled code, headings, lists, quotes, emphasis, and inline code", () => {
  const html = renderSafeMarkdown(`# Result

- **passed**
- use \`npm test\`

1. inspect
2. verify

> local only

\`\`\`ts
const value: string = "ok";
\`\`\``);
  assert.match(html, /<h3>Result<\/h3>/);
  assert.match(html, /<ul><li><strong>passed<\/strong><\/li><li>use <code>npm test<\/code><\/li><\/ul>/);
  assert.match(html, /<ol><li>inspect<\/li><li>verify<\/li><\/ol>/);
  assert.match(html, /<blockquote>local only<\/blockquote>/);
  assert.match(html, /<pre><code class="language-ts">const value: string = &quot;ok&quot;;<\/code><\/pre>/);
});

test("escapes HTML and leaves link syntax inert", () => {
  const html = renderSafeMarkdown(`<img src=x onerror=alert(1)>
[external](javascript:alert(1))
\`<script>bad()</script>\``);
  assert.doesNotMatch(html, /<img|<script|href=/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /\[external\]\(javascript:alert\(1\)\)/);
  assert.match(html, /<code>&lt;script&gt;bad\(\)&lt;\/script&gt;<\/code>/);
});

test("removes control characters without removing readable content", () => {
  assert.equal(renderSafeMarkdown("safe\u0000 text\nnext"), "<p>safe text<br>next</p>");
});
