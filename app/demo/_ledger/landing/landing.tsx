import "../ledger.css";
import "./landing.css";
import "./mini.css";
import { Example } from "./example";
import { Features } from "./features";
import { Final } from "./final";
import { Hero } from "./hero";
import { How } from "./how";
import { LandingNav } from "./nav";
import { Problem } from "./problem";
import { Seasons } from "./seasons";
import { SmoothScroll } from "./smooth";
import { Audience, NameStory, Trust } from "./story";
import { GetStarted } from "./start";

// The Coppice landing page at "/". Each section is its own client component with its own scroll
// choreography, cleaned up with gsap.context. Smooth scrolling (Lenis) runs on this page only.
export function Landing() {
  return (
    <div className="ld">
      <SmoothScroll />
      <LandingNav />
      <main>
        <Hero />
        <Problem />
        <Seasons />
        <How />
        <Features />
        <Example />
        <Audience />
        <NameStory />
        <Trust />
        <GetStarted />
      </main>
      <Final />
    </div>
  );
}
