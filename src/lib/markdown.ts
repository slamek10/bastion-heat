/**
 * The little markdown the assistant writes: paragraphs, lists, `code`,
 * code blocks, **bold**, *italic*, and headings shown as bold lines.
 * Everything is escaped first, so text from logs or devices can never become
 * HTML; only the tags made here exist.
 */
const escape = (text: string) =>
	text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');

function inline(text: string) {
	return escape(text)
		.replace(/`([^`\n]+)`/g, '<code>$1</code>')
		.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
		.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
}

export function markdown(source: string) {
	const out: string[] = [];
	const lines = source.replace(/\r\n/g, '\n').split('\n');
	let list: 'ul' | 'ol' | undefined;
	let paragraph: string[] = [];

	const flushParagraph = () => {
		if (paragraph.length) out.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
		paragraph = [];
	};
	const closeList = () => {
		if (list) out.push(`</${list}>`);
		list = undefined;
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line.trimStart().startsWith('```')) {
			flushParagraph();
			closeList();
			const code: string[] = [];
			i++;
			while (i < lines.length && !lines[i].trimStart().startsWith('```')) code.push(lines[i++]);
			out.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`);
			continue;
		}
		const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
		const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
		if (bullet || numbered) {
			flushParagraph();
			const kind = bullet ? 'ul' : 'ol';
			if (list !== kind) {
				closeList();
				out.push(`<${kind}>`);
				list = kind;
			}
			out.push(`<li>${inline((bullet ?? numbered)![1])}</li>`);
			continue;
		}
		const heading = line.match(/^#{1,6}\s+(.*)$/);
		if (heading) {
			flushParagraph();
			closeList();
			out.push(`<p><strong>${inline(heading[1])}</strong></p>`);
			continue;
		}
		if (!line.trim()) {
			flushParagraph();
			closeList();
			continue;
		}
		closeList();
		paragraph.push(line);
	}
	flushParagraph();
	closeList();
	return out.join('');
}
