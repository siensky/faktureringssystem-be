import postgres from "postgres";



const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is missing in .env");
}

const db = postgres(DATABASE_URL);

export default db;