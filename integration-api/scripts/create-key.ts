import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { hashKey } from "../src/auth.js";
import { connect } from "../src/db.js";

const { values } = parseArgs({ options: { name: { type: "string" }, accounts: { type: "string" } } });
if (!values.name || !values.accounts) {
  console.error("Usage: npm run key:create -- --name <name> --accounts 478,999");
  process.exit(1);
}

const key = `pxk_${randomBytes(32).toString("base64url")}`;
const accounts = values.accounts.split(",").map(Number);
const sql = connect();
await sql`insert into api_keys (name, key_hash, account_ids) values (${values.name}, ${hashKey(key)}, ${accounts})`;
await sql.end();
console.log(key);
