import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

try {
  const envPath = join(__dirname, "..", ".env.local");
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {}

const base = process.argv[2] ?? "http://localhost:3000";
const sql = neon(process.env.adore_DATABASE_URL);

const variantRows = await sql`
  SELECT v.id, p.slug FROM product_variants v
  JOIN products p ON p.id = v.product_id
  WHERE v.is_active AND v.stock_quantity > 0 AND p.status = 'ACTIVE'
  LIMIT 1
`;
const variantId = variantRows[0].id;
console.log("using variant:", variantId, "of", variantRows[0].slug);

const cookieJar = {};
function cookieHeader() {
  return Object.entries(cookieJar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}
function storeCookies(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const c of raw) {
    const [pair] = c.split(";");
    const idx = pair.indexOf("=");
    cookieJar[pair.slice(0, idx)] = pair.slice(idx + 1);
  }
}
async function api(path, options = {}) {
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: { ...(options.headers ?? {}), cookie: cookieHeader() },
  });
  storeCookies(res);
  const data = await res.json();
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

const empty = await api("/api/cart");
console.log("empty cart:", empty.itemCount, empty.subtotal);

const added = await api("/api/cart/items", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ variantId, quantity: 2 }),
});
console.log("after add:", added.itemCount, added.subtotal, added.items[0].name, added.items[0].size, added.items[0].color);

const again = await api("/api/cart/items", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ variantId, quantity: 1 }),
});
console.log("after re-add (deduped line, qty incremented):", again.itemCount, again.subtotal, "lines:", again.items.length);

const itemId = again.items[0].id;
const patched = await api(`/api/cart/items/${itemId}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ quantity: 1 }),
});
console.log("after patch to 1:", patched.itemCount);

const removed = await api(`/api/cart/items/${itemId}`, { method: "DELETE" });
console.log("after remove:", removed.itemCount);

const cleared = await api("/api/cart", { method: "DELETE" });
console.log("after clear:", cleared.itemCount);

console.log("cart API smoke test passed");
