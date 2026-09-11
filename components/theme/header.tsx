import Link from "next/link";

type HeaderData = {
  title: string;
  navItems: { title: string; url: string }[];
};

const HEADER_DATA: HeaderData = {
  title: "Adore",
  navItems: [
    { title: "Our story", url: "/" },
    { title: "How it's made", url: "/" },
    { title: "Shop", url: "/" },
  ],
};

export default function Header() {
  return (
    <header className="sticky top-0 z-50 flex w-full items-center justify-between border-b border-[#2B2620]/10 bg-[#FAF8F3]/90 px-6 py-5 backdrop-blur-md sm:px-12">
      <Link
        href="/"
        className="font-semibold text-3xl tracking-tight text-primary/80 transition-colors"
      >
        {HEADER_DATA.title}
      </Link>
      <nav className="hidden gap-8 text-sm sm:flex">
        {HEADER_DATA?.navItems.map((item) => {
          return (
            <a
              key={item.title}
              href={item.url}
              className="group relative inline-block hover:text-[#5C6B4B]"
            >
              {item.title}
              <span className="absolute -bottom-1 left-0 h-px w-full origin-left scale-x-0 bg-[#5C6B4B] transition-transform duration-300 ease-out group-hover:scale-x-100" />
            </a>
          );
        })}
      </nav>
      <a
        href="#shop"
        className="rounded-full border border-[#2B2620] px-5 py-2 text-sm transition-colors hover:bg-[#2B2620] hover:text-[#FAF8F3]"
      >
        Shop the collection
      </a>
    </header>
  );
}
