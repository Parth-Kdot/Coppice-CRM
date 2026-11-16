import type { Membership } from "@/lib/authz";
import { dbNow } from "@/lib/claims";
import { withTenant } from "@/lib/db";

// The stats fixture, shared by the tests of what is built on the stats page (copied from
// tests/stats.test.ts, whose own copy is left as it is). Every number was worked out by hand
// (below). Sends are dated from the database's clock, as the stats page does.
//
// Workspace "a". Companies and the outreach each one got, oldest first:
//   bad-0..24   A: "Cold intro" (archived), 60 days ago. Replies from bad-0 and bad-15.
//               bad-0..14 are Tech, bad-15..24 Energy.
//   bad-0..9    B: "Alumni angle", 30 days ago (their 2nd touch). Replies from bad-0..4.
//   good-0..14  B: "Alumni angle", 30 days ago (1st touch), Energy. Replies from good-0..9.
//   good-0..2   C: "Alumni angle", 3 days ago, still maturing. A reply from good-0.
//   small-0..7  D: "Career fair", 20 days ago, no industry. Replies from small-0..3.
//   bad-10..12  E: no template, email, 20 days ago (2nd touch). A reply from bad-10.
//   bad-0..1    F: no template, LinkedIn, 15 days ago (3rd touch). No replies.
//   small-0..1  G: no template, email, 1 day ago (2nd touch), maturing. No replies.
//   ai-0..3     H: no template, from AI drafts, 20 days ago, Tech. Replies from ai-0..1.
// "Spring ask" was never used. Replied stage: good-0 (marked), small-7 (nothing marked), lonely
// (no outreach at all), and an archived company (left out of the gap count).
//
// By hand:
//   Alumni angle  sent 28, counted 25, replies 15: 60%, Wilson 40.7% to 76.6%. Rated.
//   Cold intro    sent 25, counted 25, replies 2: 8%, Wilson 2.2% to 25.0%. Rated, archived.
//   Career fair   sent 8, counted 8, replies 4: too few (under 20).
//   Spring ask    nothing sent.
//   No template   sent 11 (E3 + F2 + G2 + H4), counted 9, replies 3.
//   The ranges don't overlap: Alumni angle is best, Cold intro worst.
//   Emails only: AI-drafted 4 counted, 2 replies (too few). Hand-written: A25 + B25 + C3 + D8 + E3 + G2
//   = 66 sent, 61 counted, 2 + 15 + 4 + 1 = 22 replies. No call.
//   By touch: 1st = A25 + B15 + D8 + H4 = 52 sent, all counted, 2 + 10 + 4 + 2 = 18 replies.
//             2nd = B10 + E3 + C3 + G2 = 18 sent, 13 counted, 5 + 1 = 6 replies. 3rd+ = F2: 2, 2, 0.
//   Gaps: 11 without a template, 2 replied companies with nothing marked, 5 sends maturing.

export const OWNER: Membership = { userId: "ownerA", workspaceId: "a", role: "owner" };
export const OFFICER: Membership = { userId: "officerA", workspaceId: "a", role: "member" };
export const OTHER_ORG: Membership = { userId: "ownerB", workspaceId: "b", role: "owner" };
const DAY = 24 * 60 * 60 * 1000;

const range = (prefix: string, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `${prefix}-${from + i}`);

export async function seedStatsFixture() {
  const now = (await dbNow()).getTime();
  const ago = (days: number) => new Date(now - days * DAY);
  await withTenant(OWNER, async (tx) => {
    const company = (id: string, industry: string | null, extra: object = {}) => ({ id, workspaceId: "a", name: id, nameKey: id, industry, ...extra });
    await tx.company.createMany({
      data: [
        ...range("bad", 0, 14).map((id) => company(id, "Tech")),
        ...range("bad", 15, 24).map((id) => company(id, "Energy")),
        ...range("good", 0, 14).map((id) => company(id, "Energy", id === "good-0" ? { stage: "REPLIED" } : {})),
        ...range("small", 0, 7).map((id) => company(id, null, id === "small-7" ? { stage: "REPLIED" } : {})),
        ...range("ai", 0, 3).map((id) => company(id, "Tech")),
        company("lonely", null, { stage: "IN_CONVERSATION" }),
        company("gone", null, { stage: "COMMITTED", archivedAt: ago(1) }),
      ],
    });
    await tx.template.createMany({
      data: [
        { id: "t-alumni", workspaceId: "a", name: "Alumni angle", body: "Hi {{firstName}}" },
        { id: "t-cold", workspaceId: "a", name: "Cold intro", body: "Hi {{firstName}}", archivedAt: ago(5) },
        { id: "t-fair", workspaceId: "a", name: "Career fair", body: "Hi {{firstName}}" },
        { id: "t-spring", workspaceId: "a", name: "Spring ask", body: "Hi {{firstName}}" },
      ],
    });
    await tx.aiDraft.createMany({
      data: range("ai", 0, 3).map((companyId) => ({
        id: `d-${companyId}`,
        workspaceId: "a",
        companyId,
        createdById: "ownerA",
        kind: "FIRST_TOUCH" as const,
        angle: "Angle",
        subject: "Subject",
        body: "Body",
        model: "test",
      })),
    });

    type Send = { companies: string[]; templateId: string | null; days: number; replied: string[]; channel?: "EMAIL" | "LINKEDIN"; ai?: boolean };
    const sends: Send[] = [
      { companies: range("bad", 0, 24), templateId: "t-cold", days: 60, replied: ["bad-0", "bad-15"] },
      { companies: range("bad", 0, 9), templateId: "t-alumni", days: 30, replied: range("bad", 0, 4) },
      { companies: range("good", 0, 14), templateId: "t-alumni", days: 30, replied: range("good", 0, 9) },
      { companies: range("good", 0, 2), templateId: "t-alumni", days: 3, replied: ["good-0"] },
      { companies: range("small", 0, 7), templateId: "t-fair", days: 20, replied: range("small", 0, 3) },
      { companies: range("bad", 10, 12), templateId: null, days: 20, replied: ["bad-10"] },
      { companies: range("bad", 0, 1), templateId: null, days: 15, replied: [], channel: "LINKEDIN" },
      { companies: range("small", 0, 1), templateId: null, days: 1, replied: [] },
      { companies: range("ai", 0, 3), templateId: null, days: 20, replied: range("ai", 0, 1), ai: true },
    ];
    await tx.outreach.createMany({
      data: sends.flatMap((send, group) =>
        send.companies.map((companyId) => ({
          id: `o-${group}-${companyId}`,
          workspaceId: "a",
          companyId,
          senderId: "ownerA",
          templateId: send.templateId,
          channel: send.channel ?? "EMAIL",
          sentAt: ago(send.days),
          gotReply: send.replied.includes(companyId),
          aiDraftId: send.ai ? `d-${companyId}` : null,
        })),
      ),
    });
  });
}

