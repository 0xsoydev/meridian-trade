export function Panorama({ variant }: { variant: "page" | "canvas" }) {
  if (variant === "page") {
    return (
      <section className="relative mt-16">
        <div
          className="h-[230px] w-full bg-cover"
          style={{
            backgroundImage: "url(/images/panorama.webp)",
            filter: "contrast(98%) saturate(0%)",
          }}
        />
        <div className="absolute -top-7 right-0 h-[80px] w-2/5 bg-[#1743FF] opacity-30" />
        <div className="absolute -bottom-5 left-0 h-[80px] w-2/5 bg-[#1743FF] opacity-30" />
      </section>
    );
  }

  return (
    <>
      <div
        className="absolute left-[55px] top-[2151px] h-[539px] w-[1617px] bg-cover"
        style={{
          backgroundImage: "url(/images/panorama.webp)",
          filter: "contrast(98%) saturate(0%)",
        }}
      />
      <div className="absolute left-[1199px] top-[2081px] h-[137px] w-[407px] bg-[#1743FF] opacity-30" />
      <div className="absolute left-[137px] top-[2610px] h-[137px] w-[407px] bg-[#1743FF] opacity-30" />
      <div className="absolute left-[55px] top-[2690px] h-[113px] w-[540px] border-2 border-[#A1A1A1]" />
      <div className="absolute left-[593px] top-[2690px] h-[113px] w-[540px] border-2 border-[#A1A1A1]" />
      <div className="absolute left-[1131px] top-[2690px] h-[113px] w-[543px] border-2 border-[#A1A1A1]" />
    </>
  );
}
