import { describe, expect, it } from 'vitest';
import { markdown } from './markdown';

describe('markdown', () => {
	it('paragraphs, lists, code', () => {
		expect(
			markdown('Kanal **6** je zauzet.\n\n- AP `Dnevni`\n- AP Hodnik\n\n```\nuptime\n```')
		).toBe(
			'<p>Kanal <strong>6</strong> je zauzet.</p><ul><li>AP <code>Dnevni</code></li><li>AP Hodnik</li></ul><pre><code>uptime</code></pre>'
		);
	});

	it('numbered lists and headings', () => {
		expect(markdown('## Nalaz\n1. prvo\n2. drugo')).toBe(
			'<p><strong>Nalaz</strong></p><ol><li>prvo</li><li>drugo</li></ol>'
		);
	});

	it('never lets HTML through, also from a log line', () => {
		const html = markdown(
			'log: <img src=x onerror=alert(1)> and `<script>alert(1)</script>`\n```\n<b>x</b>\n```'
		);
		expect(html).not.toMatch(/<img|<script|<b>/);
		expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
	});

	it('keeps line breaks inside a paragraph', () => {
		expect(markdown('a\nb')).toBe('<p>a<br>b</p>');
	});
});
