export function HowItWorks({ variant }: { variant: "page" | "canvas" }) {
  if (variant === "page") {
    return (
      <section className="mt-16 border-t border-[#CECECE] px-6 pb-6 pt-10">
        <h2 className="font-serif text-[34px] leading-[1.1] text-black">How it works</h2>
      </section>
    );
  }

  return (
    <h2 className="absolute left-[103px] top-[2846px] whitespace-pre font-serif text-[60px] font-normal leading-[72px] text-black">
      How it works
    </h2>
  );
}
