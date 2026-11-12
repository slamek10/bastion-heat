<script lang="ts">
	import { ago, now, t } from '$lib/stores';
	import { markdown } from '$lib/markdown';
	import type { Key } from '$lib/i18n';
	import ProposalCard from '$lib/components/ProposalCard.svelte';
	import Icon from '@iconify/svelte';
	import { onMount, tick } from 'svelte';
	import type { Proposal } from '$lib/types';

	type Item =
		| { kind: 'user'; text: string; at: number }
		| { kind: 'assistant'; text: string; at: number }
		| { kind: 'tool'; id: string; name: string; summary: string; ok?: boolean; at: number }
		| { kind: 'proposal'; proposal: Proposal; at: number }
		| { kind: 'note'; text: string; at: number }
		| { kind: 'error'; text: string; at: number };

	interface Summary {
		id: string;
		title: string;
		updated: number;
	}

	let conversations = $state<Summary[]>([]);
	let conversationId = $state<string | undefined>();
	let items = $state<Item[]>([]);
	let live = $state('');
	let thinking = $state('');
	let busy = $state(false);
	let input = $state('');
	let hasKey = $state(true);
	/** the subscription's use, as of the last answer */
	let limits = $state<{ used?: number; window?: string; status?: string } | undefined>();
	let engine = $state<'subscription' | 'api' | null>(null);
	async function loadStatus() {
		const response = await fetch('/_api/assistant/status').catch(() => undefined);
		if (!response?.ok) return;
		const body = await response.json();
		engine = body.engine;
		hasKey = !!body.engine;
		limits = body.limits;
	}
	let list: HTMLElement | undefined = $state();

	const examples = $derived($t('chat_examples').split('|'));

	async function loadList() {
		const response = await fetch('/_api/assistant/conversations').catch(() => undefined);
		if (response?.ok) conversations = await response.json();
	}

	/** every proposal's current status: a card answered earlier shows how it ended */
	let proposals = $state<Record<string, Proposal>>({});
	async function loadProposals() {
		const response = await fetch('/_api/assistant/proposals').catch(() => undefined);
		if (response?.ok)
			proposals = Object.fromEntries(
				((await response.json()) as Proposal[]).map((entry) => [entry.id, entry])
			);
	}

	onMount(() => {
		loadList();
		loadProposals();
		loadStatus();
	});

	async function open(id: string) {
		const response = await fetch(`/_api/assistant/conversations/${id}`).catch(() => undefined);
		if (!response?.ok) return;
		const body = await response.json();
		conversationId = id;
		items = body.display;
		await loadProposals();
		await scrollDown();
	}

	function fresh() {
		conversationId = undefined;
		items = [];
		live = '';
	}

	async function remove(id: string) {
		await fetch(`/_api/assistant/conversations/${id}`, { method: 'DELETE' }).catch(() => {});
		if (conversationId === id) fresh();
		await loadList();
	}

	async function scrollDown() {
		await tick();
		list?.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
	}

	/** a tool item updates in place: started, then ok / failed */
	function upsertTool(item: Extract<Item, { kind: 'tool' }>) {
		const index = items.findIndex((entry) => entry.kind === 'tool' && entry.id === item.id);
		if (index >= 0) items[index] = item;
		else items.push(item);
	}

	async function send(text = input) {
		const message = text.trim();
		if (!message || busy) return;
		input = '';
		busy = true;
		live = '';
		thinking = '';
		const response = await fetch('/_api/assistant', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ message, conversationId })
		}).catch(() => undefined);
		if (!response?.ok || !response.body) {
			items.push({ kind: 'error', text: String(response?.status ?? 'network'), at: Date.now() });
			busy = false;
			return;
		}
		const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
		let buffer = '';
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += value;
			let end;
			while ((end = buffer.indexOf('\n\n')) >= 0) {
				const frame = buffer.slice(0, end);
				buffer = buffer.slice(end + 2);
				if (!frame.startsWith('data: ')) continue;
				let event;
				try {
					event = JSON.parse(frame.slice(6));
				} catch {
					continue;
				}
				if (event.type === 'conversation') conversationId = event.id;
				else if (event.type === 'text') {
					live += event.text;
					thinking = '';
				} else if (event.type === 'thinking') thinking += event.text;
				else if (event.type === 'item') {
					const item = event.item as Item;
					if (item.kind === 'assistant') live = '';
					if (item.kind === 'tool') upsertTool(item);
					else items.push(item);
				} else if (event.type === 'error') {
					items.push({ kind: 'error', text: event.message, at: Date.now() });
					if (event.message === 'no_key') hasKey = false;
				}
				await scrollDown();
			}
		}
		live = '';
		thinking = '';
		busy = false;
		await loadList();
		await loadProposals();
		await loadStatus();
	}

	const ERRORS: Record<string, Key> = {
		no_key: 'chat_no_key',
		busy: 'chat_busy',
		refusal: 'chat_refusal',
		max_tokens: 'chat_cut',
		tools_down: 'chat_tools_down',
		limit: 'chat_limit',
		no_mcp_url: 'chat_no_mcp_url'
	};
	const errorText = (text: string) =>
		ERRORS[text] ? $t(ERRORS[text]) : $t('chat_error', { message: text });
</script>

<main class="page">
	<aside class="history w-card">
		<button class="w-pill primary new" onclick={fresh}>
			<Icon icon="mdi:plus" height="1rem" />{$t('chat_new')}
		</button>
		<h4>{$t('chat_history')}</h4>
		<ul>
			{#each conversations as entry (entry.id)}
				<li class:active={entry.id === conversationId}>
					<button class="title" onclick={() => open(entry.id)}>
						<span>{entry.title}</span>
						<small class="w-dim">{ago(entry.updated, $now)}</small>
					</button>
					<button class="delete" onclick={() => remove(entry.id)} aria-label={$t('chat_delete')}>
						<Icon icon="mdi:close" height="0.9rem" />
					</button>
				</li>
			{/each}
		</ul>
	</aside>

	<section class="chat w-card">
		<div class="mobile-bar">
			<select
				value={conversationId ?? ''}
				onchange={(event) =>
					event.currentTarget.value ? open(event.currentTarget.value) : fresh()}
			>
				<option value="">{$t('chat_new')}</option>
				{#each conversations as entry (entry.id)}
					<option value={entry.id}>{entry.title}</option>
				{/each}
			</select>
			<button class="w-pill small" onclick={fresh} aria-label={$t('chat_new')}>
				<Icon icon="mdi:plus" height="1rem" />
			</button>
		</div>
		<div class="messages" bind:this={list}>
			{#if !items.length && !busy}
				<div class="intro">
					<Icon icon="mdi:robot-outline" height="2.2rem" />
					<p>{hasKey ? $t('chat_intro') : $t('chat_no_key')}</p>
					{#if hasKey}
						<div class="examples">
							{#each examples as example (example)}
								<button class="w-pill" onclick={() => send(example)}>{example}</button>
							{/each}
						</div>
					{/if}
				</div>
			{/if}

			{#each items as item, index (index)}
				{#if item.kind === 'user'}
					<div class="bubble user">{item.text}</div>
				{:else if item.kind === 'assistant'}
					<div class="bubble assistant">{@html markdown(item.text)}</div>
				{:else if item.kind === 'tool'}
					<div class="tool" class:failed={item.ok === false}>
						<Icon
							icon={item.ok === undefined
								? 'mdi:loading'
								: item.ok
									? 'mdi:check'
									: 'mdi:alert-outline'}
							height="0.95rem"
							class={item.ok === undefined ? 'spin' : ''}
						/>
						{$t(`tool_${item.name}` as Key)}
						{#if item.summary}<span class="w-dim">{item.summary}</span>{/if}
					</div>
				{:else if item.kind === 'proposal'}
					<ProposalCard
						proposal={proposals[item.proposal.id] ?? item.proposal}
						ondecided={(next) => (proposals[next.id] = next)}
					/>
				{:else if item.kind === 'note'}
					<div class="note">{item.text}</div>
				{:else if item.kind === 'error'}
					<div class="note w-bad">{errorText(item.text)}</div>
				{/if}
			{/each}

			{#if live}
				<div class="bubble assistant">{@html markdown(live)}</div>
			{:else if busy}
				<div class="thinking">
					<Icon icon="mdi:loading" height="1rem" class="spin" />
					{thinking ? thinking.slice(-220) : $t('chat_thinking')}
				</div>
			{/if}
		</div>

		{#if engine === 'subscription' && limits?.used !== undefined}
			<p class="usage w-dim" class:w-warn={limits.used >= 0.8}>
				{$t('chat_usage', {
					p: String(Math.round(limits.used * 100)),
					window: $t(limits.window === 'five_hour' ? 'chat_window_5h' : 'chat_window_week')
				})}
			</p>
		{/if}
		<form
			class="composer"
			onsubmit={(event) => {
				event.preventDefault();
				send();
			}}
		>
			<textarea
				bind:value={input}
				rows="2"
				placeholder={$t('chat_placeholder')}
				disabled={!hasKey}
				onkeydown={(event) => {
					if (event.key === 'Enter' && !event.shiftKey) {
						event.preventDefault();
						send();
					}
				}}></textarea>
			<button class="w-pill primary" disabled={busy || !input.trim() || !hasKey}>
				<Icon icon="mdi:send" height="1rem" />{$t('chat_send')}
			</button>
		</form>
	</section>
</main>

<style>
	.page {
		display: grid;
		grid-template-columns: 16rem minmax(0, 1fr);
		gap: 1rem;
		padding: 0 2rem calc(6.5rem + env(safe-area-inset-bottom));
		height: calc(100dvh - 9rem);
		min-height: 28rem;
		color: white;
	}

	.history {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		overflow: hidden;
	}

	.history h4 {
		margin: 0.6rem 0 0.2rem;
	}

	.new {
		justify-content: center;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		overflow-y: auto;
		scrollbar-width: thin;
	}

	li {
		display: flex;
		align-items: center;
		border-radius: 0.7rem;
	}

	li.active,
	li:hover {
		background: rgba(255, 255, 255, 0.08);
	}

	.title {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.1rem;
		padding: 0.45rem 0.55rem;
		border: none;
		background: none;
		color: inherit;
		font-family: inherit;
		text-align: left;
		cursor: pointer;
	}

	.title span {
		width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.88rem;
	}

	.delete {
		display: flex;
		padding: 0.35rem;
		border: none;
		border-radius: 50%;
		background: none;
		color: inherit;
		opacity: 0.5;
		cursor: pointer;
	}

	.chat {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		min-height: 0;
	}

	.messages {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding-right: 0.3rem;
		scrollbar-width: thin;
	}

	.intro {
		margin: auto;
		max-width: 34rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.8rem;
		text-align: center;
		opacity: 0.9;
	}

	.examples {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.4rem;
	}

	.examples .w-pill {
		white-space: normal;
		text-align: left;
	}

	.bubble {
		max-width: min(46rem, 92%);
		padding: 0.65rem 0.9rem;
		border-radius: 1rem;
		line-height: 1.5;
		font-size: 0.93rem;
		overflow-wrap: anywhere;
		user-select: text;
		-webkit-user-select: text;
	}

	.bubble.user {
		align-self: flex-end;
		background: var(--home-card-on);
		color: #2a1a24;
		white-space: pre-wrap;
	}

	.bubble.assistant {
		align-self: flex-start;
		background: rgba(255, 255, 255, 0.08);
	}

	.bubble :global(p) {
		margin: 0 0 0.5rem;
	}

	.bubble :global(p:last-child) {
		margin-bottom: 0;
	}

	.bubble :global(ul),
	.bubble :global(ol) {
		margin: 0.2rem 0 0.5rem;
		padding-left: 1.2rem;
	}

	.bubble :global(code) {
		font-family: ui-monospace, monospace;
		font-size: 0.85em;
		padding: 0.05rem 0.3rem;
		border-radius: 0.3rem;
		background: rgba(0, 0, 0, 0.35);
	}

	.bubble :global(pre) {
		margin: 0.4rem 0;
		padding: 0.6rem 0.75rem;
		border-radius: 0.6rem;
		background: rgba(0, 0, 0, 0.45);
		overflow-x: auto;
	}

	.bubble :global(pre code) {
		padding: 0;
		background: none;
	}

	.tool,
	.thinking,
	.note {
		align-self: flex-start;
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.8rem;
		opacity: 0.75;
		max-width: 92%;
		overflow-wrap: anywhere;
	}

	.tool.failed {
		opacity: 1;
		color: #ffd27a;
	}

	.note {
		font-style: italic;
	}

	.thinking {
		font-style: italic;
		opacity: 0.6;
	}

	:global(.spin) {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.usage {
		margin: 0;
		font-size: 0.75rem;
		text-align: right;
	}

	.composer {
		display: flex;
		gap: 0.5rem;
		align-items: flex-end;
	}

	textarea {
		flex: 1;
		resize: none;
		padding: 0.65rem 0.85rem;
		border-radius: 1rem;
		border: 1px solid rgba(255, 255, 255, 0.18);
		background: rgba(0, 0, 0, 0.25);
		color: white;
		font-family: inherit;
		font-size: 0.95rem;
		user-select: text;
	}

	.mobile-bar {
		display: none;
		gap: 0.4rem;
	}

	.mobile-bar select {
		flex: 1;
		min-width: 0;
		padding: 0.45rem 0.7rem;
		border-radius: 1rem;
		border: 1px solid rgba(255, 255, 255, 0.18);
		background: rgba(0, 0, 0, 0.25);
		color: white;
		font-family: inherit;
		color-scheme: dark;
	}

	@media (max-width: 900px) {
		.mobile-bar {
			display: flex;
		}

		.page {
			grid-template-columns: minmax(0, 1fr);
			padding: 0 0.6rem calc(6.5rem + env(safe-area-inset-bottom));
			height: calc(100dvh - 8rem);
		}

		.history {
			display: none;
		}
	}
</style>
