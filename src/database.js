import config from "./config.js";
import Knex from "knex";

export const knex = Knex(config.knex);

await knex.migrate.latest();