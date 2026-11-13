/**
 * Pregled's layout: panels (groups) that hold cards, and cards on their own
 * between them. Cards are the circuit, the AC, hot water, pressure, valves,
 * the automation and every room ("room:<id>"). Saved in settings.overview;
 * an empty list is the default layout.
 */
import type { OverviewBlock } from '$lib/types';

export const BUILTIN_ITEMS = ['zone', 'ac', 'dhw', 'pressure', 'brain', 'valves'] as const;
export const ITEM = /^(zone|ac|dhw|pressure|valves|brain|room:[\w-]{1,40})$/;
export const roomItem = (id: string) => `room:${id}`;

/** the panels named on first start: central heating, water & pressure, rooms; valves alone at the bottom */
export function defaultLayout(roomIds: string[]): OverviewBlock[] {
	return [
		{ group: 'central', items: ['zone', 'ac'] },
		{ group: 'water', items: ['dhw', 'pressure'] },
		{ group: 'rooms', items: roomIds.map(roomItem) },
		{ item: 'brain' },
		{ item: 'valves' }
	];
}

const isGroup = (block: OverviewBlock): block is Extract<OverviewBlock, { group: string }> =>
	'group' in block;

/**
 * The saved layout made whole: rooms that are gone drop out, a card that is
 * nowhere yet is added - a new room into the panel that holds rooms, anything
 * else on its own at the end.
 */
export function arrange(saved: OverviewBlock[] | undefined, roomIds: string[]): OverviewBlock[] {
	if (!saved?.length) return defaultLayout(roomIds);
	const known = new Set<string>([...BUILTIN_ITEMS, ...roomIds.map(roomItem)]);
	const seen = new Set<string>();
	const keep = (id: string) => known.has(id) && !seen.has(id) && !!seen.add(id);
	const blocks: OverviewBlock[] = [];
	for (const block of saved) {
		if (isGroup(block)) blocks.push({ ...block, items: block.items.filter(keep) });
		else if (keep(block.item)) blocks.push({ item: block.item });
	}
	const roomsHome =
		blocks.find((block) => isGroup(block) && block.group === 'rooms') ??
		blocks.find((block) => isGroup(block) && block.items.some((id) => id.startsWith('room:')));
	for (const id of roomIds.map(roomItem)) {
		if (seen.has(id)) continue;
		if (roomsHome && isGroup(roomsHome)) roomsHome.items.push(id);
		else blocks.push({ item: id });
		seen.add(id);
	}
	for (const id of BUILTIN_ITEMS) if (!seen.has(id)) blocks.push({ item: id });
	return blocks;
}

/** where a dragged card or panel lands: inside a panel at an index, or among the top blocks */
export type Target = { group: string; index: number } | { top: number };

const HOLE = '\u0000';

/** a card moved: a placeholder goes in first, then the card leaves its old place, so indexes never shift */
export function moveItem(blocks: OverviewBlock[], id: string, target: Target): OverviewBlock[] {
	const next: OverviewBlock[] = blocks.map((block) =>
		isGroup(block) ? { ...block, items: [...block.items] } : { ...block }
	);
	if ('top' in target) next.splice(target.top, 0, { item: HOLE });
	else {
		const group = next.find((block) => isGroup(block) && block.group === target.group);
		if (!group || !isGroup(group)) return blocks;
		group.items.splice(target.index, 0, HOLE);
	}
	return next
		.filter((block) => isGroup(block) || block.item !== id)
		.map((block) =>
			isGroup(block)
				? {
						...block,
						items: block.items
							.filter((item) => item !== id)
							.map((item) => (item === HOLE ? id : item))
					}
				: block.item === HOLE
					? { item: id }
					: block
		);
}

/** a whole panel moved among the top blocks */
export function moveGroup(blocks: OverviewBlock[], group: string, top: number): OverviewBlock[] {
	const from = blocks.findIndex((block) => isGroup(block) && block.group === group);
	if (from < 0) return blocks;
	const next = [...blocks];
	const [moved] = next.splice(from, 1);
	next.splice(top > from ? top - 1 : top, 0, moved);
	return next;
}

/** a panel removed: its cards stay where it was, on their own */
export function removeGroup(blocks: OverviewBlock[], group: string): OverviewBlock[] {
	return blocks.flatMap((block) =>
		isGroup(block) && block.group === group ? block.items.map((item) => ({ item })) : [block]
	);
}

export { isGroup };
