// robots.txt, as RFC 9309 describes it, for one question: may our crawler read this path?
//
// The group for our product token ("coppiceresearch", matched case-insensitively against each
// User-agent line) wins; without one, the "*" group applies; without either, everything is
// allowed. Within the group the longest matching rule decides, and Allow wins a tie. "*" matches
// any run of characters and "$" ends a pattern.

type Rule = { allow: boolean; pattern: string };

// Groups of consecutive User-agent lines and the rules under them.
function parse(text: string): { agents: string[]; rules: Rule[] }[] {
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (key === "allow" || key === "disallow") {
      lastWasAgent = false;
      // An empty Disallow allows everything, so it adds no rule.
      if (current && value) current.rules.push({ allow: key === "allow", pattern: value });
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

// Percent-encoding differences ("%7E" and "~") shouldn't change the answer.
function normalizePath(path: string): string {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}

// Whether the pattern matches the start of the path. Each piece between wildcards is found at
// its earliest place, which leaves the most room for the rest, so this is linear and exact.
function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const parts = (anchored ? pattern.slice(0, -1) : pattern).split("*");
  if (!path.startsWith(parts[0])) return false;
  if (parts.length === 1) return anchored ? path === parts[0] : true;
  let at = parts[0].length;
  for (const piece of anchored ? parts.slice(1, -1) : parts.slice(1)) {
    const found = path.indexOf(piece, at);
    if (found < 0) return false;
    at = found + piece.length;
  }
  if (!anchored) return true;
  // "$": the last piece must end the path, after everything before it.
  const last = parts[parts.length - 1];
  return path.length - last.length >= at && path.endsWith(last);
}

export function robotsAllows(text: string, pathAndQuery: string, userAgent: string): boolean {
  const token = userAgent.split("/")[0].toLowerCase();
  const groups = parse(text);
  const ours = groups.filter((g) => g.agents.some((a) => a.split("/")[0].trim() === token));
  const chosen = ours.length > 0 ? ours : groups.filter((g) => g.agents.includes("*"));
  const rules = chosen.flatMap((g) => g.rules);
  const path = normalizePath(pathAndQuery || "/");

  let best: Rule | null = null;
  for (const rule of rules) {
    const pattern = normalizePath(rule.pattern);
    if (!matches(pattern, path)) continue;
    if (!best || pattern.length > best.pattern.length || (pattern.length === best.pattern.length && rule.allow)) {
      best = { allow: rule.allow, pattern };
    }
  }
  return best ? best.allow : true;
}
