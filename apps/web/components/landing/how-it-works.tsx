import { HOW_IT_WORKS } from "./copy";

export function HowItWorks({ variant }: { variant: "page" | "canvas" }) {
  if (variant === "page") {
    return (
      <section className="mt-16 border-t border-[#CECECE] px-6 pb-14 pt-10">
        <h2 className="font-serif text-[34px] leading-[1.1] text-black">How it works</h2>
        <p className="mt-6 whitespace-pre-wrap text-[16px] leading-[26px] text-[#757575]">
          {HOW_IT_WORKS}
        </p>
      </section>
    );
  }

  return (
    <>
      <h2 className="absolute left-[103px] top-[2846px] whitespace-pre font-serif text-[60px] font-normal leading-[72px] text-black">
        How it works
      </h2>
      <p className="absolute left-[103px] top-[2952px] w-[1449px] whitespace-pre-wrap text-[25px] font-medium leading-[30px] text-[#757575]">
        {HOW_IT_WORKS}
      </p>
    </>
  );
}
