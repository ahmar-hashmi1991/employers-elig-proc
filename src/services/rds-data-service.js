const mysql = require('mysql2/promise');
const secrets = require('./secrets-service');
const constants = require('../common/constants');
const crypto = require('crypto');

const secretName = `${process.env.STAGE}-employers-elig-mysql`

class Database {
    constructor() {
        if (!Database.instance) {
            console.log(`Creating Database instance...`);
            Database.instance = this;

            this.promise = new Promise(function(resolve, reject) {
                initDB(resolve,reject);
            });
        }

        return Database.instance;
    }
}

async function initDB(resolve, reject){
    let secret = await secrets.getSecret(secretName);
    let connectionConfig = {
        host     : secret.host,
        user     : secret.username,
        port     : secret.port,
        password: secret.password,
        database : secret.database
    };
    // SSH tunneling if running lambda locally and having ssh credentials (ssh required if using DB outside the server)
    console.log('AWS SAM Local Value (Should be undefined or false in AWS environment) ---->>>> ', process.env.AWS_SAM_LOCAL)
    if( process.env.AWS_SAM_LOCAL && secret.sshHostV2 && secret.sshKeyV2 && secret.sshUserV2){
        console.log('Initiating SSH integration')
        let stream = await initSSH(secret);
        connectionConfig = {...connectionConfig, stream};
    }
    // SSH tunnel

    console.log('Connecting... >>');
    let connection = await mysql.createConnection(connectionConfig)
    console.log(`Connected to ${connection.threadId}... <<`);
    resolve(connection);
}

function initSSH(secret) {
    const { Client } = require('ssh2');
    const sshClient = new Client();
    const tunnelConfig = {
        host: secret.sshHostV2,
        port: 22,
        username: secret.sshUserV2,
        privateKey: Buffer.from(secret.sshKeyV2, 'base64')
    };
    const forwardConfig = {
        srcHost: '127.0.0.1',
        srcPort: 3306,
        dstHost: secret.host,
        dstPort: secret.port
    };

    return new Promise((resolve, reject) => {
        sshClient.on('ready', () => {
            sshClient.forwardOut(
                forwardConfig.srcHost,
                forwardConfig.srcPort,
                forwardConfig.dstHost,
                forwardConfig.dstPort,
                (err, stream) => {
                    if (err) reject(err);
                    resolve(stream);
                });
        }).connect(tunnelConfig);
    });
}

function buildInsertMany(records,key){
    try {
        const modifiedArray = records.map((record) => {
            const { id, ...rest } = record;
            return { ...rest, [key]:id };
          });
        const keysArray = Object.keys(modifiedArray[0]); // Assuming all objects have the same keys
        const valuesArray = modifiedArray.map((record) => Object.values(record));
        // Convert the array into the desired format
        const sqlFormattedData = valuesArray.map((row) => {
            const formattedRow = row.map(value => {
              if (value instanceof Date) {
                // Format date as 'YYYY-MM-DD HH:mm:ss'
                return value.toISOString().slice(0, 19).replace("T", " ");
              } else if (typeof value === 'string') {
                return `'${value}'`; // Add single quotes for string values
              } else {
                return value; // Keep other values as is
              }
            });
            return `(${formattedRow.join(', ')})`;
          }).join(', ');
        // const sqlFormattedData = valuesArray.map((row) => `(${row.map(value => typeof value === 'string' ? `'${value}'` : value).join(', ')})`).join(', ');
        return [keysArray.join(','), sqlFormattedData];
        
    } catch (error) {
        console.log(`error in buildInsertMany ${new Error(error).stack}`)
    }
}

function buildUpdateQuery(obj) {
    let qb = Object.keys(obj).reduce((out, field) => {
        out.q.push(`${field} = ?`);
        out.v.push(obj[field]);
        return out;
    }, {q: [], v:[]});

    return [qb.q.join(','), qb.v];
}

async function generateUniqueEid(){
    let uniqueString = generateShortId();
    const db = await new Database().promise;
    let [rows] = await db.query("SELECT count(*) as count FROM resellers WHERE eid = ?",uniqueString);
    if( rows.length !==0 && rows[0].count > 0 ){
       return await generateUniqueEid();
    }
    return uniqueString;
}

function generateShortId(){
    return crypto.randomBytes(3).toString('hex');
    // let hexString = uuid.v4();
    // hexString = hexString.replace(/[&\/\\#^+()$~%.'":*?<>{}!@]/g, "");
    // let base64String = Buffer.from(hexString, 'hex').toString('base64')
    // console.log("short id:", base64String.substring(0,6));
    // return base64String.substring(0,6);
}
function createNewEmployerData(resellerId, externalId, data){
    return {
        reseller_id : resellerId,
        external_id : externalId,
        name: data.name,
        structure: data.structure,
        mapping_rules: data.mapping_rules,
        eligibility_rules: data.eligibility_rules,
        ftp_info : data.ftp_info,
        record_source :data.record_source,
        parser_structure :data.parser_structure,
        folder :data.folder,
        file_name_filter :data.file_name_filter,
        insurance_claims :data.insurance_claims,
        insurance_claims_last_file :data.insurance_claims_last_file,
        external_ftp :data.external_ftp,
        support_phone :data.support_phone,
        support_email :data.support_email,
        launch_date :data.launch_date,
        b2b_link :data.b2b_link,
        kickoff_link :data.kickoff_link,
        epic_link :data.epic_link,
        lp_url :data.lp_url || '',
        status: data.status,
        is_ftp_sftp: data.is_ftp_sftp || 0,
    }

}

async function getNextEmployerExternalId(){
    const db = await new Database().promise;
    let [rows] = await db.query("SELECT max(external_id) AS external_id FROM employers WHERE external_id < 90000");
    let exID=1000;
    if(rows.length !==0){
        exID = Number(rows[0].external_id) + 1;
    }
    return exID;
}

// Function to generate unique id for admin user
async function getNextAdminUserId(){
    const db = await new Database().promise;
    let [rows] = await db.query("SELECT max(id) AS id FROM admin_users");
    let ID=1000;
    if(rows.length !==0){
        ID = Number(rows[0].id) + 1;
    }
    return ID;
}

module.exports = {
    getReseller: async (id) => {
        const db = await new Database().promise;
            return db.query('SELECT * FROM resellers where id = ?', id);
    },
    getResellerList: async () => {
        const db = await new Database().promise;
            return db.query(`SELECT eid,name,description,support_phone,support_email,created_at,b2b_link,kickoff_link,epic_link, mtb_features FROM resellers order by created_at asc`);
    },
    getResellerByExternalID: async (eid) => {
        const db = await new Database().promise;
        return db.query('SELECT * FROM resellers where eid = ?', eid);
    },
    getResellerByName: async (name) => {
        const db = await new Database().promise;
        return db.query('SELECT * FROM resellers where name = ?', name);
    },
    getEmployerEligibilityList: async (employer_id, source_name = false) => {
        const db = await new Database().promise;
        let dbQuery = `SELECT * FROM eligibility_list where employer_id = '${employer_id}' `;
        if(source_name){
            dbQuery += `and record_source = '${source_name}' `;
        }
        return db.query(dbQuery);
    },
    getEmployerEligibilityCount: async (employer_id, source_name = false) => {
        const db = await new Database().promise;
        let dbQuery = `SELECT count(status) as count FROM eligibility.eligibility_list where employer_id = '${employer_id}' and (status = 'eligible' or status = 'enrolled')`;
        // let dbQuery = `SELECT status , count(status) as count FROM eligibility.eligibility_list where employer_id = '${employer_id}' group by status
        // UNION ALL
        // SELECT 'total' status, COUNT(status) as count FROM eligibility.eligibility_list where employer_id = '${employer_id}' `;
        // let dbQuery = `SELECT count(*) as eligCount FROM eligibility_list where employer_id = '${employer_id}' `;
        // if(source_name){
        //     dbQuery += `and record_source = '${source_name}' `;
        // }
        return db.query(dbQuery);
    },
    getFileHistory: async (limit) => {
        const db = await new Database().promise;
        return db.query(`SELECT emp.name employer_name, emp.external_id employer_ext_id, emp.eligibility_rules,  elh.* FROM eligibility_files_history elh
            inner join employers emp on emp.id = elh.employer_id
            where elh.status not like 'new' and emp.name not like '%Upright%'
            order by elh.created_at desc limit ?`, limit);
    },
    getFileHistoryStatistics: async (days) => {
        const db = await new Database().promise;
        return db.query(`SELECT status, count(*) as count FROM eligibility.eligibility_files_history
            WHERE created_at BETWEEN CURDATE() - INTERVAL ? DAY AND CURDATE()
            group by status`, days);
    },
    getEnrollmentStatistics: async (days) => {
        const db = await new Database().promise;
        return db.query(`select DATE(last_redeemed) redeem_date, count(*) as redeem_count from (
            select redeemed.eligibility_list_id, max(redeemed.redeemed_at) as last_redeemed from redeemed_products redeemed
            group by redeemed.eligibility_list_id
            having max(redeemed.redeemed_at) BETWEEN CURDATE() - INTERVAL ? DAY AND CURDATE()
            ) month_redeems
            group by DATE(last_redeemed)
            order by redeem_date desc;`, days);
    },
    getEmployerFolderNameByEid: async (eid)=>{
        const db = await new Database().promise;
        return db.query(`select folder from employers where external_id=?`, eid);
    },
    getEmployerFileHistory: async (empid, limit) => {
        const db = await new Database().promise;
        return db.query(`SELECT emp.name employer_name, emp.external_id employer_eid, emp.eligibility_rules, hist.* FROM eligibility_files_history hist
            inner join employers emp on emp.id = hist.employer_id
            where emp.external_id = ? and hist.status not like 'new' and emp.name not like '%Upright%'
            order by hist.created_at desc limit ?`, [empid, limit]);
    },
    getEmployerFileHistoryLog: async (empid, histid) => {
        const db = await new Database().promise;
        return db.query(`SELECT log.* FROM eligibility_file_log log
        inner join eligibility_files_history h on h.id = log.files_history_id
        inner join employers e on e.id = h.employer_id
        where e.external_id = ? and h.id = ?
        order by h.created_at desc limit 100`, [empid, histid]);
    },
    updateEmployerStatus: async (empid, status) => {
        const db = await new Database().promise;
        return db.query(`update employers set status=? where external_id=?`, [status, empid]);
    },
    deleteTestUsersFromEmployerId: async (id, date) => {
        const db = await new Database().promise;
        return db.query(`update eligibility_list set termination_date=? where employer_id=? and test_record=1`, [date, id]);
    },
    terminateEligibilityUsersFromEmployerId: async (id, date) => {
        const db = await new Database().promise;
        return db.query(`update eligibility_list set termination_date=? where employer_id=?`, [date, id]);
    },
    updateEmployersSftpUsers: async (id, sftp_users_list) => {
        const db = await new Database().promise;
        return db.query(`update employers set sftp_users_list=? where external_id=?`, [sftp_users_list, id]);
    },
    updateEmployerFolder: async (folder, id) => {
        const db = await new Database().promise;
        return db.query(`update employers set folder=? where external_id=?`, [folder, id]);
    },
    getFileHistoryLog: async (id) => {
        const db = await new Database().promise;
        return db.query(`SELECT * FROM eligibility_files_history where id = ?`, id);
    },
    getFileHistoryByFileName: async (file_name) => {
        const db = await new Database().promise;
        return db.query(`SELECT * FROM eligibility_files_history where file_name = ?`, file_name);
    },
    createFileHistoryLog: async (employer_id, file_name, folder, status) => {
        const db = await new Database().promise;
        let [[lastCount], flds] = await db.query('SELECT max(employer_upload_counter) as counter FROM eligibility.eligibility_files_history group by employer_id having employer_id = ?', [employer_id]);
        return db.query(`INSERT INTO eligibility_files_history SET ?`, { employer_id, file_name, folder, status, employer_upload_counter: lastCount ? lastCount.counter + 1 : 1 });
    },
    updateFileHistoryLog: async (file_log_id, data) => {
        const db = await new Database().promise;
        let [fieldSet, valueSet] = buildUpdateQuery(data);
        return db.query(`UPDATE eligibility_files_history SET ${fieldSet} WHERE id = ?`, [...valueSet, file_log_id]);
    },
    searchFileHistoryLog: async(from) => {
        const db = await new Database().promise;
        let q = `SELECT * FROM eligibility.eligibility_files_history where created_at >= ? and status = ? order by created_at desc`;
        let val = [from, constants.FileLogStatus.SUCCESS];
        return db.query(q, val);
    },
    reportToFileLog: async (type, activity, notes, data, files_history_id) => {
        const db = await new Database().promise;
        return db.query(`INSERT INTO eligibility_file_log SET ?`, { files_history_id, type, activity, notes, data });
    },
    retrieveFileLogs: async (file_log_id) => {
        const db = await new Database().promise;
        return db.query(`SELECT * FROM eligibility_file_log WHERE files_history_id = ?`, file_log_id);
    },
    getAllEmployers: async () => {
        const db = await new Database().promise;
        return db.query(`SELECT * FROM employers`);
    },
    getEmployersList: async () => {
        const db = await new Database().promise;

        // * New query to include test users count for each employer connected with eligibility_list table.
        return db.query(`
            SELECT IFNULL(SUM(el.test_record), 0) as test_users_count, emp.folder, emp.external_id, emp.name, emp.status, emp.support_phone, emp.support_email, emp.created_at, emp.updated_at,res.eid
            FROM employers as emp
            INNER JOIN resellers as res ON emp.reseller_id = res.id
            LEFT JOIN eligibility_list as el ON (el.employer_id = emp.id AND (el.termination_date is null OR el.termination_date = ''))
            GROUP BY emp.external_id
            ORDER BY emp.created_at asc`
        );

        // * Kept previous query for future reference.
        // return db.query(`SELECT emp.external_id, emp.name, emp.status, emp.support_phone, emp.support_email, emp.created_at, emp.updated_at,res.eid
        // FROM employers as emp
        // INNER JOIN resellers as res ON emp.reseller_id = res.id
        // order by emp.created_at asc`);
    },
    getEmployer: async (external_id) => {
        const db = await new Database().promise;
        return db.query(`SELECT emp.*, res.eid as eid, res.b2b_link as reseller_b2b_link, res.kickoff_link as reseller_kickoff_link, res.epic_link as reseller_epic_link FROM eligibility.employers as emp INNER JOIN eligibility.resellers as res ON emp.reseller_id = res.id where external_id = ? `, external_id);
    },
    getExternalEmployerId: async (employer_id,employee_id,role) => {
        const db = await new Database().promise;
        return db.query(`SELECT * FROM eligibility_list where employer_id = ? AND employee_id = ? AND role = ?`,employer_id,employee_id,role);
    },
    getEmployerByID: async (employer_id) => {
        const db = await new Database().promise;
        return db.query(`SELECT * FROM employers where id = ?`, employer_id);
    },
    getEmployerByExternalID: async (external_id) => {
        try {
            const db = await new Database().promise;
            const [employers] = await db.query(`SELECT * FROM employers where external_id = ?`, external_id);
            if (!employers || !employers[0]) {
                throw Error(`There is no employer with external_id=${external_id}`)
            }
            return employers[0]
        } catch (error) {
            console.log('getEmployerByExternalID error:', error.message);
            throw error
        }
    },
    getEmployerByName: async (employerName) => {
        const db = await new Database().promise;
        return db.query(`SELECT * FROM employers where name like ?`, `${employerName}%`);
    },
    getEmployerListByExternalID: async (external_id) => {
        const db = await new Database().promise;
        return db.query(`SELECT * FROM employers where external_id = ?`, external_id);
    },
    getEmployersByResellerId: async (id) => {
        const db = await new Database().promise;
        return db.query(`SELECT * FROM employers where reseller_id = ?`, id);
    },
    getActiveEmployersByResellerId: async (id) => {
        const db = await new Database().promise;
        return db.query(`SELECT * FROM employers where reseller_id = ? AND status = ?`, [id, constants.EmployerStatus.ACTIVE]);
    },
    getEligibilitySkusList: async () => {
        const db = await new Database().promise;
        return db.query(`
            SELECT
                eligibility_name,
                MIN(product_type) AS product_type,
                GROUP_CONCAT(\`data\` ORDER BY id DESC SEPARATOR ', ') AS skus_list
            FROM
                eligibility_skus
            GROUP BY
                eligibility_name
        `);
    },
    getEmployerByFolder: async (folder) => {
        console.log('getEmployerByFolder', folder)
        const db = await new Database().promise;
        let folderData = folder.map(val => `'${val}'`).join(',')
        console.log('folderData', folderData, `SELECT * FROM employers where folder in (${folderData})`)
        return db.query(`SELECT * FROM employers where folder in (${folderData})`);
    },
    getEmployerForCronFileProcess: async () => {
        console.log('getEmployerForCronFileProcess')
        const db = await new Database().promise;
        return db.query(`SELECT * FROM employers where record_source = 'cron'`);
    },
    addEligibility: async (newRec, employerId, status, stage = constants.EligibilityStage.NEW) => {
        const db = await new Database().promise;
        return db.query(`INSERT INTO eligibility_list SET ?`, { ...newRec, employer_id: employerId, status, stage });
    },
    updateEligibility: async (newRec, id) => {
        console.log('[updateEligibility] --> updating eligibility DB record. newRec:', newRec, 'id:', id);
        const db = await new Database().promise;
        let [fieldset, valueSet] = buildUpdateQuery(newRec);
        return db.query(`UPDATE eligibility_list SET ${fieldset} WHERE id = ?`, [...valueSet, id]);
    },
    updateEligibilityStatus: async (status, id) => {
        const db = await new Database().promise;
        return db.query(`UPDATE eligibility_list SET status = ? WHERE id = ?`, [status, id]);
    },
    updateEligibilityStatusStage: async (status, stage, id) => {
        const db = await new Database().promise;
        return db.query(`UPDATE eligibility_list SET status = ?, stage = ? WHERE id = ?`, [status, stage, id]);
    },
    updateEligibilityStage: async (stage, id) => {
        const db = await new Database().promise;
        return db.query(`UPDATE eligibility_list SET stage = ? WHERE id = ?`, [stage, id]);
    },
    updateEligibilityAppEmail: async (email, id) => {
        const db = await new Database().promise;
        return db.query(`UPDATE eligibility_list SET app_email = ? WHERE id = ?`, [email, id]);
    },
    updateEligibilityAppUserId: async (appId, id) => {
        const db = await new Database().promise;
        return db.query(`UPDATE eligibility_list SET dario_app_uid = ? WHERE id = ?`, [appId, id]);
    },
    getEligibilityByEId: async (eid) => {
        const db = await new Database().promise;
        return db.query(`SELECT * FROM eligibility_list WHERE eid = ?`, [eid]);
    },
    getEligibilityById: async (id) => {
        const db = await new Database().promise;
        return db.query(`SELECT * FROM eligibility_list WHERE id = ?`, [id]);
    },
    getEligibility: async (employerId, eid) => {
        const db = await new Database().promise;
        return db.query(`SELECT * FROM eligibility_list WHERE employer_id = ? AND eid = ?`, [employerId, eid]);
    },
    getEligibilityByFields: async (where = '', fields = []) => {
        console.log('getEligibilityByFields', JSON.stringify(where), JSON.stringify(fields))
        const db = await new Database().promise;
        return db.query(`SELECT * FROM eligibility_list WHERE ${where}`, fields);
    },
    getEligibilityByResellerRoleEmpId: async (resellerEmpId, employerId, role) => {
        const db = await new Database().promise;
        return db.query(`SELECT * FROM eligibility_list WHERE employer_id = ? AND reseller_employee_id = ? AND role = ?`, [employerId, resellerEmpId, role]);
    },
    getEnrolledMinorsByReseller: async (resellerEmpId, employerId, role, minorAge) => {
        const db = await new Database().promise;
        return db.query(`SELECT * FROM eligibility_list WHERE employer_id = ? AND reseller_employee_id = ? AND role <> ? AND dob >= (curdate() - interval ? YEAR) and app_email <> '' `, [employerId, resellerEmpId, role, minorAge]);
    },
    getRedeemedProductsList: async (eligibility_list_id) => {
        const db = await new Database().promise;
        return db.query(`SELECT * FROM redeemed_products WHERE eligibility_list_id = ?`, eligibility_list_id);
    },
    updateRedeemedProductsStatus: async (status, eligibility_list_id) => {
        const db = await new Database().promise;
        return db.query(`UPDATE redeemed_products SET status = ? WHERE eligibility_list_id = ?`, [status, eligibility_list_id])
    },
    updateRedeemedProductsStatusWithId: async (status, id) => {
        const db = await new Database().promise;
        return db.query(`UPDATE redeemed_products SET status = ? WHERE id = ?`, [status, id])
    },
    addRedeemedProductToList: async (eligibility_list_id, record) => {
        const db = await new Database().promise;
        return db.query(`INSERT INTO redeemed_products SET ?`, {...record, 'eligibility_list_id': eligibility_list_id});
    },
    deleteAllRedeemedProductTList: async (eligibility_list_id) => {
        const db = await new Database().promise;
        return db.query(`DELETE FROM redeemed_products WHERE eligibility_list_id = ?`, eligibility_list_id);
    },
    deleteRedeemedProductWithOrderId: async (order_id) => {
        console.log(`deleteRedeemedProductWithOrderId order_id: ${order_id}`)
        const db = await new Database().promise;
        return db.query(`DELETE FROM redeemed_products WHERE order_id = ?`, order_id);
    },
    addBulkRedeemedProductHistory: async(redeemedProducts) => {
        const [fieldset, valueSet]  = buildInsertMany(redeemedProducts,'redeemed_products_id')
        console.log(`addBulkRedeemedProductHistory buildInsertMany: ${JSON.stringify({fieldset, valueSet})}`)
        const db = await new Database().promise;
        return db.query(`INSERT INTO redeemed_products_history (${fieldset}) VALUES ${valueSet}`);
    },
    addRedeemedProductHistory: async(redeemedProduct) => {
        const { id } = redeemedProduct
        delete redeemedProduct.id
        const redeemedProductHistoryRecord = { redeemed_products_id: id, ...redeemedProduct }
        const db = await new Database().promise;
        return db.query(`INSERT INTO redeemed_products_history SET ?`, redeemedProductHistoryRecord);
    },
    addEligibilityLog: async (eligibility_list_id, action, notes) => {
        const db = await new Database().promise;
        return db.query(`INSERT INTO eligibility_log SET ?`, {eligibility_list_id, action, notes});
    },
    addEligibilityHistory: async (eligRec, fileHistoryID) => {
        const db = await new Database().promise;
        return db.query(`INSERT INTO eligibility_history_list SET ?`, {...eligRec, eligibility_files_history_id: fileHistoryID});
    },
    getEligibilityHistory: async (eligRec, employer_id, limit) => {
        const {eid} = eligRec;
        console.log(`getEligibilityHistory [ eid, employer_id ] ${ {eid, employer_id} }`)
        const db = await new Database().promise;
        const dbquery = `SELECT * from eligibility_history_list where eid=? AND employer_id=? ORDER BY created_at DESC ` + (limit?'limit ?':'')
        let param = [eid, employer_id ]
        if(limit) param.push(limit)
        return db.query(dbquery, param);
    },
    // transactions
    addEligibilityTrx: async (newRec, employerId, fileHistoryID, status, stage = constants.EligibilityStage.NEW, originalRecord) => {
        const db = await new Database().promise;
        let tableRecord = { ...newRec, employer_id: employerId, status, stage };

        return Promise.all([
            db.query(`INSERT INTO eligibility_list SET ?`, {...tableRecord}),
            db.query(`INSERT INTO eligibility_history_list SET ?`, {...tableRecord, eligibility_files_history_id: fileHistoryID, originalRecord: originalRecord})
        ]);
    },
    updateEligibilityTrx: async (newRec, employerId, fileHistoryID, id, originalRecord, currElig = null) => {
        const db = await new Database().promise;
        let [fieldset, valueSet] = buildUpdateQuery(newRec);
        let eligHist = { ...newRec, employer_id: employerId, eligibility_files_history_id: fileHistoryID, originalRecord: originalRecord };
        if(currElig) eligHist.status = currElig.status ;
        if(currElig) eligHist.stage = currElig.stage ;
        delete eligHist.id;
        delete eligHist.created_at;
        delete eligHist.updated_at;
        console.log(`UPDATE eligibility_list SET ${JSON.stringify(fieldset)} ${JSON.stringify(valueSet)} WHERE id = ${id}`)

        return Promise.all([
            db.query(`UPDATE eligibility_list SET ${fieldset} WHERE id = ?`, [...valueSet, id]),
            db.query(`INSERT INTO eligibility_history_list SET ?`, eligHist)
        ]);
    },
    updateEligibilityStatusTrx: async (status, stage, fileHistoryID, id, disenrolled_at = null) => {
        const db = await new Database().promise;
        let [current, current_flds] = await db.query(`SELECT * from eligibility_list where id = ?`, [id]);
        if (current.length != 1) throw new Error(`Could not find eligibility_list with id=${id}`);
        let elig = current[0];
        let eligHist = { ...elig, eligibility_files_history_id: fileHistoryID };
        delete eligHist.id;
        delete eligHist.created_at;
        delete eligHist.updated_at;

        return Promise.all([
            db.query(`UPDATE eligibility_list SET status = ?, stage = ?, disenrolled_at = ? WHERE id = ?`, [status, stage, disenrolled_at, id]),
            db.query(`INSERT INTO eligibility_history_list SET ?`, eligHist)
        ]);
    },
    updateEligibilitySalesForceIDTrx: async (sf_id, fileHistoryID, id) => {
        const db = await new Database().promise;
        let [current, current_flds] = await db.query(`SELECT * from eligibility_list where id = ?`, [id]);
        if (current.length != 1) throw new Error(`Could not find eligibility_list with id=${id}`);
        let elig = current[0];
        let eligHist = { ...elig, eligibility_files_history_id: fileHistoryID };
        delete eligHist.id;
        delete eligHist.created_at;
        delete eligHist.updated_at;

        return Promise.all([
            db.query(`UPDATE eligibility_list SET sf_id = ? WHERE id = ?`, [sf_id, id]),
            db.query(`INSERT INTO eligibility_history_list SET ?`, eligHist)
        ]);
    },
    updateEligibilityStageTrx: async (stage, fileHistoryID, id) => {
        const db = await new Database().promise;
        let [current, current_flds] = await db.query(`SELECT * from eligibility_list where id = ?`, [id]);
        if (current.length != 1) throw new Error(`Could not find eligibility_list with id=${id}`);
        let elig = current[0];
        let eligHist = { ...elig, eligibility_files_history_id: fileHistoryID };
        delete eligHist.id;
        delete eligHist.created_at;
        delete eligHist.updated_at;

        return Promise.all([
            db.query(`UPDATE eligibility_list SET stage = ? WHERE id = ?`, [stage, id]),
            db.query(`INSERT INTO eligibility_history_list SET ?`, eligHist)
        ]);
    },
    updateEligibilityGracePeriodTrx: async (date, fileHistoryID, id) => {
        const db = await new Database().promise;
        let [current, current_flds] = await db.query(`SELECT * from eligibility_list where id = ?`, [id]);
        if (current.length != 1) throw new Error(`Could not find eligibility_list with id=${id}`);
        let elig = current[0];
        let eligHist = { ...elig, eligibility_files_history_id: fileHistoryID };
        delete eligHist.id;
        delete eligHist.created_at;
        delete eligHist.updated_at;

        return Promise.all([
            db.query(`UPDATE eligibility_list SET grace_period = ? WHERE id = ?`, [date, id]),
            db.query(`INSERT INTO eligibility_history_list SET ?`, eligHist)
        ]);
    },
    getEligibilityFlow: async flow_id => {
        const db = await new Database().promise;
        return db.query(`SELECT * FROM eligibility_flow where id = ?`, flow_id);
    },
    addEligibilityFlowLog: async (eligibility_list_id, flow_id, additional_info = null) => {
        const db = await new Database().promise;
        return db.query(`INSERT INTO eligibility_flow_log SET ?`, { eligibility_list_id, flow_id, additional_info });
    },
    addEligibilitySurveyLog: async (eligibility_list_id, survey_type, survey_score, survey_answers, additional_info = null) => {
        const db = await new Database().promise;
        return db.query(`INSERT INTO eligibility_survey_log SET ?`, { eligibility_list_id, survey_type, survey_score, survey_answers, additional_info  });
    },
    addEligibilityCheckFailedLog: async (employer_id, form, notes = null) => {
        const db = await new Database().promise;
        return db.query(`INSERT INTO eligibility_check_failed_log SET ?`, { employer_id, form, notes });
    },
    addEligibilityFlowLogTrx: async (eligibility_list_id, flow_id, additional_info = null) => {
        const db = await new Database().promise;
        let [flowRec, flowRec_flds] = await db.query(`SELECT * FROM eligibility_flow where id = ?`, flow_id);
        if(flowRec.length !== 1) throw new Error(`ERROR flow ID ${flow_id} not found!`);
        if(flowRec[0].logonly !== 1){
            await db.query(`UPDATE eligibility_list SET flow_id = ? WHERE id = ?`, [flow_id, eligibility_list_id]);
        }
        return db.query(`INSERT INTO eligibility_flow_log SET ?`, { eligibility_list_id, flow_id, additional_info });
    },
    updateInsuranceClaimsFile: async (file, id) => {
        const db = await new Database().promise;
        return db.query(`UPDATE employers SET insurance_claims_last_file = ? WHERE id = ?`, [file, id]);
    },
    updateEmployerBrazeStats: async (id, braze_stats) => {
        const db = await new Database().promise;
        return db.query(`UPDATE employers SET braze_stats = ? WHERE id = ?`, [braze_stats, id]);
    },
    getEligibilityStatistics: async () => {
        const db = await new Database().promise;
        return db.query(`select stats.*, empl.name from (
            select employers.external_id, status, count(*) count from eligibility_list inner join employers on eligibility_list.employer_id = employers.id
            group by employers.external_id, status with rollup) stats
            inner join employers empl on stats.external_id = empl.external_id order by external_id, status;`);
    },
    getTerminationList: async () => {
        const db = await new Database().promise;
        return db.query(
            `SELECT *
            FROM eligibility_list
            WHERE termination_date < now() AND status = 'eligible'
            OR termination_date < now() AND status = 'enrolled'
            OR deceased_date < now() AND status = 'eligible'
            OR deceased_date < now() AND status = 'enrolled'`
            );
    },
    getGraceTerminationList: async () => {
        const db = await new Database().promise;
        return db.query(`SELECT * FROM eligibility_list where grace_period < now() AND status = 'eligible' OR grace_period < now() AND status = 'enrolled'`);
    },
    getEmployerMinorTerminationLinkList: async (id, date, range_date) => {
        const db = await new Database().promise;
        return db.query(`SELECT * FROM eligibility_list WHERE employer_id = ? AND dob BETWEEN '?' AND '?'`, [id, range_date, date]);
    },
    getEmployerMinorTargetingList: async () => {
        const db = await new Database().promise;
        return db.query(`SELECT id, eligibility_rules FROM employers`);
    },
    //flex
    getVitatlityMockOrders: async (order_id) => {
        const db = await new Database().promise;
        return db.query(`SELECT * FROM mock_vitality_orders WHERE order_id=?`, order_id);
    },
    getEmployerOrder: async (order_id, employer_id) => {
        const db = await new Database().promise;
        return db.query(`SELECT * FROM employers_orders WHERE employer_order_id=? AND employer_id=?`, [order_id, employer_id]);
    },
    addEmployerOrder: async (employer_order_id, employer_id, shop_data) => {
        const db = await new Database().promise;
        return db.query(`INSERT INTO employers_orders SET ?`, {employer_order_id, employer_id, shop_data});
    },
    getEmployerAttributesByType: async (employer_id, type) => {
        const db = await new Database().promise;
        return db.query(`SELECT * FROM employer_attributes a WHERE a.employer_id = ? AND a.type = ?`, [employer_id, type]);
    },
    getEmployerAttribute: async (employer_id, type, key) => {
        const db = await new Database().promise;
        return db.query(`SELECT * FROM employer_attributes a WHERE a.employer_id = ? AND a.type = ? AND a.key = ?`, [employer_id, type, key]);
    },
    addSoleraActivityRequest: async (activityRecord) => {
        const db = await new Database().promise;
        return db.query(`INSERT INTO activity_requests SET ?`, {...activityRecord});
    },
    getProcessingActivityRequestsOlderThen: async (date) => {
        const db = await new Database().promise;
        return db.query(`SELECT * FROM activity_requests WHERE created_at < ? AND status = 'processing'`, [date]);
    },
    updateProcessingActivityRequests: async (status, referenceId, requestId) => {
        const db = await new Database().promise;
        return db.query(`UPDATE activity_requests SET status = ? WHERE reference_id = ? AND request_id = ?`, [status, referenceId, requestId])
    },
    createNewEmployer: async (resellerEid, data, userid) => {
        validateEmployerBody(data);
        const db = await new Database().promise;
        let [rows] = await db.query('SELECT id,name  FROM resellers WHERE eid = ?', resellerEid);
        if(rows.length !== 1) {
            throw new Error(`No Reseller Found for this eid: ${resellerEid}`);
        }
        let reseller = rows[0];
        let external_id = await getNextEmployerExternalId();

        let newEmployer = await createNewEmployerData(reseller.id,external_id,data)/*{
            reseller_id : reseller.id,
            external_id,
            name: data.name,
            structure: data.structure,
            mapping_rules: data.mapping_rules,
            eligibility_rules: data.eligibility_rules,
            ftp_info : data.ftp_info,
            record_source :data.record_source,
            parser_structure :data.parser_structure,
            folder :data.folder,
            file_name_filter :data.file_name_filter,
            insurance_claims :data.insurance_claims,
            insurance_claims_last_file :data.insurance_claims_last_file,
            external_ftp :data.external_ftp,
            support_phone :data.support_phone,
            support_email :data.support_email,
        }*/

        let [res] = await db.query(`INSERT INTO employers SET ?`, {...newEmployer});
        res.external_id = external_id;
        res.user_id = userid;
        res.reseller_name = reseller.name;

        if (!!res && res.insertId > 0) {
            const employerHistory = {
                ...newEmployer,
                employer_id: res.insertId,
                user_id: userid,
                reason: data.reason,
            }

            await db.query(`INSERT INTO employers_history SET ?`, {...employerHistory});
        }
        return res;
    },
    createReseller: async (data, userid) =>{
        const db = await new Database().promise;
        // const eid = generateShortId();
        const eid = await generateUniqueEid();

        const defaultMtbFeatures = {
            "activate_care_kitchen": false,
            "activate_dexcom_device": false,
            "activate_grocery_scanner": false,
            "activate_healthkit_observers": false,
            "activate_prescription_manager": false
        }

        const newReseller = {
            eid,
            name : data.name,
            description :data.description,
            eligibility_rules: data.eligibility_rules,
            configurations: data.configurations,
            support_phone :data.support_phone,
            support_email :data.support_email,
            launch_date :data.launch_date,
            b2b_link :data.b2b_link,
            kickoff_link :data.kickoff_link,
            epic_link :data.epic_link,
            mtb_features: data.mtb_features ? JSON.stringify(data.mtb_features) : JSON.stringify(defaultMtbFeatures),
        };

        let [res] = await db.query(`INSERT INTO resellers SET ?`, newReseller);

        if (!!res && res.insertId > 0) {
            let resellerHistory = {
                ...newReseller,
                reseller_id: res.insertId,
                user_id: userid,
                reason: data.reason
            };

            await db.query(`INSERT INTO resellers_history SET ?`, resellerHistory);
        }
        return res;
    },
    updateResellers: async (resellerId, data, userid) =>{
        const db = await new Database().promise;
        let [resellers] = await db.query('SELECT * FROM resellers where eid = ?', resellerId);
        if(!resellers || resellers.length != 1){
            throw new Error(`ERROR: reseller ${resellerId} does not exist`);
        }
        const rerseller = resellers[0];

        const defaultMtbFeatures = {
            "activate_care_kitchen": false,
            "activate_dexcom_device": false,
            "activate_grocery_scanner": false,
            "activate_healthkit_observers": false,
            "activate_prescription_manager": false
        }

        const updateRecords = {
            name : data.name,
            description :data.description,
            eligibility_rules: data.eligibility_rules,
            configurations: data.configurations,
            support_phone :data.support_phone,
            support_email :data.support_email,
            launch_date :data.launch_date,
            b2b_link :data.b2b_link,
            kickoff_link :data.kickoff_link,
            epic_link :data.epic_link,
            mtb_features: data.mtb_features ? JSON.stringify(data.mtb_features) : JSON.stringify(defaultMtbFeatures),
        };

        let [fieldset, valueSet] = buildUpdateQuery(updateRecords);
        let [res] = await db.query(`UPDATE resellers SET ${fieldset} WHERE id = ?`, [...valueSet, rerseller.id]);
        console.log(`updated reseller id: ${rerseller.id}`, res);

        if (!!res && res.affectedRows === 1 ) {
            let historyData = {
                ...updateRecords,
                reseller_id: rerseller.id,
                eid: resellerId,
                user_id: userid,
                reason: data.reason,
            }

            await db.query(`INSERT INTO resellers_history SET ?`, historyData);
        }
        return res;
    },
    updateEmployer: async (resellerEid, employerEid, data, userid) => {
        const db = await new Database().promise;
        console.log(`updated request for employer ${employerEid} (reseller: ${resellerEid})`)
        let [resellers] = await db.query('SELECT id,name  FROM resellers WHERE eid = ?', resellerEid);
        if(!resellers || resellers.length != 1){
            throw new Error(`ERROR: reseller ${resellerEid} does not exist`);
        }
        const reseller = resellers[0];
        let reseller_id = reseller.id;

        let [employers] = await db.query('SELECT id, eligibility_rules  FROM employers WHERE reseller_id = ? and external_id = ?', [reseller_id, employerEid]);
        if(!employers || employers.length != 1){
            throw new Error(`ERROR: employer ${employerEid} does not exist under reseller ${resellerEid}`);
        }
        const employer = employers[0];
        let employer_id = employer.id;
        let eligibility_rules = employer.eligibility_rules
                                ? employer.eligibility_rules.trim()
                                    ? employer.eligibility_rules.trim()
                                    : '{}'
                                : '{}'

        let incoming_eligibility_rules = data.eligibility_rules
                                            ? data.eligibility_rules.trim()
                                                ? data.eligibility_rules.trim()
                                                : '{}'
                                            : '{}'

        data.eligibility_rules = JSON.stringify({ ...JSON.parse( eligibility_rules ), ...JSON.parse( incoming_eligibility_rules ) });

        let reason = data.reason;
        delete data.user_id;
        delete data.reason;

        let [fieldset, valueSet] = buildUpdateQuery(data);
        let [res] = await db.query(`UPDATE employers SET ${fieldset} WHERE id = ?`, [...valueSet, employer_id]);
        console.log(`updated employer id: ${employer_id}`, res);

        if (!!res && res.affectedRows === 1 ) {
            let employerHistory = {
                ...data,
                employer_id: employer_id,
                external_id: employerEid,
                reseller_id,
                user_id: userid,
                reason: reason
            };
            await db.query(`INSERT INTO employers_history SET ?`, employerHistory);


        }
        res.reseller_name = reseller.name;
        return res;
    },
    updateEmployerSalesforceId: async (employerEid, sf_eligbility_account_ID) => {
        const db = await new Database().promise;
        console.log(`updated SF Id for employer ${employerEid}`)
        let [res] = await db.query(`UPDATE employers SET sf_eligbility_account_ID = ? WHERE external_id = ?`, [sf_eligbility_account_ID, employerEid]);
        console.log(`updated sfid for employer id: ${employerEid}`, res);
        return res;
    },
    getEmployerChangeHistory: async (externalId) => {
        const db = await new Database().promise;
        return db.query(`SELECT * FROM employers_history WHERE external_id = ?` , [externalId]);
    },
    getResellerHistoryById : async (id) =>{
        const db = await new Database().promise;
        return db.query(`SELECT * FROM resellers_history WHERE eid = ?` , [id]);
    },
    getEnrollmentSetupById: async(employer_ext_id) =>{
        const db = await new Database().promise;
        return db.query(`SELECT id ,external_id,enrollment_setup FROM employers WHERE external_id = ?`, employer_ext_id);
    },
    updateEnrollmentSetupById: async(enrollment_setup,employer_ext_id) =>{
        const db = await new Database().promise;
        let [res] = await db.query(`UPDATE employers SET enrollment_setup = ? WHERE external_id = ?`, [enrollment_setup, employer_ext_id]);
        let [data] = await db.query(`SELECT * FROM employers WHERE external_id = ?`, employer_ext_id);
        if (!!res && res.affectedRows === 1 && !!data && data.length === 1  ) {
            let employerID= data[0].id;
            delete data[0].id;
            let employerHistory = {
                ...data[0],
                employer_id :employerID,
                user_id: '',
                reason: ''

            };
            await db.query(`INSERT INTO employers_history SET ?`, employerHistory);
        }
        return res;

    },
    exportEmployerResellerData: async(params) =>{
        const db = await new Database().promise;
        let [reseller] = await db.query(`SELECT * FROM resellers WHERE eid = ?` ,params.resellerId);
        let [employer] = await  db.query(`SELECT * FROM employers WHERE external_id = ?`, params.externalId);
        if(reseller.length > 0 && employer.length > 0 && reseller[0].id === employer[0].reseller_id) {
            reseller[0].id = "_INTERNAL_";
            employer[0].id = "_INTERNAL_"
            const result = {
                exported_at: new Date(),
                exported_by: !!params.email ? params.email : '',
                reseller: reseller[0],
                employer: employer[0],
            }
            return result;
        } else {
            return null
        }
    },
    updateEmployerFilePath :async (params)=>{
        const db = await new Database().promise;
        let [res] = await db.query(`UPDATE employers SET file_path = ? WHERE external_id = ? `, [params.file_path, params.external_id]);
        let [data] = await db.query(`SELECT * FROM employers WHERE external_id = ? `, params.external_id);
        if (!!res && res.affectedRows === 1 && !!data && data.length === 1  ) {
            let employerID= data[0].id;
            delete data[0].id;
            let employerHistory = {
                ...data[0],
                employer_id :employerID,
                user_id: '',
                reason: ''

            };
            await db.query(`INSERT INTO employers_history SET ?`, employerHistory);
        }
        return res;
    },
    updateEmployerSourceFolder :async (params)=>{
        const db = await new Database().promise;
        let [res] = await db.query(`UPDATE employers SET folder = ? WHERE external_id = ? `, [params.folder, params.external_id]);
        let [data] = await db.query(`SELECT * FROM employers WHERE external_id = ? `, params.external_id);
        if (!!res && res.affectedRows === 1 && !!data && data.length === 1  ) {
            let employerID= data[0].id;
            delete data[0].id;
            let employerHistory = {
                ...data[0],
                employer_id :employerID,
                user_id: '',
                reason: ''

            };
            await db.query(`INSERT INTO employers_history SET ?`, employerHistory);
        }
        return res;
    },
    // Function to get list of all admin users from DB
    getAdminUsersList: async () => {
        const db = await new Database().promise;
        return db.query(`SELECT * FROM admin_roles roles inner join admin_users users on users.role_id = roles.id`);
    },
    // Function to get admin user details from DB
    getAdminUserByID: async (id) => {
        const db = await new Database().promise;
        return db.query(`SELECT * FROM admin_roles roles inner join admin_users user on user.role_id = roles.id WHERE user.id = ?`, [id]);
    },
    // Function to create admin user in DB
    createAdminUser: async (data) => {
        const db = await new Database().promise;
        const id = await getNextAdminUserId();
        const newAdminUser = {
            id,
            email : data.email,
            role_id : data.role_id,
            added_in_sso: data.added_in_sso,
            login_count: 0,
            created_at: new Date()
        };
        let [res] = await db.query(`INSERT INTO admin_users SET ?`, newAdminUser);
        return res;
    },
    // Function to update admin user in DB
    updateAdminUser: async (data, userId) => {
        const db = await new Database().promise;
        const adminUser = {
            email : data.email,
            role_id : data.role_id,
            added_in_sso: data.added_in_sso,
            updated_at: new Date(),
        };
        let [fieldset, valueSet] = buildUpdateQuery(adminUser);
        let [res] = await db.query(`UPDATE admin_users SET ${fieldset} WHERE id = ?`, [...valueSet, userId]);
        return res;
    },
    // Function to update admin user login in DB
    updateAdminUserLogin: async (data, userId) => {
        const db = await new Database().promise;
        let login_count = 1;
        if (data.login_count) login_count = data.login_count + 1;
        const adminUser = {
            login_count,
            last_login: new Date(),
            added_in_sso: true,
            updated_at: new Date(),
        };
        let [fieldset, valueSet] = buildUpdateQuery(adminUser);
        let [res] = await db.query(`UPDATE admin_users SET ${fieldset} WHERE id = ?`, [...valueSet, userId]);
        return res;
    },
    // Function to get admin user by email
    getAdminUserByEmail: async (email) => {
        const db = await new Database().promise;
        let [res] = await db.query(`SELECT * FROM admin_roles roles inner join admin_users user on user.role_id = roles.id WHERE user.email = ?`, [email]);
        return res;
    },
    // Function to get admin user roles
    getAdminUserRoles: async () => {
        const db = await new Database().promise;
        let res = await db.query(`SELECT role.id, role.role_name FROM admin_roles role`);
        return res;
    },
    beginTransaction: async () => {
        const db = await new Database().promise;
        return db.beginTransaction();
    },
    commit: async () => {
        const db = await new Database().promise;
        return db.commit();
    },
    rollback: async () => {
        const db = await new Database().promise;
        return db.rollback();
    },
    end: async () => {
        const db = await new Database().promise;
        db.end();
    },
    close: async () => {
        const db = await new Database().promise;
        db.close();
    },
    getActiveRpmUser: async (email, empId) => {
        console.log('getActiveRpmUser', email, empId)
        const db = await new Database().promise;
        return db.query(`SELECT * FROM rpm_users where external_employer_id = ? AND status = ? AND email = ?`, [empId, constants.EmployerStatus.ACTIVE, email]);
    },
    getEligibilityList: async (batchSize,offset) => {
        const db = await new Database().promise;
        let dbQuery = `SELECT shop_email, eid FROM eligibility_list WHERE shop_email  IS NOT NULL LIMIT ${offset}, ${batchSize}`;
        return db.query(dbQuery);
    },
}

function validateEmployerBody(data) {
    for (const field of [
        'mapping_rules',
        'eligibility_rules',
        'structure',
        'record_source',
        'parser_structure',
        'insurance_claims',
        'ftp_info'
    ]) {
        if (data[field] && typeof data[field] !== 'string') {
            throw new Error(`Validation error: ${field} must have string value`);
        }
    }
}
