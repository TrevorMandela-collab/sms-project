const path = require("path");

process.env.DATABASE_URL = "";
process.env.SQLITE_PATH = path.join(__dirname, "data", "qa-dev.sqlite");

require("./server");
