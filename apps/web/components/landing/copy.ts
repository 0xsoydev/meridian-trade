export const DEMO_HREF = "/trade?model=glm-5.3";

export const CARDS = [
  { card: 589, label: 613, body: 613, sphere: 631, sphereTop: 1052, title: "01/ expiring supply", bodyText: "0G credits reset at midnight, plan allowances monthly. Sell what expires — always under list price, by rule.", art: { src: "/images/1st.svg", w: 252, h: 248 } },
  { card: 947, label: 970, body: 972, sphere: 987, sphereTop: 1052, title: "02/ agents pay", bodyText: "No account, no card. A request that can't be covered answers with a price; the agent pays USDC on Hedera and streams on.", art: { src: "/images/2nd.svg", w: 257, h: 247 } },
  { card: 1305, label: 1324, body: 1324, sphere: 1349, sphereTop: 1078, title: "03/ one human", bodyText: "World ID keeps supply human: one seller per person, and a person approves an agent's spending cap.", art: { src: "/images/3rd.svg", w: 249, h: 210 } },
];

export const COLUMN_COPY = [
  { x: 171, head: "Every fill names its rail", bodyText: "0G runs the demo rail, with request ids in the receipts." },
  { x: 461, head: "Every payment is public", bodyText: "Top-ups settle as USDC transfers on Hedera with a HashScan link." },
  { x: 757, head: "Supply stays human", bodyText: "One seller per World-verified person; denials are shown too." },
  { x: 1047, head: "The index recomputes", bodyText: "Per-minute public rollups; rebuild them on /receipts yourself." },
  { x: 1344, head: "The curve is settled", bodyText: "Perps clear against the house vault at 5x, funding on skew." },
];

export const HOW_IT_WORKS = `01 A seller lists capacity: World-verified, key capped, ask below list.
02 An agent with $0 asks for a completion; the venue answers with what it needs; the agent pays USDC; it streams.
03 Traders clear the book — fills print to the public log, the index moves.
04 The index becomes a market: short to lock tomorrow's revenue, or long to cap cost.`;

export const LINE = "bg-[#CECECE]";
