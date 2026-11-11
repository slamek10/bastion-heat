/** 1.2 GB, 340 kB: decimal units like routers and ISPs use */
export function bytes(value: number) {
	const units = ['B', 'kB', 'MB', 'GB', 'TB', 'PB'];
	let amount = value;
	let unit = 0;
	while (amount >= 1000 && unit < units.length - 1) {
		amount /= 1000;
		unit++;
	}
	const digits = amount >= 100 || unit === 0 ? 0 : amount >= 10 ? 1 : 2;
	return `${amount.toFixed(digits)} ${units[unit]}`;
}

const PROTOCOLS: Record<number, string> = {
	1: 'ICMP',
	6: 'TCP',
	17: 'UDP',
	47: 'GRE',
	50: 'ESP',
	58: 'ICMPv6'
};

const SERVICES: Record<number, string> = {
	20: 'FTP data',
	21: 'FTP',
	22: 'SSH',
	25: 'SMTP',
	53: 'DNS',
	67: 'DHCP',
	68: 'DHCP',
	80: 'HTTP',
	123: 'NTP',
	137: 'NetBIOS',
	143: 'IMAP',
	161: 'SNMP',
	443: 'HTTPS',
	445: 'SMB',
	465: 'SMTPS',
	514: 'Syslog',
	554: 'RTSP',
	587: 'SMTP',
	853: 'DNS over TLS',
	993: 'IMAPS',
	1194: 'OpenVPN',
	1883: 'MQTT',
	1900: 'SSDP',
	2055: 'NetFlow',
	3389: 'RDP',
	3478: 'STUN',
	5060: 'SIP',
	5353: 'mDNS',
	8006: 'Proxmox',
	8123: 'Home Assistant',
	8443: 'HTTPS alt',
	8554: 'RTSP',
	51820: 'WireGuard'
};

export const protocolName = (proto: number) => PROTOCOLS[proto] ?? `IP ${proto}`;

/** "HTTPS (TCP 443)", "ICMP" */
export function serviceName(proto: number, port: number) {
	if (!port) return protocolName(proto);
	const known = SERVICES[port];
	const plain = `${protocolName(proto)} ${port}`;
	return known ? `${known} (${plain})` : plain;
}

/** 3 d 4 h, 5 h 12 min, 40 min */
export function duration(seconds: number, locale: 'hr' | 'en' = 'hr') {
	const d = Math.floor(seconds / 86400);
	const h = Math.floor((seconds % 86400) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const day = locale === 'hr' ? 'd' : 'd';
	if (d) return `${d} ${day} ${h} h`;
	if (h) return `${h} h ${m} min`;
	return `${m} min`;
}

/** 0-100, or 0-1 when fraction is set */
export const percent = (value: number, fraction = false) =>
	Math.round(fraction ? value * 100 : value);
