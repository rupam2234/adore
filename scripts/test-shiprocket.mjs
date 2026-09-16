// Temporary debug script: replicates utils/shipping.ts calls outside Next.
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => {
  const m = env.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?`, "m"));
  return m ? m[1] : undefined;
};
const email = get("SHIPROCKET_EMAIL");
const password = get("SHIPROCKET_PASSWORD");
console.log("email:", email, "| password len:", password?.length);

const loginRes = await fetch(
  "https://apiv2.shiprocket.in/v1/external/auth/login",
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  },
);
console.log("login status:", loginRes.status);
const loginBody = await loginRes.json();
console.log("login token?", Boolean(loginBody.token), loginBody.message ?? "");

if (loginBody.token) {
  const srvRes = await fetch(
    "https://apiv2.shiprocket.in/v1/external/courier/serviceability/?pickup_postcode=560001&delivery_postcode=560001&cod=1&order_weight=0.5",
    { headers: { Authorization: `Bearer ${loginBody.token}` } },
  );
  console.log("serviceability status:", srvRes.status);
  const srvBody = await srvRes.json();
  console.log(
    "couriers:",
    srvBody?.data?.available_courier_companies?.length ?? "none",
  );
}
