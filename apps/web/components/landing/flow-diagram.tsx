const PROVIDERS = [
  { name: "0G iAI", logo: "/images/rails/0g.svg", wide: true },
  { name: "Anthropic", logo: "/images/rails/anthropic.svg", wide: false },
  { name: "OpenAI", logo: "/images/rails/openai.svg", wide: false },
  { name: "OpenRouter", logo: "/images/rails/openrouter.svg", wide: false },
  { name: "Command Code", logo: "/images/rails/commandcode.svg", wide: false },
  { name: "OpenCode Zen", logo: "/images/rails/opencode.svg", wide: false },
  { name: "OpenCode Go", logo: "/images/rails/opencode.svg", wide: false },
] as const;

const ROW_START = 48;
const ROW_STEP = 40;
const AXIS = 168;

function Diagram() {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-[10px] font-medium tracking-[0.16em] text-[#757575] uppercase">Providers</p>
        <p className="text-[10px] font-medium tracking-[0.16em] text-[#757575] uppercase">Humans / agents</p>
      </div>

      <svg
        viewBox="0 0 1080 320"
        className="mt-3 block w-full"
        role="img"
        aria-label="Providers merge at Meridian, which serves humans and agents"
      >
        {PROVIDERS.map((provider, index) => {
          const y = ROW_START + index * ROW_STEP;
          return (
            <g key={`${provider.name}-${index}`} className="group">
              <image
                href={provider.logo}
                x={provider.wide ? 16 : 22}
                y={y - 8}
                width={provider.wide ? 30 : 16}
                height={provider.wide ? 15 : 16}
                style={{ filter: "brightness(0)" }}
                opacity="0.8"
              />
              <text x="60" y={y + 4} className="fill-[#757575] text-[12px] group-hover:fill-[#1E1E1E]">
                {provider.name}
              </text>
              <circle cx="170" cy={y} r="2" className="fill-[#C9C9C9] group-hover:fill-[#1743FF]" />
              <path
                d={`M170 ${y} H 470 L 560 ${AXIS}`}
                fill="none"
                strokeWidth="1"
                className="stroke-[#D9D9D9] transition-colors group-hover:stroke-[#1743FF]"
              />
            </g>
          );
        })}

        <rect x="560" y="103" width="150" height="130" className="fill-white stroke-[#E4E4E4]" strokeWidth="1" />
        <path d="M554 109 V97 H566" fill="none" strokeWidth="1" className="stroke-[#1743FF]" />
        <path d="M704 97 H716 V109" fill="none" strokeWidth="1" className="stroke-[#1743FF]" />
        <path d="M554 227 V239 H566" fill="none" strokeWidth="1" className="stroke-[#1743FF]" />
        <path d="M716 227 V239 H704" fill="none" strokeWidth="1" className="stroke-[#1743FF]" />

        <text
          x="635"
          y="164"
          textAnchor="middle"
          className="fill-[#1E1E1E] text-[13px] font-semibold tracking-[0.18em]"
        >
          MERIDIAN
        </text>
        <text x="635" y="183" textAnchor="middle" className="fill-[#757575] text-[10px] tracking-[0.12em]">
          ROUTER
        </text>

        <circle cx="710" cy={AXIS} r="3.5" className="fill-[#1743FF]" />
        <path d={`M710 ${AXIS} H 800`} fill="none" strokeWidth="1.5" className="stroke-[#1743FF]" />

        <rect x="800" y="138" width="250" height="60" className="fill-white stroke-[#E4E4E4]" strokeWidth="1" />
        <text
          x="925"
          y="173"
          textAnchor="middle"
          className="fill-[#1E1E1E] text-[13px] font-semibold tracking-[0.14em]"
        >
          HUMANS / AGENTS
        </text>
      </svg>

      <p className="mt-3 text-[13px] leading-5 text-[#757575]">
        providers list the capacity they cannot cash out · meridian prices and routes it · humans and agents
        buy it at the ask
      </p>
    </div>
  );
}

export function FlowDiagram({ variant }: { variant: "page" | "canvas" }) {
  if (variant === "canvas") {
    return (
      <div className="absolute left-[575px] top-[590px] w-[1080px]">
        <Diagram />
      </div>
    );
  }

  return (
    <section className="mt-16 border-t border-[#CECECE] px-6 pt-10">
      <div className="overflow-x-auto">
        <div className="min-w-[760px]">
          <Diagram />
        </div>
      </div>
    </section>
  );
}
