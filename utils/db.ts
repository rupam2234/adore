import { neon } from "@neondatabase/serverless";

if (!process.env.adore_DATABASE_URL) {
    throw new Error("DATABASE_URL is not defined");
}

export const pool = neon(process.env.adore_DATABASE_URL);