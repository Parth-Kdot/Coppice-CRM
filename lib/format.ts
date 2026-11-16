// Counts and plurals as people read them. Pure, so server and client code can both import it.

// "1,248"
export const formatCount = (n: number) => n.toLocaleString("en-US");

// "1 fact", "2 facts", "1,248 facts"
export const plural = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`;
