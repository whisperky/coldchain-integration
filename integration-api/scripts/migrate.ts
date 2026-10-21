import { connect, migrate } from "../src/db.js";

const sql = connect();
const applied = await migrate(sql);
console.log(applied.length ? `Applied ${applied.join(", ")}` : "No pending migrations");
await sql.end();
