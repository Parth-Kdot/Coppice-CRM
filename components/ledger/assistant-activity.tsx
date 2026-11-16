import Link from "next/link";
import { ShowMore } from "@/components/ledger/show-more";
import { when } from "@/lib/dates";
import type { ActivityItem } from "@/lib/mcp/activity-list";
import "./settings.css";

// Settings, AI assistants: what assistants changed in this workspace, newest first, for every
// member. One quiet list, five rows and "Show all" for the rest. Every name in a line was typed by
// a member (or is an assistant's own name), so each sits in <bdi>, which keeps a name in a
// right-to-left script from reordering the words around it.
export function AssistantActivityList({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) return <p className="mt-2">Nothing yet. Changes an assistant makes will be listed here.</p>;
  return (
    <div className="lg-set-invites !mt-2">
      <ShowMore initial={5} label="changes" as="ul" listClassName="lg-invitelist" listLabel="What assistants changed">
        {items.map((item) => (
          <li key={item.id}>
            <div className="lg-invite-text">
              <p className="lg-act-line">
                <bdi>{item.person}</bdi>&apos;s assistant {item.verb}
                {item.label &&
                  (item.label.kind === "name" ? (
                    <>
                      {" "}
                      {item.label.prefix}
                      {item.label.href ? (
                        <Link href={item.label.href} className="lg-link">
                          <bdi>{item.label.text}</bdi>
                        </Link>
                      ) : (
                        <bdi>{item.label.text}</bdi>
                      )}
                    </>
                  ) : (
                    <> {item.label.text}</>
                  ))}
                .
              </p>
              <p className="lg-hint">
                <time dateTime={item.at.toISOString()}>{when(item.at)}</time>
                {item.assistant && (
                  <>
                    {" "}
                    · <bdi>{item.assistant}</bdi>
                  </>
                )}
              </p>
            </div>
          </li>
        ))}
      </ShowMore>
    </div>
  );
}
