import { BlockList, isIP } from "node:net";

// Which addresses the research fetcher (lib/research/fetch.ts) may connect to: public unicast
// only. Every address a hostname resolves to is checked here before any connection is made.

// Everything in IPv4 that isn't a public unicast address (IANA special-purpose registry).
const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT (includes Alibaba's metadata address 100.100.100.200)
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (includes the metadata address 169.254.169.254)
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments (includes Oracle's metadata address 192.0.0.192)
  ["192.0.2.0", 24], // documentation
  ["192.31.196.0", 24], // AS112
  ["192.52.193.0", 24], // AMT
  ["192.88.99.0", 24], // 6to4 relay
  ["192.168.0.0", 16], // private
  ["192.175.48.0", 24], // AS112
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, and 255.255.255.255 broadcast
  // Public, but Azure's platform address (WireServer, its DNS and health probes) on every VM there.
  ["168.63.129.16", 32],
];
// IPv6: only global unicast (2000::/3) can be public, which already rules out loopback (::1), the
// unspecified address, IPv4-mapped (::ffff:0:0/96) and IPv4-compatible addresses, NAT64
// (64:ff9b::/96), unique-local (fc00::/7, including AWS's metadata address fd00:ec2::254),
// link-local (fe80::/10) and multicast (ff00::/8). Inside 2000::/3 these are special too:
const V6_BLOCKED: [string, number][] = [
  ["2001::", 23], // IETF protocol assignments, including Teredo (2001::/32), which tunnels IPv4
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4, which embeds an IPv4 address
  ["3fff::", 20], // documentation
];

const v4Blocked = new BlockList();
for (const [net, prefix] of V4_BLOCKED) v4Blocked.addSubnet(net, prefix, "ipv4");
const v6Blocked = new BlockList();
for (const [net, prefix] of V6_BLOCKED) v6Blocked.addSubnet(net, prefix, "ipv6");
const v6GlobalUnicast = new BlockList();
v6GlobalUnicast.addSubnet("2000::", 3, "ipv6");

// True unless the address is a public unicast address. Anything that isn't an IP at all is blocked.
export function isBlockedAddress(address: string): boolean {
  try {
    const family = isIP(address);
    if (family === 4) return v4Blocked.check(address, "ipv4");
    if (family === 6) return !v6GlobalUnicast.check(address, "ipv6") || v6Blocked.check(address, "ipv6");
  } catch {
    // An address BlockList can't read is not one we connect to.
  }
  return true;
}
