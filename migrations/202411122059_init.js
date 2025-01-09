/**
 * @param {import("knex").Knex} knex
 * @returns {Promise<void>}
 */
export async function up(knex) {
    await knex.schema
        .createTable("requestLogs", (table) => {
            table.uuid("requestLogId").notNullable().primary();
            table.string("serverType", 32).notNullable().index();
            table.datetime("datetime").notNullable().index();
            table.string("method", 8).notNullable();
            table.text("url").notNullable().index();
            table.integer("statusCode").notNullable();
            table.float("duration").notNullable();
            table.jsonb("requestHeaders").notNullable();
            table.binary("requestBody").nullable();
            table.jsonb("responseHeaders").notNullable();
            table.binary("responseBody").nullable();
        })
        .createTable("keyValues", (table) => {
            table.uuid("requestLogId").notNullable().references("requestLogs.requestLogId").onDelete("cascade");
            table.string("type", 16).notNullable();
            table.text("key").notNullable().index();
            table.text("value").notNullable().index();
            table.primary(["requestLogId", "key"]);
        });
}

/**
 * @param {import("knex").Knex} knex
 * @returns {Promise<void>}
 */
export async function down(knex) {
    await knex.schema
        .dropTable("requestLogs")
        .dropTable("keyValues");
}