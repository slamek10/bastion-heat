import { describe, expect, it } from 'vitest';
import { arrange, defaultLayout, moveGroup, moveItem, removeGroup } from './overview';

describe('arrange', () => {
	it('starts from the default panels', () => {
		expect(arrange([], ['a', 'b'])).toEqual(defaultLayout(['a', 'b']));
		expect(defaultLayout(['a']).at(-1)).toEqual({ item: 'valves' });
	});

	it('drops rooms that are gone and adds new rooms to the rooms panel', () => {
		const saved = [
			{ group: 'mine', title: 'Kat', items: ['room:gone', 'room:a', 'zone'] },
			{ group: 'rooms', items: ['room:b'] }
		];
		const blocks = arrange(saved, ['a', 'b', 'c']);
		expect(blocks[0]).toEqual({ group: 'mine', title: 'Kat', items: ['room:a', 'zone'] });
		expect(blocks[1]).toEqual({ group: 'rooms', items: ['room:b', 'room:c'] });
		// the rest come back on their own
		expect(blocks.slice(2).map((block) => ('item' in block ? block.item : ''))).toEqual([
			'ac',
			'dhw',
			'pressure',
			'brain',
			'valves'
		]);
	});

	it('keeps a card in one place only', () => {
		const blocks = arrange([{ item: 'zone' }, { group: 'g', items: ['zone'] }], []);
		expect(blocks[1]).toEqual({ group: 'g', items: [] });
	});
});

describe('moveItem', () => {
	const start = defaultLayout(['a', 'b']);

	it('moves a card into another panel', () => {
		const next = moveItem(start, 'pressure', { group: 'central', index: 1 });
		expect(next[0]).toEqual({ group: 'central', items: ['zone', 'pressure', 'ac'] });
		expect(next[1]).toEqual({ group: 'water', items: ['dhw'] });
	});

	it('moves a card later in its own panel', () => {
		const next = moveItem(start, 'room:a', { group: 'rooms', index: 2 });
		expect(next[2]).toEqual({ group: 'rooms', items: ['room:b', 'room:a'] });
	});

	it('takes a card out of a panel and puts one in', () => {
		let next = moveItem(start, 'zone', { top: 0 });
		expect(next[0]).toEqual({ item: 'zone' });
		expect(next[1]).toEqual({ group: 'central', items: ['ac'] });
		next = moveItem(next, 'valves', { group: 'central', index: 0 });
		expect(next.some((block) => 'item' in block && block.item === 'valves')).toBe(false);
	});
});

describe('panels', () => {
	it('moves a panel', () => {
		const start = defaultLayout([]);
		expect(moveGroup(start, 'rooms', 0).map((b) => ('group' in b ? b.group : b.item))).toEqual([
			'rooms',
			'central',
			'water',
			'brain',
			'valves'
		]);
		expect(moveGroup(start, 'central', 3).map((b) => ('group' in b ? b.group : b.item))).toEqual([
			'water',
			'rooms',
			'central',
			'brain',
			'valves'
		]);
	});

	it('leaves the cards behind when a panel is removed', () => {
		const next = removeGroup(defaultLayout([]), 'water');
		expect(next[1]).toEqual({ item: 'dhw' });
		expect(next[2]).toEqual({ item: 'pressure' });
	});
});
