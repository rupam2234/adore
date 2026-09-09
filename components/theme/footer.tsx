export default function Footer() {
  return (
    <footer className="flex w-full flex-col gap-4 px-6 py-10 text-sm text-[#2B2620]/60 sm:flex-row sm:items-center sm:justify-between sm:px-12">
      <span>© {new Date().getFullYear()} Adore</span>
      <div className="flex gap-6">
        <a href="#" className="hover:text-[#2B2620]">
          Instagram
        </a>
        <a href="#" className="hover:text-[#2B2620]">
          Shipping
        </a>
        <a href="#" className="hover:text-[#2B2620]">
          Contact
        </a>
      </div>
    </footer>
  );
}
