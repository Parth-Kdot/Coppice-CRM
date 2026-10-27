"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Ribbon, Tick, TurnoverRule } from "../marks";
import { EXAMPLE } from "./copy";
import { MOTION_OK, setupGsap } from "./motion";

// The live example: Maya and Dev go for the same company in the same second. Two ledger columns, one
// per officer, with the six beats of the script laid down the page. Beats come in as the reader
// scrolls: when Maya claims Kestrel Aerospace a gilt ribbon drops into her row, and on Dev's side a
// rust margin note writes in. Later the follow-up row returns to the top of Maya's queue.

function MiniRow({ name, children, ribbon, className = "" }: { name: string; children?: ReactNode; ribbon?: boolean; className?: string }) {
  return (
    <div className={`ld-mini-row ${className}`}>
      {ribbon && <Ribbon size="sm" className="ld-mini-ribbon" />}
      <span className="ld-mini-name">{name}</span>
      <span className="ld-mini-meta">{children}</span>
    </div>
  );
}

function Beat({ date, time, caption, children }: { date: string; time?: string; caption: string; children: ReactNode }) {
  return (
    <article className="ld-beat">
      <div className="ld-beat-date">
        <p className="lg-sc">{date}</p>
        {time && <p className="lg-num">{time}</p>}
      </div>
      {children}
      <p className="ld-beat-cap lg-quote">{caption}</p>
    </article>
  );
}

function Cell({ who, children, className = "" }: { who: "Maya" | "Dev"; children?: ReactNode; className?: string }) {
  return (
    <div className={`ld-cell ${className}`} role="group" aria-label={`${who}'s screen`}>
      <p className="ld-cell-who lg-sc" aria-hidden="true">
        {who}
      </p>
      {children}
    </div>
  );
}

export function Example() {
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const { gsap, ScrollTrigger } = setupGsap();
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      el.dataset.js = "on";
      const triggers = Array.from(el.querySelectorAll<HTMLElement>(".ld-beat")).map((beat) =>
        ScrollTrigger.create({
          trigger: beat,
          start: "top 76%",
          once: true,
          onEnter: () => {
            beat.classList.add("is-in");
            beat.querySelectorAll(".lg-tick").forEach((t, i) => window.setTimeout(() => t.classList.add("lg-tick-draw"), 500 + i * 300));
          },
        }),
      );
      const strip = el.querySelector<HTMLElement>(".ld-datestrip");
      if (strip) triggers.push(ScrollTrigger.create({ trigger: strip, start: "top 85%", once: true, onEnter: () => strip.classList.add("is-in") }));
      return () => {
        triggers.forEach((t) => t.kill());
        el.querySelectorAll(".is-in").forEach((b) => b.classList.remove("is-in"));
        el.querySelectorAll(".lg-tick-draw").forEach((t) => t.classList.remove("lg-tick-draw"));
        delete el.dataset.js;
      };
    });
    return () => mm.revert();
  }, []);

  return (
    <section ref={root} id="example" className="ld-sec ld-example" aria-labelledby="example-title">
      <div className="ld-wrap">
        <header className="ld-sec-head">
          <p className="ld-eyebrow">Live example</p>
          <h2 id="example-title" className="ld-h2">
            {EXAMPLE.headline}
          </h2>
          <p className="ld-sub">{EXAMPLE.subhead}</p>
          <p className="ld-setting">{EXAMPLE.setting}</p>
        </header>

        <div className="ld-duo">
          <div className="ld-duo-heads" aria-hidden="true">
            <span />
            <p className="ld-officer">Maya</p>
            <p className="ld-officer">Dev</p>
          </div>

          <Beat date="Mon, Oct 26" time="9:02 AM" caption="Two officers, one promising lead, and both about to click.">
            <Cell who="Maya">
              <p className="ld-list-title lg-sc">Never contacted</p>
              <MiniRow name="Kestrel Aerospace">
                <span className="ld-fakebtn">Claim</span>
              </MiniRow>
            </Cell>
            <Cell who="Dev">
              <p className="ld-list-title lg-sc">Never contacted</p>
              <MiniRow name="Kestrel Aerospace">
                <span className="ld-fakebtn">Claim</span>
              </MiniRow>
            </Cell>
          </Beat>

          <Beat date="Mon, Oct 26" time="9:02 AM, a moment later" caption="One winner. The other officer is told who and until when.">
            <Cell who="Maya">
              <p className="ld-list-title lg-sc">Never contacted</p>
              <MiniRow name="Kestrel Aerospace" ribbon className="ld-claimed">
                <span className="lg-badge lg-badge-mine">Yours until Nov 9</span>
              </MiniRow>
              <p className="ld-line">You hold this until Nov 9, 2026, 9:02 AM.</p>
            </Cell>
            <Cell who="Dev" className="ld-cell-refused">
              <p className="ld-list-title lg-sc">Never contacted</p>
              <MiniRow name="Kestrel Aerospace">
                <span className="ld-fakebtn ld-shake">Claim</span>
              </MiniRow>
              <p className="ld-margin-note ld-write">Maya claimed this first. They hold it until Nov 9, 2026, 9:02 AM.</p>
            </Cell>
          </Beat>

          <Beat date="Mon, Oct 26" time="9:03 AM" caption="Nobody had to ask in the group chat.">
            <Cell who="Maya">
              <MiniRow name="Kestrel Aerospace" ribbon>
                <span className="lg-badge lg-badge-mine">Yours until Nov 9</span>
              </MiniRow>
              <p className="ld-line ld-line-quiet">Writing to Priya in partnerships from her own Gmail.</p>
            </Cell>
            <Cell who="Dev">
              <p className="ld-line">Kestrel&apos;s page says &quot;Held by Maya until Nov 9.&quot; There is no outreach form for him, and only Maya or an owner can change its stage.</p>
              <MiniRow name="Birchwood Foods" ribbon className="ld-claimed ld-claimed-late">
                <span className="lg-badge lg-badge-mine">Yours until Nov 9</span>
              </MiniRow>
            </Cell>
          </Beat>

          <Beat date="Wed, Oct 28" caption="Logging the email renews the claim for another 14 days.">
            <Cell who="Maya">
              <div className="ld-logcard">
                <p className="lg-sc ld-log-title">Log outreach</p>
                <dl>
                  <div>
                    <dt>Channel</dt>
                    <dd>Email</dd>
                  </div>
                  <div>
                    <dt>Follow up on</dt>
                    <dd className="lg-num">Nov 4</dd>
                  </div>
                  <div>
                    <dt>Note</dt>
                    <dd>Intro to Priya in partnerships, packet attached</dd>
                  </div>
                </dl>
                <p className="ld-saved">
                  <Tick size={18} auto={false} />
                  <span>Logged. Not contacted moved to Contacted. Claim renewed to Nov 11.</span>
                </p>
              </div>
            </Cell>
            <Cell who="Dev">
              <MiniRow name="Birchwood Foods" ribbon>
                <span className="lg-badge lg-badge-mine">Yours until Nov 9</span>
              </MiniRow>
            </Cell>
          </Beat>

          <Beat date="Wed, Nov 4" caption="The queue remembers so Maya does not have to.">
            <Cell who="Maya">
              <p className="ld-list-title lg-sc">Follow-ups due</p>
              <MiniRow name="Kestrel Aerospace" className="ld-returns">
                <span className="ld-due">Due today</span>
              </MiniRow>
              <p className="ld-quote-line lg-quote">&ldquo;Intro to Priya in partnerships, packet attached&rdquo;</p>
              <p className="ld-line">She sends a short follow-up and logs it. Next follow-up Nov 11, claim now runs to Nov 18.</p>
            </Cell>
            <Cell who="Dev">
              <p className="ld-list-title lg-sc">Follow-ups due</p>
              <MiniRow name="Kestrel Aerospace">
                <span className="lg-badge lg-badge-theirs">Held by Maya until Nov 11</span>
              </MiniRow>
              <p className="ld-margin-note ld-write">Held by Maya until Nov 11. No Claim button.</p>
            </Cell>
          </Beat>

          <Beat date="Fri, Nov 6" caption="The new board starts from Maya's notes.">
            <Cell who="Maya">
              <div className="ld-logcard">
                <p className="lg-sc ld-log-title">Log outreach</p>
                <dl>
                  <div>
                    <dt>Channel</dt>
                    <dd>Other</dd>
                  </div>
                  <div>
                    <dt>Note</dt>
                    <dd>Priya replied, wants a 20-minute call</dd>
                  </div>
                </dl>
                <p className="ld-saved">
                  <Tick size={18} auto={false} />
                  <span>Logged. Kestrel moved to Replied.</span>
                </p>
              </div>
            </Cell>
            <Cell who="Dev">
              <p className="ld-line ld-line-quiet">Still working Birchwood Foods.</p>
            </Cell>
          </Beat>

          <div className="ld-nextyear">
            <TurnoverRule endsYear="2026-27" />
            <div className="ld-nextyear-card">
              <p className="lg-sc ld-log-title">Next September, the new chair opens Kestrel Aerospace</p>
              <ol>
                <li>
                  <span className="lg-margin">26-27</span>
                  <span>Oct 28, email, Maya</span>
                </li>
                <li>
                  <span className="lg-margin">26-27</span>
                  <span>Nov 4, email follow-up, Maya</span>
                </li>
                <li>
                  <span className="lg-margin">26-27</span>
                  <span>Nov 6, note: Priya replied, wants a 20-minute call</span>
                </li>
              </ol>
              <p className="ld-line">Stage history: Not contacted, Contacted, Replied. All of it still there, top to bottom.</p>
            </div>
          </div>
        </div>

        <figure className="ld-datestrip" aria-label="Maya's claim on Kestrel Aerospace, from Oct 26 to Nov 18">
          <div className="ld-strip-track" aria-hidden="true">
            <span className="ld-bar ld-bar-1" />
            <span className="ld-bar ld-bar-2" />
            <span className="ld-bar ld-bar-3" />
            <span className="ld-mark ld-mark-1" />
            <span className="ld-mark ld-mark-2" />
            <span className="ld-mark ld-mark-3" />
          </div>
          <figcaption>
            <span>Oct 26</span>
            <span>Oct 28, logged</span>
            <span>Nov 4, due and logged</span>
            <span>Nov 18, claim ends</span>
          </figcaption>
          <p className="ld-hint-line">Each time Maya logs, her claim runs another 14 days from that day. If she logged nothing after Oct 28, the claim would end Nov 11 and Dev would see a Claim button again. An owner can also force-release it sooner.</p>
        </figure>
      </div>
    </section>
  );
}
