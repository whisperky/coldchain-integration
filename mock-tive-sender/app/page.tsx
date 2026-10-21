import { API_BASE_URL } from "../lib/config";
import { Sender } from "./sender";

export default function Page() {
  return <Sender apiBaseUrl={API_BASE_URL} />;
}
