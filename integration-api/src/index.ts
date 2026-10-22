import { Hono } from "hono";
import { createApp } from "./api.js";
import { connect } from "./db.js";

// Vercel's Hono preset only accepts an entrypoint that imports hono.
export default new Hono().route("/", createApp(connect()));
