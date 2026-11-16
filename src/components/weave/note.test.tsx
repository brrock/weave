import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "./note";

test("note markdown: headings, lists, inline marks and safe links only", () => {
  const html = renderToStaticMarkup(
    <Markdown text={"# Title\n- **bold** and *it*\n- `code`\n\n[ok](https://a.dev) [bad](javascript:alert(1))"} />,
  );
  expect(html).toContain('<p class="font-semibold text-base">Title</p>');
  expect(html).toContain("<ul");
  expect(html).toContain("<li><strong>bold</strong> and <em>it</em></li>");
  expect(html).toContain(">code</code>");
  expect(html).toContain('href="https://a.dev"');
  expect(html).not.toContain("javascript:");
});
