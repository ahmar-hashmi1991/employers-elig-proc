const secrets = require('./secrets-service');
const mongoose = require('mongoose');
const models = require('../models');

const secretName = `${process.env.STAGE}-b2b-firewall-db`;

class Database {
    constructor() {
        if (!Database.instance) {
            console.log(`Creating Database instance...`);
            Database.instance = this;

            this.promise = new Promise(function (resolve, reject) {
                initDB(resolve, reject);
            });
        }

        return Database.instance;
    }
}

async function initDB(resolve, reject) {
    let secret = await secrets.getSecret(secretName);
    const connStr = `mongodb://${secret.username}:${secret.password}@${secret.host}:${secret.port}`;
    const connUrl = `${connStr}/b2b-firewall-db-${process.env.STAGE}?connect=replicaSet`;

    const options = {
        connectTimeoutMS: 25000,
        socketTimeoutMS: 300000,
        serverSelectionTimeoutMS: 25000,
        bufferCommands: false, // Disable mongoose buffering
        bufferMaxEntries: 0, // and MongoDB driver buffering
        keepAlive: true,
        useNewUrlParser: true,
        useCreateIndex: true,
        useFindAndModify: false,
        useUnifiedTopology: true,
        tls: true,
        tlsCAFile: './certs/rds-combined-ca-bundle.pem',
        replicaSet:'rs0',
        readPreference:'secondaryPreferred'
    }

    console.log('Connecting... >>', connUrl, options);
    let connection = await mongoose.createConnection(connUrl, options);
    console.log(`Connected to ${connection.name}... <<`);

    let sc = models(connection);
    resolve(sc);
}

/// APIS
module.exports = {
    getMasterRecord: async(query) => {
        const models = await new Database().promise;
        return models.MasterRecords.model.findOne(query);
    },
    getMasterRecords: async(query) => {
        const models = await new Database().promise;
        return models.MasterRecords.model.find(query);
    },
    addMasterRecord: async(record) => {
        const models = await new Database().promise;
        return models.MasterRecords.model.create(record);
    },
    updateMasterRecord: async(id, update) => {
        const models = await new Database().promise;
        return models.MasterRecords.model.findOneAndUpdate({_id: id}, {
            emails: update.emails,
            serial_numbers: update.serial_numbers,
            order_numbers: update.order_numbers,
            user_source: update.user_source,
            type: update.type,
            match_key : update.match_key,
            braze_key : update.braze_key,
            plan : update.plan,
            overrides : update.overrides
        },  { omitUndefined : true });
    },
    deleteMasterRecord: async(id) => {
        const schema = await new Database().promise;
        return schema.MasterRecords.model.findOneAndDelete({_id: id});
    },
    addProvisioniningRecord: async(record) => {
        const models = await new Database().promise;
        return models.ProvisioningSerials.model.create(record);
    },
    getSource: async(query) => {
        const models = await new Database().promise;
        return models.Sources.model.findOne(query);
    }
}
