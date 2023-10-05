const mongoose = require('mongoose');
const { Schema } = mongoose;

class ProvisioningSerialsModel {
    COLLECTION_NAME = 'provisioning_serials';
    
    SCHEMA = {
        email: {
            type: String,
            index: true
        },
        serial_number: {
            type: String,
            index: true
        },
        api_source: {
            type: String,
            index: true
        },
        user_source: {
            type: String,
            index: true
        }
    };

    constructor(db){
        this._schema = new Schema(this.SCHEMA, { });
        this.model =  db.model(this.COLLECTION_NAME, this._schema);
    }
}

module.exports = ProvisioningSerialsModel;