// Re-fetch shop listings at most every 5 minutes (ISR)
export const revalidate = 300;

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return children;
}