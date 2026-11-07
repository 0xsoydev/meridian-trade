import { LINE } from "./copy";

export function HowItWorks({ variant }: { variant: "page" | "canvas" }) {
  if (variant === "page") {
    return (
      <section className="mt-16 border-t border-[#CECECE] px-6 pb-6 pt-10">
        <h2 className="font-serif text-[34px] leading-[1.1] text-black">How it works</h2>
      </section>
    );
  }

  return (
    <>
      <div className={`absolute left-[55px] top-[1594px] h-px w-[1618px] ${LINE}`} />
      <h2 className="absolute left-[103px] top-[1653px] whitespace-pre font-serif text-[60px] font-normal leading-[72px] text-black">
        How it works
      </h2>
      <div className={`absolute left-[55px] top-[2159px] h-px w-[1618px] ${LINE}`} />
    </>
  );
}
