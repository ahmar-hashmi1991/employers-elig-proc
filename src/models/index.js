const MasterRecordsModel = require('./master-records-model');
const ProvisioningSerialsModel = require('./provisioning-serials-model');
const SourcesModel = require('./sources-model');

module.exports = function(db) {
    // declare seat covers here too
    var schema = {
        MasterRecords: new MasterRecordsModel(db),
        ProvisioningSerials: new ProvisioningSerialsModel(db),
        Sources: new SourcesModel(db),
    };
    return schema;
}