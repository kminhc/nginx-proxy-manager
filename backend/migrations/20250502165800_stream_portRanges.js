const migrate_name = 'stream_port_ranges';
const logger       = require('../logger').migrate;

/**
 * Migrate
 *
 * @see http://knexjs.org/#Schema
 *
 * @param   {Object} knex
 * @returns {Promise}
 */
exports.up = async function  (knex) {
	logger.info('[' + migrate_name + '] Migrating Up...');

	await knex.schema.table('stream', (table) => {
		table.integer('incoming_port').notNull().alter();
		table.integer('forwarding_port').notNull().alter();

	});

	await knex.schema.table('stream', (table) => {
		table.integer('incoming_port_from');
		table.integer('incoming_port_to');
		table.integer('forwarding_port_from');
		table.integer('forwarding_port_to');
	});

	// Copy values from old columns into the new range columns
	await knex('stream').update({
		incoming_port_from: knex.ref('incoming_port'),
		incoming_port_to: knex.ref('incoming_port'),
		forwarding_port_from: knex.ref('forwarding_port'),
		forwarding_port_to: knex.ref('forwarding_port'),
	});

	// Drop the old columns
	await knex.schema.table('stream', (table) => {
		table.dropColumn('incoming_port');
		table.dropColumn('forwarding_port');
	});
};

/**
 * Undo Migrate
 *
 * @param   {Object} knex
 * @returns {Promise}
 */
exports.down = async function (knex) {
	await knex.schema.table('stream', (table) => {
		table.integer('incoming_port');
		table.integer('forwarding_port');
	});

	// Use "from" values to restore single-port data
	await knex('stream').update({
		incoming_port: knex.ref('incoming_port_from'),
		forwarding_port: knex.ref('forwarding_port_from'),
	});

	await knex.schema.table('stream', (table) => {
		table.dropColumn('incoming_port_from');
		table.dropColumn('incoming_port_to');
		table.dropColumn('forwarding_port_from');
		table.dropColumn('forwarding_port_to');
	});
};
