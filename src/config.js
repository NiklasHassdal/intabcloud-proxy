export default {
    host: process.env.HOST || "localhost",
    port: parseInt(process.env.PORT || "80"),

    // Available servers
    servers: {
        api:      process.env.API_HOST || "localhost:8080",
        ui:       process.env.UI_HOST || "localhost:8090",
        wisensys: process.env.WISENSYS_HOST || "localhost:9000",
        novus:    process.env.NOVUS_HOST || "localhost:9001",
        comet:    process.env.COMET_HOST || "localhost:9002",
        gprs:     process.env.GPRS_HOST || "localhost:9003",
    },

    // Request and response size limit for logging
    logLimits: {
        requestLogLimit:  parseInt(process.env.REQUEST_LOG_LIMIT || "1000000"),
        responseLogLimit: parseInt(process.env.RESPONSE_LOG_LIMIT || "100000"),
    },

    // Log retention in hours
    logRetention: {
        api:      parseInt(process.env.API_LOG_RETENTION || process.env.LOG_RETENTION || "168"),
        ui:       parseInt(process.env.UI_LOG_RETENTION || process.env.LOG_RETENTION || "168"),
        wisensys: parseInt(process.env.WISENSYS_LOG_RETENTION || process.env.LOG_RETENTION || "168"),
        novus:    parseInt(process.env.NOVUS_LOG_RETENTION || process.env.LOG_RETENTION || "168"),
        comet:    parseInt(process.env.COMET_LOG_RETENTION || process.env.LOG_RETENTION || "168"),
        gprs:     parseInt(process.env.GPRS_LOG_RETENTION || process.env.LOG_RETENTION || "168"),
    },

    // Database config
    knex: {
        client:     "pg",
        connection: {
            host:     process.env.POSTGRES_HOST ?? "localhost",
            port:     parseInt(process.env.POSTGRES_PORT ?? "5432"),
            user:     process.env.POSTGRES_USER ?? "postgres",
            password: process.env.POSTGRES_PASSWORD ?? "postgres",
            database: process.env.POSTGRES_DB ?? "intabcloud_log",
        },
    },
};