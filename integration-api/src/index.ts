import { createApp } from "./api.js";
import { connect } from "./db.js";

export default createApp(connect());
