import Link from "next/link";

const NAV_LINKS = [
  { label: "Home", href: "/" },
  { label: "Features", href: "/perps" },
  { label: "How it works", href: "/receipts" },
  { label: "Contact us", href: "/keys" },
];

const DEMO_HREF = "/trade?model=glm-5.3";

const CARDS = [
  { card: 589, label: 613, body: 613, sphere: 631, sphereTop: 1052, title: "01/ converstional", art: { src: "/images/1st.svg", w: 252, h: 248 } },
  { card: 947, label: 970, body: 972, sphere: 987, sphereTop: 1052, title: "02/ connected", art: { src: "/images/2nd.svg", w: 257, h: 247 } },
  { card: 1305, label: 1324, body: 1324, sphere: 1349, sphereTop: 1078, title: "03/ compliant", art: { src: "/images/3rd.svg", w: 249, h: 210 } },
];

const CARD_BODY =
  "Natural conversations that understand context and move customers forward.";

const DIVIDER_X = [138, 428, 718, 1008, 1298, 1588];
const TICKS = Array.from({ length: 24 }, (_, k) => 196 + 58 * k).filter(
  (x) => !DIVIDER_X.includes(x),
);
const COLUMNS = [171, 461, 757, 1047, 1344];

const LOREM = `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. 
Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.`;

const LINE = "bg-[#CECECE]";

const COLOSSEUM_FILTER = "brightness(112%) contrast(92%)";

export default function Home() {
  return (
    <main className="bg-white">
      <div className="lg:hidden">
        <nav className="flex flex-wrap items-center justify-center gap-x-7 gap-y-2 border-b border-[#CECECE] px-6 py-4 text-[15px] leading-[20px] text-[#1E1E1E]">
          {NAV_LINKS.map((link) => (
            <Link key={link.label} href={link.href}>
              {link.label}
            </Link>
          ))}
        </nav>

        <section className="px-6 pt-10">
          <div
            className="h-[210px] w-full bg-cover bg-top"
            style={{ backgroundImage: "url(/images/colosseum.svg)", filter: COLOSSEUM_FILTER }}
          />
          <h1 className="mt-9 font-serif text-[44px] leading-[1.06] text-[#1E1E1E]">
            Build lasting relationships
          </h1>
          <p className="mt-5 text-[16px] leading-[24px] text-black">
            conversational AI platform for modern financial institution agents
            that handle the full borrows lifecycle across mail, SMS, and voice
          </p>
          <Link
            href={DEMO_HREF}
            className="mt-7 inline-flex h-[46px] items-center rounded-[6px] bg-black px-9 text-[16px] text-white"
          >
            Book a demo
          </Link>
        </section>

        <section className="mt-16 border-t border-[#CECECE] px-6 pt-10">
          <p className="text-[15px] text-black">[ what we do ]</p>
          <h2 className="mt-5 font-serif text-[34px] leading-[1.1] text-[#1E1E1E]">
            Conversation that build momentum
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
                <p className="text-[16px] leading-[24px] text-black">{CARD_BODY}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-16 border-t border-[#CECECE] px-6 pt-10">
          <h2 className="font-serif text-[32px] leading-[1.12] text-black">
            Built like infrastructure. Query it, extend it, and trust what it
            returns.
          </h2>
          <div className="mt-8 border-b border-[#CECECE]">
            {COLUMNS.map((x) => (
              <div key={x} className="border-t border-[#CECECE] py-5">
                <p className="text-[15px] leading-[22px] text-[#1E1E1E]">Read your own writes</p>
                <p className="mt-1 text-[15px] leading-[22px] text-black">
                  The first CRM with external consistency.
                </p>
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
            {LOREM}
          </p>
        </section>

        <footer className="border-t border-[#CECECE] bg-[#EBEBEB] px-6 pb-10 pt-12">
          <div className="flex gap-16 text-[16px] text-[#1E1E1E]">
            <div className="flex flex-col gap-1.5">
              <p>Socials</p>
              <p>Twitter X</p>
              <p>Instagram</p>
              <p>Linkedin</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <p>About Us</p>
              <p>contact us</p>
              <p>Services</p>
            </div>
          </div>
          <div className="mt-10 flex flex-wrap gap-x-8 gap-y-3 text-[15px] leading-[22px] text-[#757575]">
            <span>Privacy Policy</span>
            <span>Cookie Policy</span>
            <span>Terms of Use</span>
          </div>
          <div
            className="mt-8 h-[220px] w-full bg-contain bg-center bg-no-repeat"
            style={{ backgroundImage: "url(/images/goddess.png)" }}
          />
        </footer>
      </div>

      <div className="desktop-wrap hidden lg:block">
        <div className="desktop-canvas relative h-[4081px] w-[1728px] overflow-hidden bg-white">
          <div
            className="absolute left-0 top-0 h-[1184px] w-[1728px]"
            style={{
              backgroundImage: "url(/images/colosseum.svg)",
              backgroundSize: "100% 100%",
              filter: COLOSSEUM_FILTER,
            }}
          />

          <div className="absolute left-[55px] top-[3351px] h-[286px] w-[1617px] border border-[#CECECE] bg-[#EBEBEB]" />

          <div className={`absolute left-[54px] top-0 h-[4081px] w-px ${LINE}`} />
          <div className={`absolute left-[1671px] top-[90px] h-[3991px] w-px ${LINE}`} />

          <h1 className="absolute left-[641px] top-[175px] whitespace-pre font-serif text-[100px] font-normal leading-[100px] text-[#1E1E1E]">
            {"Build lasting\nrelationships"}
          </h1>
          <p className="absolute left-[641px] top-[384px] w-[494px] whitespace-pre-wrap text-[20px] leading-[24px] text-black">
            {"conversational AI platform for modern  financial institution agents that handle the full borrows lifecycle across mail , SMS , and voice"}
          </p>
          <Link
            href={DEMO_HREF}
            className="absolute left-[717px] top-[488px] flex h-[43px] w-[294px] items-center justify-center rounded-[6px] bg-black"
          >
            <span className="text-[20px] leading-[24px] text-white">Book a demo</span>
          </Link>

          <div className="absolute left-[575px] top-[726px] h-[821px] w-[1080px] bg-white" />

          <p className="absolute left-[610px] top-[717px] whitespace-pre text-[20px] leading-[100px] text-black">
            [ what we do ]
          </p>
          <div className={`absolute left-[1632px] top-[946px] h-[1044px] w-px ${LINE}`} />
          <div className={`absolute left-[990px] top-[726px] h-[477px] w-px ${LINE}`} />
          <h2 className="absolute left-[610px] top-[808px] whitespace-pre font-serif text-[60px] font-normal leading-[60px] text-[#1E1E1E]">
            {"Conversation that\nbuild momentum"}
          </h2>

          {CARDS.map((c) => (
            <div
              key={c.card}
              className="absolute top-[965px] h-[547px] w-[336px] border border-[#CECECE] bg-[#EBEBEB]"
              style={{ left: c.card }}
            />
          ))}
          {CARDS.map((c) => (
            <p
              key={c.title}
              className="absolute whitespace-pre text-[20px] leading-[24px] text-[#1E1E1E]"
              style={{ left: c.label, top: 987 }}
            >
              {c.title}
            </p>
          ))}
          {CARDS.map((c) => (
            <img
              key={c.title}
              src={c.art.src}
              alt=""
              width={c.art.w}
              height={c.art.h}
              className="absolute"
              style={{ left: c.sphere, top: c.sphereTop }}
            />
          ))}
          {CARDS.map((c) => (
            <p
              key={`body-${c.title}`}
              className="absolute w-[244px] whitespace-pre-wrap text-[20px] leading-[24px] text-black"
              style={{ left: c.body, top: 1375 }}
            >
              {CARD_BODY}
            </p>
          ))}

          <p className="absolute left-[96px] top-[1575px] w-[876px] whitespace-pre-wrap font-serif text-[60px] font-normal leading-[60px] text-black">
            Built like infrastructure. Query it, extend it, and trust what it returns.
          </p>

          <div className={`absolute left-[55px] top-[2078px] h-px w-[1618px] ${LINE}`} />
          {DIVIDER_X.map((x) => (
            <div key={x} className={`absolute top-[1814px] h-[265px] w-px ${LINE}`} style={{ left: x - 1 }} />
          ))}
          {TICKS.map((x) => (
            <div key={x} className={`absolute top-[2039px] h-[40px] w-px ${LINE}`} style={{ left: x - 1 }} />
          ))}
          {COLUMNS.map((x) => (
            <p
              key={`h-${x}`}
              className="absolute whitespace-pre text-[20px] leading-[24px] text-[#1E1E1E]"
              style={{ left: x, top: 1816 }}
            >
              Read your own writes
            </p>
          ))}
          {COLUMNS.map((x) => (
            <p
              key={`b-${x}`}
              className="absolute w-[199px] whitespace-pre-wrap text-[20px] leading-[24px] text-black"
              style={{ left: x, top: 1850 }}
            >
              The first CRM with external consistency.
            </p>
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
            {LOREM}
          </p>

          <nav className="absolute left-[1116px] top-[37px] flex h-[24px] items-center gap-[39px] text-[20px] leading-[24px] text-[#1E1E1E]">
            {NAV_LINKS.map((link) => (
              <Link key={link.label} href={link.href}>
                {link.label}
              </Link>
            ))}
          </nav>
          <div className={`absolute left-[1049px] top-[92px] h-px w-[623px] ${LINE}`} />
          <div className={`absolute left-[1048px] top-[92px] h-[92px] w-px ${LINE}`} />

          <div className="absolute left-[413px] top-[3427px] h-[658px] w-[1315px] bg-cover bg-center" style={{ backgroundImage: "url(/images/goddess.png)" }} />
          <div className="absolute left-[138px] top-[3384px] flex w-[119px] flex-col gap-[5px] text-[20px] text-[#1E1E1E]">
            <p className="leading-[36px]">Socials</p>
            <p className="leading-[30px]">Twitter X</p>
            <p className="leading-[30px]">Instagram</p>
            <p className="leading-[30px]">Linkedin</p>
          </div>
          <div className="absolute left-[341px] top-[3384px] flex w-[139px] flex-col gap-[6px] text-[20px] text-[#1E1E1E]">
            <p className="leading-[36px]">About Us</p>
            <p className="leading-[30px]">contact us</p>
            <p className="leading-[30px]">Services</p>
          </div>
          <div className="absolute left-[138px] top-[3576px] flex gap-[50px] text-[20px] leading-[24px] text-[#757575]">
            <span>Privacy Policy</span>
            <span>Cookie Policy</span>
            <span>Terms of Use</span>
          </div>
        </div>
      </div>
    </main>
  );
}
