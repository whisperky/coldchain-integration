import { connect } from "../src/db.js";
import { processEvent } from "../src/ingest.js";

const sql = connect();
const events = await sql`
  select e.id, e.payload, k.id as key_id, k.name, k.account_ids
  from tive_events e join api_keys k on k.id = e.api_key_id
  where e.status = 'received'
  order by e.received_at`;

for (const event of events) {
  const key = { id: event.key_id, name: event.name, account_ids: event.account_ids };
  try {
    const { body } = await processEvent(sql, key, event.id, event.payload);
    console.log(event.id, body.status);
  } catch (error) {
    console.error(event.id, String(error));
  }
}
await sql.end();
