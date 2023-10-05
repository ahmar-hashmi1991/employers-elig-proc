const mysql = require('mysql2/promise');
const secrets = require('./secrets-service');
const logger = require('./log-service');

const secretName = `${process.env.STAGE}-employers-claims-mysql`

class Database {
    constructor() {
        if (!Database.instance) {
            logger.info(`Creating Database instance...`);
            Database.instance = this;

            this.promise = initDB();
        }

        return Database.instance;
    }
}

async function initDB(){
    let secret = await secrets.getSecretValue(secretName);
    let connectionConfig = {
        host     : secret.host,
        user     : secret.username,
        port     : secret.port,
        password: secret.password,
        database : secret.database
    };

    logger.info(`Connecting to ${secret.database}... >>`);
    let connection = await mysql.createConnection(connectionConfig)
    logger.info(`Connected to ${connection.threadId}... <<`);
    return connection;
}

function buildUpdateQuery(obj) {
    let qb = Object.keys(obj).reduce((out, field) => {
        out.q.push(`${field} = ?`);
        out.v.push(obj[field]);
        return out;
    }, {q: [], v:[]});

    return [qb.q.join(','), qb.v];
}

module.exports = {
    getAccountByFolder: async (folder) => {
        const db = await new Database().promise;
        return db.query('SELECT * FROM accounts where folder = ?', folder);
    },
    getAccount: async (id) => {
        const db = await new Database().promise;
        return db.query('SELECT * FROM accounts where id = ?', id);
    },
    createFileHistoryLog: async (account_id, file_name, folder, status) => {
        const db = await new Database().promise;
        let [result] = await db.query(`INSERT INTO claims_file_history SET ?`, { account_id, file_name, folder, status });
        await db.query(`INSERT INTO claims_file_log SET ?`, { files_history_id: result.insertId, type: 'log', activity: 'new', notes: `new claims file ${file_name}` });
        return result;
    },
    updateFileHistoryLog: async (id, status) => {
        const db = await new Database().promise;
        await db.query(`INSERT INTO claims_file_log SET ?`, { files_history_id: id, type: 'log', activity: 'status-update', notes: `status set to ${status}` });
        return db.query('UPDATE claims_file_history SET status = ? WHERE id = ?', [status, id]);
    },
    reportToFileLog: async (type, activity, notes, data, files_history_id) => {
        const db = await new Database().promise;
        return db.query(`INSERT INTO claims_file_log SET ?`, { files_history_id, type, activity, notes, data });
    },
    getPharmacyClaim: async (id) => {
        const db = await new Database().promise;
        return db.query('SELECT * FROM pharmacy_claims where claim_id = ?', id);
    },
    addNewPharmacyClaim: async (record) => {
        const db = await new Database().promise;
        return db.query(`INSERT INTO pharmacy_claims SET ?`, record);
    },
    updatePharmacyClaim: async (record, id) => {
        const db = await new Database().promise;
        let [fieldSet, valueSet] = buildUpdateQuery(record);
        return db.query(`UPDATE pharmacy_claims SET ${fieldSet} WHERE claim_id = ?`, [...valueSet, id]);
    },
    getFacilityClaim: async (id) => {
        const db = await new Database().promise;
        return db.query('SELECT * FROM facility_claims where claim_id = ?', id);
    },
    addNewFacilityClaim: async (record) => {
        const db = await new Database().promise;
        return db.query(`INSERT INTO facility_claims SET ?`, record);
    },
    updateFacilityClaim: async (record, id) => {
        const db = await new Database().promise;
        let [fieldSet, valueSet] = buildUpdateQuery(record);
        return db.query(`UPDATE facility_claims SET ${fieldSet} WHERE claim_id = ?`, [...valueSet, id]);
    },
    getProfessionalClaim: async (id) => {
        const db = await new Database().promise;
        return db.query('SELECT * FROM professional_claims where claim_id = ?', id);
    },
    addNewProfessionalClaim: async (record) => {
        const db = await new Database().promise;
        return db.query(`INSERT INTO professional_claims SET ?`, record);
    },
    updateProfessionalClaim: async (record, id) => {
        const db = await new Database().promise;
        let [fieldSet, valueSet] = buildUpdateQuery(record);
        return db.query(`UPDATE professional_claims SET ${fieldSet} WHERE claim_id = ?`, [...valueSet, id]);
    },
}