import Link from "next/link";
import { Fragment } from "react";
import { Hero } from "../components/landing/hero";
import { Navbar, NavLinks } from "../components/site-nav";

const CARDS = [
  { card: 589, label: 613, body: 613, sphere: 631, sphereTop: 1052, title: "01/ expiring supply", bodyText: "0G credits reset at midnight, plan allowances monthly. Sell what expires — always under list price, by rule.", art: { src: "/images/1st.svg", w: 252, h: 248 } },
  { card: 947, label: 970, body: 972, sphere: 987, sphereTop: 1052, title: "02/ agents pay", bodyText: "No account, no card. A request that can't be covered answers with a price; the agent pays USDC on Hedera and streams on.", art: { src: "/images/2nd.svg", w: 257, h: 247 } },
  { card: 1305, label: 1324, body: 1324, sphere: 1349, sphereTop: 1078, title: "03/ one human", bodyText: "World ID keeps supply human: one seller per person, and a person approves an agent's spending cap.", art: { src: "/images/3rd.svg", w: 249, h: 210 } },
];

const DIVIDER_X = [138, 428, 718, 1008, 1298, 1588];
const TICKS = Array.from({ length: 24 }, (_, k) => 196 + 58 * k).filter(
  (x) => !DIVIDER_X.includes(x),
);
const COLUMN_COPY = [
  { x: 171, head: "Every fill names its rail", bodyText: "0G runs the demo rail, with request ids in the receipts." },
  { x: 461, head: "Every payment is public", bodyText: "Top-ups settle as USDC transfers on Hedera with a HashScan link." },
  { x: 757, head: "Supply stays human", bodyText: "One seller per World-verified person; denials are shown too." },
  { x: 1047, head: "The index recomputes", bodyText: "Per-minute public rollups; rebuild them on /receipts yourself." },
  { x: 1344, head: "The curve is settled", bodyText: "Perps clear against the house vault at 5x, funding on skew." },
];

const HOW_IT_WORKS = `01 A seller lists capacity: World-verified, key capped, ask below list.
02 An agent with $0 asks for a completion; the venue answers with what it needs; the agent pays USDC; it streams.
03 Traders clear the book — fills print to the public log, the index moves.
04 The index becomes a market: short to lock tomorrow's revenue, or long to cap cost.`;

const LINE = "bg-[#CECECE]";

export default function Home() {
  return (
    <main className="bg-white">
      <div className="lg:hidden">
        <nav className="flex flex-wrap items-center justify-center gap-x-7 gap-y-2 border-b border-[#CECECE] px-6 py-4 text-[15px] leading-[20px] text-[#1E1E1E]">
          <NavLinks />
        </nav>

        <Hero variant="page" />

        <section className="mt-16 border-t border-[#CECECE] px-6 pt-10">
          <p className="text-[15px] text-black">[ what we do ]</p>
          <h2 className="mt-5 font-serif text-[34px] leading-[1.1] text-[#1E1E1E]">
            Sell what expires. Trade the rest.
          </h2>
          <div className="mt-9 flex flex-col gap-6">
            {CARDS.map((c) => (
              <article key={c.title} className="border border-[#CECECE] bg-[#EBEBEB] px-6 py-7">
                <p className="text-[15px] text-[#1E1E1E]">{c.title}</p>
                <img
                  src={c.art.src}
                  alt=""
                  width={c.art.w}
                  height={c.art.h}
                  className="mx-auto my-7 h-auto w-[62%] max-w-[230px]"
                />
                <p className="text-[16px] leading-[24px] text-black">{c.bodyText}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-16 border-t border-[#CECECE] px-6 pt-10">
          <h2 className="font-serif text-[32px] leading-[1.12] text-black">
            Proof over marketing. Recompute our index in your browser.
          </h2>
          <div className="mt-8 border-b border-[#CECECE]">
            {COLUMN_COPY.map((c) => (
              <div key={c.x} className="border-t border-[#CECECE] py-5">
                <p className="text-[15px] leading-[22px] text-[#1E1E1E]">{c.head}</p>
                <p className="mt-1 text-[15px] leading-[22px] text-black">{c.bodyText}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="relative mt-16">
          <div
            className="h-[230px] w-full bg-cover"
            style={{
              backgroundImage: "url(/images/panorama.png)",
              filter: "contrast(98%) saturate(0%)",
            }}
          />
          <div className="absolute -top-7 right-0 h-[80px] w-2/5 bg-[#1743FF] opacity-30" />
          <div className="absolute -bottom-5 left-0 h-[80px] w-2/5 bg-[#1743FF] opacity-30" />
        </section>

        <section className="mt-16 border-t border-[#CECECE] px-6 pb-14 pt-10">
          <h2 className="font-serif text-[34px] leading-[1.1] text-black">How it works</h2>
          <p className="mt-6 whitespace-pre-wrap text-[16px] leading-[26px] text-[#757575]">
            {HOW_IT_WORKS}
          </p>
        </section>

        <footer className="border-t border-[#CECECE] bg-[#EBEBEB] px-6 pb-10 pt-12">
          <div className="flex gap-16 text-[16px] text-[#1E1E1E]">
            <div className="flex flex-col gap-1.5">
              <p>Socials</p>
              <p>Twitter X</p>
              <p>Telegram</p>
              <p>HashScan</p>
            </div>
          </div>
          <div className="mt-10 flex flex-wrap gap-x-8 gap-y-3 text-[15px] leading-[22px] text-[#757575]">
            <a href="https://github.com/0xsoydev/celestial-trade/blob/develop/docs/plan.md">Plan</a>
            <a href="https://github.com/0xsoydev/celestial-trade">README</a>
            <Link href="/receipts">Receipts</Link>
          </div>
          <div
            className="mt-8 h-[220px] w-full bg-contain bg-center bg-no-repeat"
            style={{ backgroundImage: "url(/images/goddess.png)" }}
          />
        </footer>
      </div>

      <div className="desktop-wrap hidden lg:block">
        <div className="desktop-canvas relative h-[4081px] w-[1728px] overflow-hidden bg-white">
          <Hero variant="canvas" nav={<Navbar variant="canvas" />} />

          <div className="absolute left-[55px] top-[3351px] h-[286px] w-[1617px] border border-[#CECECE] bg-[#EBEBEB]" />

          <div className="absolute left-[575px] top-[726px] h-[821px] w-[1080px] bg-white" />

          <p className="absolute left-[610px] top-[717px] whitespace-pre text-[20px] leading-[100px] text-black">
            [ what we do ]
          </p>
          <div className={`absolute left-[1632px] top-[946px] h-[1044px] w-px ${LINE}`} />
          <div className={`absolute left-[990px] top-[726px] h-[477px] w-px ${LINE}`} />
          <h2 className="absolute left-[610px] top-[808px] whitespace-pre font-serif text-[60px] font-normal leading-[60px] text-[#1E1E1E]">
            {"Sell what expires.\nTrade the rest."}
          </h2>

          {CARDS.map((c) => (
            <Fragment key={c.card}>
              <div
                className="absolute top-[965px] h-[547px] w-[336px] border border-[#CECECE] bg-[#EBEBEB]"
                style={{ left: c.card }}
              />
              <p
                className="absolute whitespace-pre text-[20px] leading-[24px] text-[#1E1E1E]"
                style={{ left: c.label, top: 987 }}
              >
                {c.title}
              </p>
              <img
                src={c.art.src}
                alt=""
                width={c.art.w}
                height={c.art.h}
                className="absolute"
                style={{ left: c.sphere, top: c.sphereTop }}
              />
              <p
                className="absolute w-[244px] whitespace-pre-wrap text-[20px] leading-[24px] text-black"
                style={{ left: c.body, top: 1375 }}
              >
                {c.bodyText}
              </p>
            </Fragment>
          ))}

          <p className="absolute left-[96px] top-[1575px] w-[876px] whitespace-pre-wrap font-serif text-[60px] font-normal leading-[60px] text-black">
            Proof over marketing. Recompute our index in your browser.
          </p>

          <div className={`absolute left-[55px] top-[2078px] h-px w-[1618px] ${LINE}`} />
          {DIVIDER_X.map((x) => (
            <div key={x} className={`absolute top-[1814px] h-[265px] w-px ${LINE}`} style={{ left: x - 1 }} />
          ))}
          {TICKS.map((x) => (
            <div key={x} className={`absolute top-[2039px] h-[40px] w-px ${LINE}`} style={{ left: x - 1 }} />
          ))}
          {COLUMN_COPY.map((c) => (
            <Fragment key={c.x}>
              <p
                className="absolute whitespace-pre text-[20px] leading-[24px] text-[#1E1E1E]"
                style={{ left: c.x, top: 1816 }}
              >
                {c.head}
              </p>
              <p
                className="absolute w-[199px] whitespace-pre-wrap text-[20px] leading-[24px] text-black"
                style={{ left: c.x, top: 1850 }}
              >
                {c.bodyText}
              </p>
            </Fragment>
          ))}

          <div
            className="absolute left-[55px] top-[2151px] h-[539px] w-[1617px] bg-cover"
            style={{
              backgroundImage: "url(/images/panorama.png)",
              filter: "contrast(98%) saturate(0%)",
            }}
          />
          <div className="absolute left-[1199px] top-[2081px] h-[137px] w-[407px] bg-[#1743FF] opacity-30" />
          <div className="absolute left-[137px] top-[2610px] h-[137px] w-[407px] bg-[#1743FF] opacity-30" />
          <div className="absolute left-[55px] top-[2690px] h-[113px] w-[540px] border-2 border-[#A1A1A1]" />
          <div className="absolute left-[593px] top-[2690px] h-[113px] w-[540px] border-2 border-[#A1A1A1]" />
          <div className="absolute left-[1131px] top-[2690px] h-[113px] w-[543px] border-2 border-[#A1A1A1]" />

          <h2 className="absolute left-[103px] top-[2846px] whitespace-pre font-serif text-[60px] font-normal leading-[72px] text-black">
            How it works
          </h2>
          <p className="absolute left-[103px] top-[2952px] w-[1449px] whitespace-pre-wrap text-[25px] font-medium leading-[30px] text-[#757575]">
            {HOW_IT_WORKS}
          </p>

          <div className="absolute left-[413px] top-[3427px] h-[658px] w-[1315px] bg-cover bg-center" style={{ backgroundImage: "url(/images/goddess.png)" }} />
          <div className="absolute left-[138px] top-[3384px] flex w-[119px] flex-col gap-[5px] text-[20px] text-[#1E1E1E]">
            <p className="leading-[36px]">Socials</p>
            <p className="leading-[30px]">Twitter X</p>
            <p className="leading-[30px]">Telegram</p>
            <p className="leading-[30px]">HashScan</p>
          </div>
          <div className="absolute left-[138px] top-[3576px] flex gap-[50px] text-[20px] leading-[24px] text-[#757575]">
            <a href="https://github.com/0xsoydev/celestial-trade/blob/develop/docs/plan.md">Plan</a>
            <a href="https://github.com/0xsoydev/celestial-trade">README</a>
            <Link href="/receipts">Receipts</Link>
          </div>
        </div>
      </div>
    </main>
  );
}
