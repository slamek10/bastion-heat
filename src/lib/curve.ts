/**
 * The heating curve as Bastion HA's card draws it:
 * flow = target + slope × (target − outdoor)^0.85, kept between 22 and 65 °C
 */
export function targetFlow(outdoor: number, targetRoom: number, slope: number) {
	const diff = Math.max(0, targetRoom - outdoor);
	const flow = targetRoom + slope * Math.pow(diff, 0.85);
	return Math.min(65, Math.max(22, Math.round(flow * 10) / 10));
}

/** the curve from -15 to 20 °C outdoors, one point a degree */
export function curvePoints(targetRoom: number, slope: number) {
	const points: { outdoor: number; flow: number }[] = [];
	for (let outdoor = -15; outdoor <= 20; outdoor++)
		points.push({ outdoor, flow: targetFlow(outdoor, targetRoom, slope) });
	return points;
}

export function pressureState(bar: number | undefined) {
	if (bar === undefined) return 'unknown' as const;
	if (bar < 1.1) return 'low' as const;
	if (bar > 2.3) return 'high' as const;
	return 'ok' as const;
}
