import { describe, expect, it } from 'vitest';
import { offer, take } from './phoneActions';

describe('phone action tokens', () => {
	it('a pressed button gives back exactly what was offered, once', () => {
		const action = offer({ kind: 'confirm', pendingId: 'p1' });
		expect(action).toMatch(/^BHEAT_[0-9a-f]{32}$/);
		expect(take(action)).toMatchObject({ kind: 'confirm', pendingId: 'p1' });
		expect(take(action)).toBeUndefined();
	});

	it('an unknown or made-up action does nothing', () => {
		expect(take('BHEAT_00000000000000000000000000000000')).toBeUndefined();
		expect(take('BASTION_CAMS_MUTE_x')).toBeUndefined();
	});
});
