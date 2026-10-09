async function up({ execute }) {
  await execute("DROP TABLE IF EXISTS store");
}

module.exports = { up };
